import { chatCompletionsUrl, type AppConfig } from "../config";
import type { ModelMessage, ModelToolCall } from "../types";
import { messageText, parseToolArguments, type LLMProvider, type ProviderTool } from "./types";

function toOpenAIMessage(message: ModelMessage): Record<string, unknown> {
  if (message.role === "tool") {
    return { role: "tool", tool_call_id: message.toolCallId, content: message.content };
  }
  if (message.role === "assistant" && message.toolCalls?.length) {
    return {
      role: "assistant",
      content: message.content || null,
      tool_calls: message.toolCalls.map((call) => ({
        id: call.id,
        type: "function",
        function: { name: call.name, arguments: JSON.stringify(call.arguments) },
      })),
    };
  }
  return { role: message.role, content: message.content };
}

export function createOpenAICompatibleProvider(config: AppConfig): LLMProvider {
  return {
    id: config.provider,
    async complete(messages, tools) {
      if (!config.baseUrl) {
        throw new Error("LLM_BASE_URL is empty. Set it in .env.local for this provider.");
      }
      if (!config.apiKey) throw new Error("No API key is configured.");
      if (config.provider === "azure" && !config.azureDeployment && !config.model) {
        throw new Error("Set AZURE_OPENAI_DEPLOYMENT to your Azure OpenAI deployment name.");
      }
      const url = chatCompletionsUrl(config);
      const body: Record<string, unknown> = {
        messages: messages.map(toOpenAIMessage),
        tools: tools.map((tool: ProviderTool) => ({
          type: "function",
          function: {
            name: tool.name,
            description: tool.description,
            parameters: tool.parameters,
          },
        })),
        temperature: 0.2,
      };
      if (config.provider !== "azure") body.model = config.model;
      const headers: Record<string, string> = { "Content-Type": "application/json" };
      if (config.provider === "azure") headers["api-key"] = config.apiKey;
      else headers.Authorization = `Bearer ${config.apiKey}`;

      const response = await fetch(url, {
        method: "POST",
        headers,
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(120_000),
      });
      const payload = (await response.json().catch(() => ({}))) as {
        error?: { message?: string };
        choices?: { message?: { content?: unknown; tool_calls?: { id?: string; function?: { name?: string; arguments?: unknown } }[] } }[];
      };
      if (!response.ok) {
        const detail = payload.error?.message || response.statusText || "request failed";
        throw new Error(`Model provider error (${response.status}): ${detail}`);
      }
      const message = payload.choices?.[0]?.message;
      const toolCalls: ModelToolCall[] = (message?.tool_calls ?? []).map((call, index) => {
        const parsed = parseToolArguments(call.function?.arguments);
        return {
          id: call.id || `call_${index}`,
          name: call.function?.name || "",
          arguments: parsed.error ? { __argumentError: parsed.error } : parsed.args,
        };
      });
      return { content: messageText(message?.content), toolCalls };
    },
  };
}
