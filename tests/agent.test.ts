import { beforeEach, describe, expect, it } from "vitest";
import { POST as chat } from "@/app/api/chat/route";
import { POST as seed } from "@/app/api/demo/seed/route";
import { GET as exportCheck } from "@/app/api/export/route";
import { runAgent } from "@/lib/agent/loop";
import { readChatEvents, type SessionSnapshot } from "@/lib/chatEvents";
import { composeUserContent } from "@/lib/chatTurn";
import { buildSyntheticBundle } from "@/lib/demo/synthetic";
import { extractOverrides } from "@/lib/llm/scripted";
import { createScriptedProvider } from "@/lib/llm/scripted";
import { ensureSession, putFile, resetSessions } from "@/lib/session/store";
import { getTools } from "@/lib/tools";

const bundle = buildSyntheticBundle();

beforeEach(() => {
  resetSessions();
});

function sessionWithRegister() {
  const session = ensureSession("session-demo-1");
  putFile(session, {
    name: bundle.fileName,
    mime: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    kind: "spreadsheet",
    buffer: bundle.registerXlsx,
    id: "file-register",
  });
  return session;
}

async function say(
  sessionId: string,
  text: string,
  extra: { fileIds?: string[]; folderNames?: string[]; lang?: "pt" | "en"; demo?: boolean } = {},
): Promise<SessionSnapshot> {
  const response = await chat(
    new Request("http://local/api/chat", {
      method: "POST",
      body: JSON.stringify({ sessionId, text, demo: true, ...extra }),
    }),
  );
  expect(response.status).toBe(200);
  const events = await readChatEvents(response);
  const done = events.find((event) => event.type === "done");
  if (!done || done.type !== "done") throw new Error(`Chat stream had no done event (${events.map((event) => event.type).join(", ")}).`);
  return done.session;
}

describe("scripted agent", () => {
  it("registers the check tools", () => {
    expect(getTools().map((tool) => tool.name)).toEqual([
      "parse_deliverables",
      "confirm_register",
      "list_folder",
      "compare",
    ]);
  });

  it("reads, confirms, and checks in English", async () => {
    const seeded = await seed(new Request("http://local/api/demo/seed", { method: "POST", body: JSON.stringify({ sessionId: "demo-en-session" }) }));
    const seedBody = await seeded.json();
    const first = await say("demo-en-session", "Here is the deliverables register. Please read it and tell me what you understood.", {
      fileIds: [seedBody.fileId],
    });
    expect(first.understanding?.headerRow).toBe(11);
    expect(first.understanding?.numberColumn).toBe("Drawing Numbering");
    expect(first.understanding?.deliverableCount).toBe(36);
    expect(first.understanding?.pattern?.expression).toContain("{SheetType}{Chapter}{Serial}_{Rev}");
    expect(first.confirmed).toBe(false);
    expect(first.messages.at(-1)?.text).toMatch(/Header row: 11/);
    expect(first.messages.at(-1)?.text).toMatch(/Is that right/);

    const second = await say("demo-en-session", "Yes, that's correct.");
    expect(second.confirmed).toBe(true);
    expect(second.comparison).toBeNull();

    const third = await say("demo-en-session", "Please check this folder against the register.", {
      folderNames: seedBody.folderNames,
    });
    expect(third.comparison).toMatchObject({ ok: 32, wrongRevision: 2, missing: 2, extra: 3 });
    expect(third.messages.at(-1)?.text).toMatch(/expected `E`, found `F`|expected `A`, found `B`/);
    expect(third.messages.at(-1)?.showComparison).toBe(true);

    const exported = await exportCheck(new Request("http://local/api/export?sessionId=demo-en-session&format=csv&lang=en"));
    const csv = await exported.text();
    expect(exported.status).toBe(200);
    expect(csv).toContain("Wrong revision");
  });

  it("answers the same demo in Portuguese", async () => {
    const session = sessionWithRegister();
    session.uiLanguage = "pt";
    const provider = createScriptedProvider(session);
    const composed = composeUserContent({
      text: "Segue a lista de entregáveis. Lê e diz o que entendeste.",
      files: [{ id: "file-register", name: bundle.fileName, kind: "spreadsheet" }],
      folderCount: 0,
    });
    const parsed = await runAgent(session, "Segue a lista de entregáveis. Lê e diz o que entendeste.", composed, provider);
    expect(parsed.text).toMatch(/Linha de cabeçalho: 11/);
    expect(parsed.text).toMatch(/Entregáveis: 36/);
    expect(parsed.text).not.toMatch(/Header row/);

    await runAgent(session, "Sim, está correto.", "Sim, está correto.", provider);
    expect(session.confirmed).toBe(true);
    session.pendingFolderNames = bundle.folderNames;
    const checked = await runAgent(
      session,
      "Confere esta pasta com o registo.",
      composeUserContent({ text: "Confere esta pasta com o registo.", files: [], folderCount: bundle.folderNames.length }),
      provider,
    );
    expect(session.comparison).toMatchObject({ ok: 32, wrongRevision: 2, missing: 2, extra: 3 });
    expect(session.replyLang).toBe("pt");
    expect(checked.text).toMatch(/Revisão diferente/);
    expect(checked.text).toMatch(/Em falta/);
  });

  it("re-reads the register when the user corrects the column", async () => {
    expect(extractOverrides("The column is Drawing Numbering and the header is row 11")).toEqual({
      headerRow: 11,
      numberColumn: "Drawing Numbering",
    });
    expect(extractOverrides("Please use sheet Register")).toMatchObject({ sheetName: "Register" });

    const session = sessionWithRegister();
    const provider = createScriptedProvider(session);
    await runAgent(
      session,
      "Please read the register.",
      composeUserContent({
        text: "Please read the register.",
        files: [{ id: "file-register", name: bundle.fileName, kind: "spreadsheet" }],
        folderCount: 0,
      }),
      provider,
    );
    await runAgent(session, "The column is Title and the header is row 11.", "The column is Title and the header is row 11.", provider);
    expect(session.register?.numberColumn).toBe("Title");
    expect(session.register?.deliverableCount).toBe(0);
    expect(session.confirmed).toBe(false);
  });
});
