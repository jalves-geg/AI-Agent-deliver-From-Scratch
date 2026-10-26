import type { Session } from "../session/store";

export type JsonSchema = {
  type: "object";
  properties: Record<string, unknown>;
  required?: string[];
  additionalProperties?: boolean;
};

export type ToolResult = {
  ok: boolean;
  summary: string;
  data?: unknown;
};

export type Tool = {
  name: string;
  description: string;
  parameters: JsonSchema;
  execute: (args: Record<string, unknown>, session: Session) => Promise<ToolResult> | ToolResult;
};
