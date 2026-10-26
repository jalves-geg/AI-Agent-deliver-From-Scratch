import http from "node:http";
import { afterEach, describe, expect, it } from "vitest";
import * as XLSX from "xlsx";
import { POST as chat } from "@/app/api/chat/route";
import { runAgent } from "@/lib/agent/loop";
import { readChatEvents } from "@/lib/chatEvents";
import { composeUserContent } from "@/lib/chatTurn";
import { chatCompletionsUrl, loadConfig } from "@/lib/config";
import { buildSyntheticBundle } from "@/lib/demo/synthetic";
import { detectLang } from "@/lib/lang";
import { anthropicMessagesUrl, toAnthropicRequest } from "@/lib/llm/anthropic";
import { createProvider } from "@/lib/llm";
import { ensureSession, putFile, resetSessions } from "@/lib/session/store";

const bundle = buildSyntheticBundle();
const ORIGINAL = { ...process.env };
const QUESTION = "Consegues verificar se os desenhos estao direitos com a LOD e o que falta?";

function documentNumber(index: number, revision = "E"): string {
  return `05-732800-4200000103-BOF-SUS-RPT-${String(index + 1).padStart(6, "0")}_${revision}`;
}

function buildLargeRegister(): Buffer {
  const rows: string[][] = [
    ["Project", "Synthetic large"],
    ["", ""],
    ["", ""],
    ["", ""],
    ["", ""],
    ["", ""],
    ["", ""],
    ["", ""],
    ["", ""],
    ["", ""],
    ["Item", "Drawing Numbering", "Title"],
  ];
  for (let index = 0; index < 1700; index += 1) {
    if (index % 100 === 0) rows.push([`FOLDER ${String(Math.floor(index / 100) + 1).padStart(2, "0")} - BOOK 01`]);
    rows.push([String(index + 1), documentNumber(index), `Doc ${index + 1}`]);
  }
  const book = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(book, XLSX.utils.aoa_to_sheet(rows), "Register");
  return XLSX.write(book, { type: "buffer", bookType: "xlsx" }) as Buffer;
}

const largeRegister = buildLargeRegister();
const largeFolder = [
  ...Array.from({ length: 12 }, (_, index) => `FOLDER/${documentNumber(index)}.pdf`),
  `FOLDER/${documentNumber(12, "F")}.pdf`,
  `FOLDER/${documentNumber(13, "F")}.dwg`,
  "FOLDER/05-999999-0000000001-XXX-AAA-RPT-000001_A.pdf",
  "FOLDER/05-999999-0000000002-XXX-BBB-DWG-100001_B.pdf",
];

function documentHits(raw: string): number {
  return raw.match(/05-732800-4200000103-BOF-SUS-RPT-\d+_[A-Za-z0-9]+/g)?.length ?? 0;
}

function useMock(port: number): void {
  process.env.LLM_PROVIDER = "openai-compatible";
  process.env.LLM_API_KEY = "test-key";
  process.env.LLM_MODEL = "local-test";
  process.env.LLM_BASE_URL = `http://127.0.0.1:${port}/v1`;
  process.env.LLM_TIMEOUT_MS = "35000";
  delete process.env.GEG_DEMO_MODE;
}

function stop(server: http.Server): void {
  server.closeAllConnections?.();
  server.close();
}

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
    expect(body.tools?.[0]?.input_schema.type).toBe("object");
    expect(body.messages[1].content).toEqual([
      { type: "tool_use", id: "toolu_1", name: "parse_deliverables", input: { fileId: "f1" } },
    ]);
    expect(body.messages[2].content).toEqual([
      { type: "tool_result", tool_use_id: "toolu_1", content: "{\"ok\":true}" },
    ]);
  });

  it("parses an attached register before one compact model call", async () => {
    const requests: { authorization?: string; raw: string }[] = [];
    const server = http.createServer((request, response) => {
      let raw = "";
      request.on("data", (chunk) => {
        raw += chunk;
      });
      request.on("end", () => {
        requests.push({ authorization: request.headers.authorization, raw });
        response.setHeader("Content-Type", "application/json");
        response.end(JSON.stringify({
          choices: [{ message: { role: "assistant", content: "I read the register and I am waiting for confirmation." } }],
        }));
      });
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("no port");
    useMock(address.port);

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
    try {
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
      expect(requests).toHaveLength(1);
      expect(requests[0].authorization).toBe("Bearer test-key");
      const body = JSON.parse(requests[0].raw) as { tools?: unknown; messages: { content?: string }[] };
      expect(body.tools).toBeUndefined();
      expect(requests[0].raw).toContain("Deliverables: 36");
      expect(requests[0].raw).toContain("Header row: 11");
      expect(documentHits(requests[0].raw)).toBeLessThan(20);
      expect(session.register?.deliverableCount).toBe(36);
      expect(session.register?.headerRow).toBe(11);
      expect(result.tools[0]).toMatchObject({ name: "parse_deliverables", ok: true });
      expect(result.text).toMatch(/waiting for confirmation/i);
    } finally {
      stop(server);
    }
  });

  it("still offers tools when the live turn has no attachment", async () => {
    const requests: { raw: string }[] = [];
    const server = http.createServer((request, response) => {
      let raw = "";
      request.on("data", (chunk) => {
        raw += chunk;
      });
      request.on("end", () => {
        requests.push({ raw });
        response.setHeader("Content-Type", "application/json");
        response.end(JSON.stringify({
          choices: [{ message: { role: "assistant", content: "Send the deliverables register." } }],
        }));
      });
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("no port");
    useMock(address.port);
    const session = ensureSession("session-tools");
    const provider = createProvider(session, false);
    try {
      await runAgent(session, "Hello", "Hello", provider);
      const body = JSON.parse(requests[0].raw) as { tools: { function: { name: string } }[] };
      expect(body.tools.map((tool) => tool.function.name)).toEqual([
        "parse_deliverables",
        "confirm_register",
        "list_folder",
        "compare",
      ]);
    } finally {
      stop(server);
    }
  });

  it("checks a 1700-row register and a folder in one Portuguese message without sending the sheet", async () => {
    expect(detectLang(QUESTION, "en")).toBe("pt");
    const requests: string[] = [];
    const server = http.createServer((request, response) => {
      let raw = "";
      request.on("data", (chunk) => {
        raw += chunk;
      });
      request.on("end", () => {
        requests.push(raw);
        response.setHeader("Content-Type", "application/json");
        response.end(JSON.stringify({
          choices: [{
            message: {
              role: "assistant",
              content: "Os desenhos não estão todos certos: há revisões diferentes e ficheiros em falta. A tabela tem o detalhe.",
            },
          }],
        }));
      });
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("no port");
    useMock(address.port);
    const session = ensureSession("session-large");
    session.uiLanguage = "en";
    putFile(session, {
      id: "file-large",
      name: "synthetic-large-register.xlsx",
      mime: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      kind: "spreadsheet",
      buffer: largeRegister,
    });
    try {
      const response = await chat(new Request("http://local/api/chat", {
        method: "POST",
        body: JSON.stringify({
          sessionId: session.id,
          text: QUESTION,
          fileIds: ["file-large"],
          folderNames: largeFolder,
          demo: false,
          lang: "en",
        }),
      }));
      expect(response.status).toBe(200);
      const events = await readChatEvents(response);
      expect(events.map((event) => event.type)).toEqual(expect.arrayContaining(["progress", "tool", "context", "done"]));
      expect(events.some((event) => event.type === "progress" && event.text === "A ler o registo…")).toBe(true);
      const parsed = events.find(
        (event) => event.type === "context" && event.understanding?.deliverableCount === 1700 && event.understanding.headerRow === 11,
      );
      expect(parsed && parsed.type === "context" ? parsed.understanding?.numberColumn : "").toBe("Drawing Numbering");
      const done = events.find((event) => event.type === "done");
      if (!done || done.type !== "done") throw new Error("missing done event");
      expect(done.session.understanding).toMatchObject({
        headerRow: 11,
        numberColumn: "Drawing Numbering",
        deliverableCount: 1700,
      });
      expect(done.session.comparison).toMatchObject({
        expected: 1700,
        folderFiles: 16,
        ok: 12,
        wrongRevision: 2,
        missing: 1686,
        extra: 2,
      });
      expect(done.session.messages.at(-1)?.text).toMatch(/ficheiros em falta/);
      expect(done.session.messages.at(-1)?.text).not.toMatch(/Header row/);
      expect(requests).toHaveLength(1);
      const body = JSON.parse(requests[0]) as { tools?: unknown };
      expect(body.tools).toBeUndefined();
      expect(requests[0]).toContain("Reply in Portuguese");
      expect(requests[0]).toContain("Deliverables: 1700");
      expect(requests[0]).toContain("Header row: 11");
      expect(requests[0]).not.toContain("001700_E");
      expect(documentHits(requests[0])).toBeLessThan(40);
      expect(requests[0].length).toBeLessThan(25_000);
    } finally {
      stop(server);
    }
  }, 20_000);

  it("returns the parsed register when the model never answers", async () => {
    const server = http.createServer((request) => {
      request.on("error", () => {});
      request.on("data", () => {});
      request.on("end", () => {});
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("no port");
    useMock(address.port);
    process.env.LLM_TIMEOUT_MS = "1000";
    const session = ensureSession("session-hang");
    putFile(session, {
      id: "file-hang",
      name: "synthetic-large-register.xlsx",
      mime: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      kind: "spreadsheet",
      buffer: largeRegister,
    });
    const started = Date.now();
    try {
      const response = await chat(new Request("http://local/api/chat", {
        method: "POST",
        body: JSON.stringify({
          sessionId: session.id,
          text: QUESTION,
          fileIds: ["file-hang"],
          folderNames: largeFolder,
          demo: false,
          lang: "en",
        }),
      }));
      const events = await readChatEvents(response);
      const done = events.find((event) => event.type === "done");
      if (!done || done.type !== "done") throw new Error("missing done event");
      expect(Date.now() - started).toBeLessThan(8_000);
      expect(done.session.understanding).toMatchObject({
        headerRow: 11,
        numberColumn: "Drawing Numbering",
        deliverableCount: 1700,
      });
      expect(done.session.folderCount).toBe(16);
      expect(done.session.comparison?.missing).toBe(1686);
      const reply = done.session.messages.at(-1)?.text ?? "";
      expect(reply).toMatch(/O modelo falhou/);
      expect(reply).toMatch(/timed out/i);
      expect(reply).toMatch(/Linha de cabeçalho: 11/);
      expect(reply).toMatch(/Entregáveis: 1700/);
      expect(events.some((event) => event.type === "context" && event.understanding?.deliverableCount === 1700)).toBe(true);
    } finally {
      stop(server);
    }
  }, 20_000);

  it("puts a provider error in the chat and keeps the parsed register", async () => {
    const server = http.createServer((request, response) => {
      request.on("data", () => {});
      request.on("end", () => {
        response.writeHead(500, { "Content-Type": "application/json" });
        response.end(JSON.stringify({ error: { message: "token limit exceeded" } }));
      });
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("no port");
    useMock(address.port);
    const session = ensureSession("session-error");
    putFile(session, {
      id: "file-error",
      name: "synthetic-large-register.xlsx",
      mime: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      kind: "spreadsheet",
      buffer: largeRegister,
    });
    try {
      const response = await chat(new Request("http://local/api/chat", {
        method: "POST",
        body: JSON.stringify({
          sessionId: session.id,
          text: QUESTION,
          fileIds: ["file-error"],
          folderNames: largeFolder.slice(0, 16),
          demo: false,
        }),
      }));
      const events = await readChatEvents(response);
      const done = events.find((event) => event.type === "done");
      if (!done || done.type !== "done") throw new Error("missing done event");
      expect(done.session.understanding?.deliverableCount).toBe(1700);
      expect(done.session.messages.at(-1)?.text).toMatch(/token limit exceeded/);
      expect(done.session.messages.at(-1)?.text).toMatch(/O modelo falhou/);
    } finally {
      stop(server);
    }
  }, 20_000);
});
