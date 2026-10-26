import { randomUUID } from "node:crypto";
import { runAgent } from "@/lib/agent/loop";
import type { ChatEvent } from "@/lib/chatEvents";
import { composeUserContent } from "@/lib/chatTurn";
import { isLang, json, sessionView } from "@/lib/http";
import { createProvider } from "@/lib/llm";
import { ensureSession } from "@/lib/session/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type ChatBody = {
  sessionId?: string;
  text?: string;
  fileIds?: string[];
  folderNames?: string[];
  demo?: boolean;
  lang?: string;
};

export async function POST(request: Request) {
  const body = (await request.json().catch(() => null)) as ChatBody | null;
  if (!body) return json({ error: "Send a JSON body." }, 400);
  const text = String(body.text ?? "").slice(0, 20_000);
  const fileIds = Array.isArray(body.fileIds) ? body.fileIds.filter((id): id is string => typeof id === "string") : [];
  const folderNames = Array.isArray(body.folderNames)
    ? body.folderNames.filter((name): name is string => typeof name === "string" && name.trim().length > 0).slice(0, 20_000)
    : [];
  if (!text.trim() && fileIds.length === 0 && folderNames.length === 0) {
    return json({ error: "Write a message or attach a register or folder." }, 400);
  }

  const session = ensureSession(body.sessionId);
  if (isLang(body.lang)) session.uiLanguage = body.lang;
  if (folderNames.length > 0) session.pendingFolderNames = folderNames;

  const files = fileIds.flatMap((id) => {
    const file = session.files.get(id);
    return file ? [{ id: file.id, name: file.name, kind: file.kind }] : [];
  });
  const composed = composeUserContent({
    text,
    files,
    folderCount: session.pendingFolderNames?.length ?? 0,
  });
  const display = text.trim() || (session.uiLanguage === "pt" ? "Segue o anexo." : "Attached.");
  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    async start(controller) {
      const send = (event: ChatEvent) => {
        controller.enqueue(encoder.encode(`${JSON.stringify(event)}\n`));
      };
      try {
        const provider = createProvider(session, body.demo === true);
        const result = await runAgent(session, text, composed, provider, {
          onProgress: (progress) => send({ type: "progress", text: progress }),
          onTool: (tool) => send({ type: "tool", tool }),
          onContext: (snapshot) => send({ type: "context", ...snapshot }),
        });
        session.uiMessages.push({
          id: randomUUID(),
          role: "user",
          text: display,
          attachments: files.map((file) => file.name),
          folderCount: folderNames.length || undefined,
        });
        session.uiMessages.push({
          id: randomUUID(),
          role: "assistant",
          text: result.text,
          tools: result.tools,
          showComparison: Boolean(session.comparison) && result.tools.some((tool) => tool.name === "compare" && tool.ok),
        });
        send({ type: "done", session: sessionView(session) });
      } catch (error) {
        const message = error instanceof Error ? error.message : "The assistant failed.";
        console.error("chat failed:", message);
        send({ type: "error", message });
        session.uiMessages.push({
          id: randomUUID(),
          role: "user",
          text: display,
          attachments: files.map((file) => file.name),
          folderCount: folderNames.length || undefined,
        });
        session.uiMessages.push({
          id: randomUUID(),
          role: "assistant",
          text: message,
        });
        send({ type: "done", session: sessionView(session) });
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "application/x-ndjson; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      "X-Accel-Buffering": "no",
    },
  });
}
