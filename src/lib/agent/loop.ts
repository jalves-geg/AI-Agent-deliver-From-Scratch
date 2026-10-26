import { detectLang } from "../lang";
import { createProvider } from "../llm";
import type { LLMProvider } from "../llm/types";
import type { Session } from "../session/store";
import { getTool, getTools } from "../tools";
import type { ToolTrace } from "../types";
import { systemPrompt } from "./prompt";

const MAX_ROUNDS = 6;

function trimHistory(session: Session): void {
  if (session.messages.length <= 32) return;
  const sliced = session.messages.slice(-24);
  const start = sliced.findIndex((message) => message.role === "user");
  session.messages = start > 0 ? sliced.slice(start) : sliced;
}

export async function runAgent(
  session: Session,
  userText: string,
  composed: string,
  provider?: LLMProvider,
): Promise<{ text: string; tools: ToolTrace[] }> {
  session.replyLang = detectLang(userText, session.uiLanguage);
  session.messages.push({ role: "user", content: composed });
  trimHistory(session);
  const active = provider ?? createProvider(session);
  const tools = getTools().map((tool) => ({
    name: tool.name,
    description: tool.description,
    parameters: tool.parameters,
  }));
  const trace: ToolTrace[] = [];
  const notes: string[] = [];

  for (let round = 0; round < MAX_ROUNDS; round += 1) {
    const turn = await active.complete(
      [{ role: "system", content: systemPrompt(session) }, ...session.messages],
      tools,
    );
    if (!turn.toolCalls.length) {
      const finalText = turn.content.trim()
        ? notes.length
          ? `${notes.join("\n\n")}\n\n${turn.content.trim()}`
          : turn.content.trim()
        : notes.join("\n\n");
      session.messages.push({ role: "assistant", content: finalText });
      return { text: finalText, tools: trace };
    }
    if (turn.content.trim()) notes.push(turn.content.trim());
    session.messages.push({ role: "assistant", content: turn.content.trim(), toolCalls: turn.toolCalls });
    for (const call of turn.toolCalls) {
      const argumentError =
        typeof call.arguments.__argumentError === "string" ? call.arguments.__argumentError : "";
      const tool = getTool(call.name);
      let result;
      if (argumentError) {
        result = { ok: false, summary: argumentError };
      } else if (!tool) {
        result = { ok: false, summary: `Unknown tool ${call.name}.` };
      } else {
        try {
          result = await tool.execute(call.arguments, session);
        } catch (error) {
          const message = error instanceof Error ? error.message : "Tool failed.";
          result = { ok: false, summary: message };
        }
      }
      trace.push({ name: call.name, ok: result.ok, summary: result.summary });
      session.messages.push({
        role: "tool",
        name: call.name,
        toolCallId: call.id,
        content: JSON.stringify(result),
      });
    }
  }

  const stopped =
    session.replyLang === "pt"
      ? "Parei depois de várias chamadas de ferramentas. Tenta de novo com um pedido mais curto."
      : "I stopped after several tool calls. Try the request again in a shorter step.";
  const text = notes.length ? `${notes.join("\n\n")}\n\n${stopped}` : stopped;
  session.messages.push({ role: "assistant", content: text });
  return { text, tools: trace };
}
