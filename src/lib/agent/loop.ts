import { explainComparison, explainUnderstanding } from "../explain";
import { detectLang } from "../lang";
import { createProvider } from "../llm";
import { buildModelDigest, compactToolContent } from "../llm/compact";
import { extractOverrides, wantsCheck } from "../llm/scripted";
import type { LLMProvider } from "../llm/types";
import { modelFailureText, progressText } from "../progress";
import type { Session } from "../session/store";
import { getTool, getTools } from "../tools";
import { toPublicUnderstanding } from "../tools/builtins";
import type { ToolResult } from "../tools/types";
import type { PublicUnderstanding, ToolTrace } from "../types";
import { systemPrompt } from "./prompt";

const SCRIPTED_ROUNDS = 6;
const LIVE_ROUNDS = 3;
const ARGUMENT_LIMIT = 8_000;

export type AgentHooks = {
  onProgress?: (text: string) => void;
  onTool?: (tool: ToolTrace) => void;
  onContext?: (snapshot: {
    understanding: PublicUnderstanding | null;
    confirmed: boolean;
    folderCount: number;
    comparison: Session["comparison"];
  }) => void;
};

function trimHistory(session: Session): void {
  if (session.messages.length <= 32) return;
  const sliced = session.messages.slice(-24);
  const start = sliced.findIndex((message) => message.role === "user");
  session.messages = start > 0 ? sliced.slice(start) : sliced;
}

function contextSnapshot(session: Session) {
  return {
    understanding: session.register ? toPublicUnderstanding(session.register) : null,
    confirmed: session.confirmed,
    folderCount: session.folderNames?.length ?? 0,
    comparison: session.comparison,
  };
}

async function runTool(name: string, args: Record<string, unknown>, session: Session): Promise<ToolResult> {
  if (JSON.stringify(args).length > ARGUMENT_LIMIT) {
    return {
      ok: false,
      summary: "Tool arguments were too large. Pass a file id or a column name, not the sheet contents.",
    };
  }
  const tool = getTool(name);
  if (!tool) return { ok: false, summary: `Unknown tool ${name}.` };
  try {
    return await tool.execute(args, session);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Tool failed.";
    return { ok: false, summary: message };
  }
}

function stepForTool(name: string): "parse" | "folder" | "compare" | "model" {
  if (name === "parse_deliverables") return "parse";
  if (name === "list_folder") return "folder";
  if (name === "compare") return "compare";
  return "model";
}

function fallbackText(session: Session, failure: string): string {
  const parts: string[] = [];
  if (session.register) parts.push(explainUnderstanding(session.register, session.replyLang));
  if (session.comparison) parts.push(explainComparison(session.comparison, session.replyLang));
  parts.push(modelFailureText(failure, session.replyLang));
  return parts.join("\n\n");
}

export async function runAgent(
  session: Session,
  userText: string,
  composed: string,
  provider?: LLMProvider,
  hooks?: AgentHooks,
): Promise<{ text: string; tools: ToolTrace[] }> {
  session.replyLang = detectLang(userText, session.uiLanguage);
  session.messages.push({ role: "user", content: composed });
  trimHistory(session);
  const active = provider ?? createProvider(session);
  const trace: ToolTrace[] = [];

  const note = (step: ToolTrace) => {
    trace.push(step);
    hooks?.onTool?.(step);
    hooks?.onProgress?.(step.summary);
    hooks?.onContext?.(contextSnapshot(session));
  };

  const live = active.id !== "scripted";
  let prepared = false;
  if (live) {
    const register = [...composed.matchAll(/id:\s*(\S+)\s*\|\s*name:\s*(.*?)\s*\|\s*kind:\s*(spreadsheet|pdf)/g)].at(-1);
    const folderAttached = /\[folder\]/.test(composed);
    if (register || folderAttached) {
      prepared = true;
      if (register) {
        hooks?.onProgress?.(progressText("parse", session.replyLang));
        const result = await runTool("parse_deliverables", { fileId: register[1], ...extractOverrides(userText) }, session);
        note({ name: "parse_deliverables", ok: result.ok, summary: result.summary });
      }
      if (folderAttached) {
        hooks?.onProgress?.(progressText("folder", session.replyLang));
        const result = await runTool("list_folder", { usePending: true }, session);
        note({ name: "list_folder", ok: result.ok, summary: result.summary });
      }
      const sameTurn = Boolean(register) && folderAttached;
      if (session.register && session.folderNames?.length && (sameTurn || session.confirmed || wantsCheck(userText))) {
        hooks?.onProgress?.(progressText("compare", session.replyLang));
        const result = await runTool("compare", {}, session);
        note({ name: "compare", ok: result.ok, summary: result.summary });
      }
      const last = session.messages[session.messages.length - 1];
      if (last?.role === "user") {
        const language = session.replyLang === "pt" ? "Portuguese" : "English";
        const failures = trace
          .filter((step) => !step.ok)
          .map((step) => `${step.name}: ${step.summary}`)
          .join("\n");
        const failureBlock = failures ? `\nTool errors:\n${failures}` : "";
        last.content = `${composed}\n\n[deterministic-result]\n${buildModelDigest(session)}${failureBlock}\n[/deterministic-result]\nReply in ${language}. The tools already ran. Use only this summary. Do not list every deliverable.`;
      }
    }
  }

  const tools = prepared
    ? []
    : getTools().map((tool) => ({
        name: tool.name,
        description: tool.description,
        parameters: tool.parameters,
      }));
  const notes: string[] = [];
  const maxRounds = live ? LIVE_ROUNDS : SCRIPTED_ROUNDS;

  try {
    for (let round = 0; round < maxRounds; round += 1) {
      hooks?.onProgress?.(progressText("model", session.replyLang));
      const turn = await active.complete(
        [{ role: "system", content: systemPrompt(session) }, ...session.messages],
        tools,
      );
      if (!turn.toolCalls.length || prepared) {
        const spoken = turn.content.trim();
        const finalText = spoken
          ? notes.length
            ? `${notes.join("\n\n")}\n\n${spoken}`
            : spoken
          : notes.join("\n\n") || fallbackText(session, "The model returned an empty reply.");
        session.messages.push({ role: "assistant", content: finalText });
        return { text: finalText, tools: trace };
      }
      if (turn.content.trim()) notes.push(turn.content.trim());
      session.messages.push({ role: "assistant", content: turn.content.trim(), toolCalls: turn.toolCalls });
      for (const call of turn.toolCalls) {
        const argumentError = typeof call.arguments.__argumentError === "string" ? call.arguments.__argumentError : "";
        hooks?.onProgress?.(progressText(stepForTool(call.name), session.replyLang));
        const result = argumentError
          ? { ok: false, summary: argumentError }
          : await runTool(call.name, call.arguments, session);
        note({ name: call.name, ok: result.ok, summary: result.summary });
        session.messages.push({
          role: "tool",
          name: call.name,
          toolCallId: call.id,
          content: compactToolContent(result),
        });
      }
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : "The model request failed.";
    hooks?.onProgress?.(message);
    const text = fallbackText(session, message);
    session.messages.push({ role: "assistant", content: text });
    return { text, tools: trace };
  }

  const stopped =
    session.replyLang === "pt"
      ? "Parei depois de várias chamadas de ferramentas. Tenta de novo com um pedido mais curto."
      : "I stopped after several tool calls. Try the request again in a shorter step.";
  const text = notes.length ? `${notes.join("\n\n")}\n\n${stopped}` : stopped;
  session.messages.push({ role: "assistant", content: text });
  return { text, tools: trace };
}
