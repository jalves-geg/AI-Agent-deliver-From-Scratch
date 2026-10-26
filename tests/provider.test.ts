import http from "node:http";
import { afterEach, describe, expect, it } from "vitest";
import { runAgent } from "@/lib/agent/loop";
import { composeUserContent } from "@/lib/chatTurn";
import { chatCompletionsUrl, loadConfig } from "@/lib/config";
import { buildSyntheticBundle } from "@/lib/demo/synthetic";
import { anthropicMessagesUrl, toAnthropicRequest } from "@/lib/llm/anthropic";
import { createProvider } from "@/lib/llm";
import { ensureSession, putFile, resetSessions } from "@/lib/session/store";

const bundle = buildSyntheticBundle();
const ORIGINAL = { ...process.env };

afterEach(() => {
  for (const key of Object.keys(process.env)) {
    if (!(key in ORIGINAL)) delete process.env[key];
  }
  Object.assign(process.env, ORIGINAL);
  resetSessions();
});

describe("provider adapter", () => {
  it("defaults to xAI and stays in demo mode without a key", () => {
    delete process.env.LLM_API_KEY;
    delete process.env.XAI_API_KEY;
    delete process.env.LLM_PROVIDER;
    delete process.env.LLM_BASE_URL;
    delete process.env.GEG_DEMO_MODE;
    const config = loadConfig();
    expect(config.provider).toBe("xai");
    expect(config.baseUrl).toBe("https://api.x.ai/v1");
    expect(config.model).toBe("grok-4.7");
    expect(config.demoMode).toBe(true);
    expect(chatCompletionsUrl(config)).toBe("https://api.x.ai/v1/chat/completions");
  });

  it("builds an Azure deployments URL", () => {
    const config = loadConfig({
      LLM_PROVIDER: "azure",
      LLM_API_KEY: "azure-key",
      AZURE_OPENAI_ENDPOINT: "https://geg.openai.azure.com/",
      AZURE_OPENAI_DEPLOYMENT: "deliverables",
      AZURE_OPENAI_API_VERSION: "2024-10-21",
    } as unknown as NodeJS.ProcessEnv);
    expect(chatCompletionsUrl(config)).toBe(
      "https://geg.openai.azure.com/openai/deployments/deliverables/chat/completions?api-version=2024-10-21",
    );
    expect(config.demoMode).toBe(false);
  });

  it("shapes an Anthropic tool-calling request", () => {
    expect(anthropicMessagesUrl("https://api.anthropic.com")).toBe("https://api.anthropic.com/v1/messages");
    const body = toAnthropicRequest(
      [
        { role: "system", content: "Be brief." },
        { role: "user", content: "Read the register." },
        {
          role: "assistant",
          content: "",
          toolCalls: [{ id: "toolu_1", name: "parse_deliverables", arguments: { fileId: "f1" } }],
        },
        { role: "tool", toolCallId: "toolu_1", name: "parse_deliverables", content: "{\"ok\":true}" },
      ],
      [{ name: "parse_deliverables", description: "Read a register", parameters: { type: "object", properties: {} } }],
      "claude-sonnet-4-5",
    );
    expect(body.system).toBe("Be brief.");
    expect(body.tools[0].input_schema.type).toBe("object");
    expect(body.messages[1].content).toEqual([
      { type: "tool_use", id: "toolu_1", name: "parse_deliverables", input: { fileId: "f1" } },
    ]);
    expect(body.messages[2].content).toEqual([
      { type: "tool_result", tool_use_id: "toolu_1", content: "{\"ok\":true}" },
    ]);
  });

  it("runs the real tool loop against an OpenAI-compatible endpoint when a key is set", async () => {
    const requests: { authorization?: string; body: { tools: { function: { name: string } }[]; messages: { role: string }[] } }[] = [];
    const server = http.createServer((request, response) => {
      let raw = "";
      request.on("data", (chunk) => {
        raw += chunk;
      });
      request.on("end", () => {
        const body = JSON.parse(raw) as { tools: { function: { name: string } }[]; messages: { role: string; content?: string }[] };
        requests.push({ authorization: request.headers.authorization, body });
        const last = body.messages[body.messages.length - 1];
        response.setHeader("Content-Type", "application/json");
        if (last.role === "user") {
          response.end(JSON.stringify({
            choices: [{
              message: {
                content: "",
                tool_calls: [{
                  id: "call_parse",
                  type: "function",
                  function: { name: "parse_deliverables", arguments: JSON.stringify({ fileId: "file-live" }) },
                }],
              },
            }],
          }));
          return;
        }
        response.end(JSON.stringify({
          choices: [{ message: { role: "assistant", content: "I read the register and I am waiting for confirmation." } }],
        }));
      });
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("no port");
    process.env.LLM_PROVIDER = "openai-compatible";
    process.env.LLM_API_KEY = "test-key";
    process.env.LLM_MODEL = "local-test";
    process.env.LLM_BASE_URL = `http://127.0.0.1:${address.port}/v1`;
    delete process.env.GEG_DEMO_MODE;

    const session = ensureSession("session-live");
    putFile(session, {
      id: "file-live",
      name: bundle.fileName,
      mime: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      kind: "spreadsheet",
      buffer: bundle.registerXlsx,
    });
    const provider = createProvider(session, false);
    expect(provider.id).toBe("openai-compatible");
    const result = await runAgent(
      session,
      "Please read the attached register.",
      composeUserContent({
        text: "Please read the attached register.",
        files: [{ id: "file-live", name: bundle.fileName, kind: "spreadsheet" }],
        folderCount: 0,
      }),
      provider,
    );
    server.close();

    expect(requests[0].authorization).toBe("Bearer test-key");
    expect(requests[0].body.tools.map((tool) => tool.function.name)).toEqual([
      "parse_deliverables",
      "confirm_register",
      "list_folder",
      "compare",
    ]);
    expect(requests).toHaveLength(2);
    expect(session.register?.deliverableCount).toBe(36);
    expect(session.register?.headerRow).toBe(11);
    expect(result.tools[0]).toMatchObject({ name: "parse_deliverables", ok: true });
    expect(result.text).toMatch(/waiting for confirmation/i);
  });
});
