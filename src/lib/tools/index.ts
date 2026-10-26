// Built-in tools register themselves on import. To add a tool, create a
// module that calls registerTool(...) and import it from this file.
import "./builtins";

export { getTool, getTools, registerTool } from "./registry";
export type { Tool, ToolResult } from "./types";
