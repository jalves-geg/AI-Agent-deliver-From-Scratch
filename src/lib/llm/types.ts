import type { JsonSchema } from "../tools/types";
import type { ModelMessage, ModelToolCall } from "../types";

export type ProviderTool = {
  name: string;
  description: string;
  parameters: JsonSchema;
};

export type ProviderTurn = {
  content: string;
  toolCalls: ModelToolCall[];
};

export type LLMProvider = {
  id: string;
  complete(messages: ModelMessage[], tools: ProviderTool[]): Promise<ProviderTurn>;
};

export function parseToolArguments(raw: unknown): { args: Record<string, unknown>; error?: string } {
  if (raw && typeof raw === "object" && !Array.isArray(raw)) {
    return { args: raw as Record<string, unknown> };
  }
  if (typeof raw !== "string" || !raw.trim()) return { args: {} };
  const trimmed = raw.trim().replace(/^```(?:json)?/i, "").replace(/```$/i, "").trim();
  try {
    const value = JSON.parse(trimmed) as unknown;
    if (value && typeof value === "object" && !Array.isArray(value)) {
      return { args: value as Record<string, unknown> };
    }
    return { args: {}, error: "Tool arguments were not an object." };
  } catch {
    return { args: {}, error: "Could not parse tool arguments." };
  }
}

export function messageText(content: unknown): string {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content
      .map((part) => {
        if (typeof part === "string") return part;
        if (part && typeof part === "object" && "text" in part && typeof part.text === "string") return part.text;
        return "";
      })
      .join("");
  }
  return "";
}
