import { randomUUID } from "node:crypto";
import {
  explainComparison,
  explainConfirmed,
  explainHelp,
  explainNeedConfirm,
  explainUnderstanding,
} from "../explain";
import type { Session } from "../session/store";
import type { ModelMessage, ModelToolCall, ParseOverrides } from "../types";
import type { LLMProvider } from "./types";

type Attachment = { id: string; name: string; kind: string };

function visibleText(content: string): string {
  return content
    .replace(/\[attached-files\][\s\S]*?\[\/attached-files\]/g, " ")
    .replace(/\[folder\][\s\S]*?\[\/folder\]/g, " ")
    .trim();
}

function latestUser(messages: ModelMessage[]): string {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    if (messages[index].role === "user") return messages[index].content;
  }
  return "";
}

function attachmentsIn(content: string): Attachment[] {
  const block = content.match(/\[attached-files\]([\s\S]*?)\[\/attached-files\]/);
  if (!block) return [];
  const found: Attachment[] = [];
  for (const line of block[1].split("\n")) {
    const match = line.match(/id:\s*(\S+)\s*\|\s*name:\s*(.*?)\s*\|\s*kind:\s*(\S+)/);
    if (match) found.push({ id: match[1], name: match[2], kind: match[3] });
  }
  return found;
}

export function isConfirmation(text: string): boolean {
  const trimmed = text.trim();
  if (!trimmed || trimmed.length > 220) return false;
  return /^(yes|yep|yeah|ok|okay|correct|confirmed|confirm|looks good|that'?s right|that is right|sim|correto|correta|confirmo|confirmado|est[aá] certo|isso mesmo|pode ser|t[aá] certo|est[aá] correto)\b/i.test(
    trimmed,
  );
}

export function isCorrection(text: string): boolean {
  return /\b(column|coluna|header(?:\s+row)?|cabe[cç]alho|sheet|planilha)\b/i.test(text);
}

export function wantsAnyway(text: string): boolean {
  return /\b(anyway|even so|check anyway|compare anyway|proceed anyway|mesmo assim)\b/i.test(text);
}

/** The user asked for the check itself, not only for a reading of the register. */
export function wantsCheck(text: string): boolean {
  return /\b(check|compare|verify|verification|missing|verificar|verifica|conferir|confere|falta|desenhos|direitos)\b/i.test(
    text,
  );
}

export function extractOverrides(text: string): ParseOverrides {
  const overrides: ParseOverrides = {};
  const row = text.match(/(?:header(?:\s+row)?|cabe[cç]alho|linha|row)\D{0,24}(\d{1,3})/i);
  if (row) overrides.headerRow = Number(row[1]);
  const column = text.match(
    /(?:column|coluna)\s+(?:is\s+|e\s+|é\s+|called\s+|chamada\s+)?["']?([A-Za-z][A-Za-z0-9 ._-]{0,48})/i,
  );
  if (column) {
    const name = column[1]
      .replace(/\b(and|e|please|por favor|with|com)\b.*$/i, "")
      .replace(/[."']+$/g, "")
      .trim();
    if (name) overrides.numberColumn = name;
  }
  const sheet = text.match(
    /(?:sheet|planilha|folha)\s+(?:named\s+|called\s+|chamada\s+)?["']?([A-Za-z][A-Za-z0-9 _-]{0,40})/i,
  );
  if (sheet) {
    const name = sheet[1]
      .replace(/\b(and|e|please|por favor|with|com)\b.*$/i, "")
      .replace(/[."']+$/g, "")
      .trim();
    if (name && !/^(is|named|called)$/i.test(name)) overrides.sheetName = name;
  }
  return overrides;
}

function filenameLines(text: string): string[] {
  return text
    .split(/\r?\n/)
    .map((line) => line.trim().replace(/^[-*]\s+/, ""))
    .filter((line) => {
      if (!line || line.length > 300 || line.startsWith("[") || line.startsWith("**")) return false;
      if (/\.[A-Za-z0-9]{1,5}$/.test(line)) return true;
      return /^[A-Za-z0-9]+(?:-[A-Za-z0-9]+){3,}(?:_[A-Za-z0-9]+)?$/.test(line);
    });
}

function toolCall(name: string, args: Record<string, unknown>): ModelToolCall {
  return { id: `call_${name}_${randomUUID().slice(0, 8)}`, name, arguments: args };
}

function reply(content: string): { content: string; toolCalls: ModelToolCall[] } {
  return { content, toolCalls: [] };
}

export function createScriptedProvider(session: Session): LLMProvider {
  return {
    id: "scripted",
    async complete(messages) {
      const lang = session.replyLang;
      const last = messages[messages.length - 1];
      if (last?.role === "tool") {
        let body: { ok?: boolean; summary?: string } = {};
        try {
          body = JSON.parse(last.content) as { ok?: boolean; summary?: string };
        } catch {
          body = { ok: false, summary: last.content };
        }
        if (last.name === "parse_deliverables") {
          if (!session.register) return reply(body.summary || explainHelp(lang));
          const raw = latestUser(messages);
          if (/\[folder\]/.test(raw) && session.pendingFolderNames?.length) {
            return { content: "", toolCalls: [toolCall("list_folder", { usePending: true })] };
          }
          return reply(explainUnderstanding(session.register, lang));
        }
        if (last.name === "confirm_register") {
          if (session.confirmed && session.pendingFolderNames?.length) {
            return { content: "", toolCalls: [toolCall("list_folder", { usePending: true })] };
          }
          if (session.confirmed && session.folderNames?.length) {
            return { content: "", toolCalls: [toolCall("compare", {})] };
          }
          return reply(explainConfirmed(Boolean(session.folderNames?.length), lang));
        }
        if (last.name === "list_folder") {
          if (!body.ok) return reply(body.summary || explainHelp(lang));
          if (!session.register) {
            return reply(
              lang === "pt"
                ? "Guardei os nomes. Envia primeiro o registo de entregáveis para eu poder conferir."
                : "I stored the names. Send the deliverables register first so I can check them.",
            );
          }
          const raw = latestUser(messages);
          const user = visibleText(raw);
          const sameMessage = /\[folder\]/.test(raw) && /\[attached-files\]/.test(raw);
          if (session.confirmed || wantsAnyway(user) || wantsCheck(user) || sameMessage) {
            return { content: "", toolCalls: [toolCall("compare", {})] };
          }
          return reply(explainNeedConfirm(lang));
        }
        if (last.name === "compare" && session.comparison) {
          const raw = latestUser(messages);
          const comparisonText = explainComparison(session.comparison, lang);
          if (/\[attached-files\]/.test(raw) && session.register) {
            return reply(`${explainUnderstanding(session.register, lang)}\n\n${comparisonText}`);
          }
          return reply(comparisonText);
        }
        return reply(body.summary || explainHelp(lang));
      }

      const raw = latestUser(messages);
      const visible = visibleText(raw);
      const attached = attachmentsIn(raw);
      const registerFile = attached.find((file) => file.kind === "spreadsheet" || file.kind === "pdf");
      const correcting = isCorrection(visible);
      const confirming = isConfirmation(visible) && !correcting;
      const fileId = registerFile?.id || (correcting ? session.registerFileId : null);

      if ((registerFile && (!session.register || correcting)) || (correcting && fileId)) {
        const args: Record<string, unknown> = { fileId, ...extractOverrides(visible) };
        return { content: "", toolCalls: [toolCall("parse_deliverables", args)] };
      }

      if (confirming && session.register) {
        return { content: "", toolCalls: [toolCall("confirm_register", { confirmed: true })] };
      }

      const pasted = filenameLines(visible);
      const folderAttached = /\[folder\]/.test(raw);
      if (folderAttached || pasted.length >= 2) {
        const args: Record<string, unknown> = {};
        if (folderAttached) args.usePending = true;
        if (pasted.length >= 2) args.pastedText = pasted.join("\n");
        return { content: "", toolCalls: [toolCall("list_folder", args)] };
      }

      return reply(explainHelp(lang));
    },
  };
}
