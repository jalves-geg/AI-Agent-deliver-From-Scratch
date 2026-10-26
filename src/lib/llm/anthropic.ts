import type { AppConfig } from "../config";
import type { ModelMessage, ModelToolCall } from "../types";
import { messageText, type LLMProvider, type ProviderTool } from "./types";

export function anthropicMessagesUrl(baseUrl: string): string {
  const base = baseUrl.replace(/\/$/, "");
  if (base.endsWith("/v1")) return `${base}/messages`;
  return `${base}/v1/messages`;
}

export function toAnthropicRequest(messages: ModelMessage[], tools: ProviderTool[], model: string) {
  const system = messages
    .filter((message) => message.role === "system")
    .map((message) => message.content)
    .join("\n\n");
  const converted: { role: "user" | "assistant"; content: unknown }[] = [];
  for (const message of messages) {
    if (message.role === "system") continue;
    if (message.role === "user") {
      converted.push({ role: "user", content: message.content });
      continue;
    }
    if (message.role === "assistant") {
      const content: unknown[] = [];
      if (message.content) content.push({ type: "text", text: message.content });
      for (const call of message.toolCalls ?? []) {
        content.push({ type: "tool_use", id: call.id, name: call.name, input: call.arguments });
      }
      converted.push({
        role: "assistant",
        content: content.length > 0 ? content : [{ type: "text", text: "" }],
      });
      continue;
    }
    const block = { type: "tool_result", tool_use_id: message.toolCallId, content: message.content };
    const previous = converted[converted.length - 1];
    if (previous?.role === "user" && Array.isArray(previous.content)) {
      previous.content.push(block);
    } else {
      converted.push({ role: "user", content: [block] });
    }
  }
  return {
    model,
    max_tokens: 4096,
    temperature: 0.2,
    system,
    tools: tools.map((tool) => ({
      name: tool.name,
      description: tool.description,
      input_schema: tool.parameters,
    })),
    messages: converted,
  };
}

export function createAnthropicProvider(config: AppConfig): LLMProvider {
  return {
    id: "anthropic",
    async complete(messages, tools) {
      if (!config.apiKey) throw new Error("No API key is configured.");
      const response = await fetch(anthropicMessagesUrl(config.baseUrl), {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-api-key": config.apiKey,
          "anthropic-version": "2023-06-01",
        },
        body: JSON.stringify(toAnthropicRequest(messages, tools, config.model)),
        signal: AbortSignal.timeout(120_000),
      });
      const payload = (await response.json().catch(() => ({}))) as {
        error?: { message?: string };
        content?: { type?: string; text?: string; id?: string; name?: string; input?: Record<string, unknown> }[];
      };
      if (!response.ok) {
        const detail = payload.error?.message || response.statusText || "request failed";
        throw new Error(`Model provider error (${response.status}): ${detail}`);
      }
      const blocks = payload.content ?? [];
      const toolCalls: ModelToolCall[] = blocks
        .filter((block) => block.type === "tool_use" && block.name)
        .map((block, index) => ({
          id: block.id || `call_${index}`,
          name: block.name || "",
          arguments: block.input ?? {},
        }));
      return { content: messageText(blocks.filter((block) => block.type === "text")), toolCalls };
    },
  };
}
