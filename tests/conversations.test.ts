import { describe, expect, it } from "vitest";
import {
  bootstrapConversations,
  createConversation,
  deleteConversationFromRepository,
  hasServerContext,
  isBlankConversation,
  nextProjectName,
  normalizeConversationName,
  pickConversationAfterDelete,
  renameRecord,
  withConversationContent,
  withServerSnapshot,
  type ConversationRecord,
} from "@/lib/conversations/model";
import {
  createConversationRepository,
  createLocalStorageByteStore,
  createMemoryByteStore,
  type ByteStore,
} from "@/lib/conversations/repository";
import type { Comparison, PublicUnderstanding, UiMessage } from "@/lib/types";

function ids() {
  let n = 0;
  return () => `id-${String(++n).padStart(8, "0")}`;
}

function message(id: string, text: string): UiMessage {
  return { id, role: "user", text };
}

class MemoryStorage implements Pick<Storage, "getItem" | "setItem" | "removeItem" | "key" | "length"> {
  private map = new Map<string, string>();
  get length() {
    return this.map.size;
  }
  key(index: number) {
    return [...this.map.keys()][index] ?? null;
  }
  getItem(key: string) {
    return this.map.get(key) ?? null;
  }
  setItem(key: string, value: string) {
    this.map.set(key, value);
  }
  removeItem(key: string) {
    this.map.delete(key);
  }
}

function repoFor(store: ByteStore) {
  return createConversationRepository(store);
}

describe("conversation names", () => {
  it("trims, collapses whitespace, and limits the length", () => {
    expect(normalizeConversationName("  Ponte   Norte  ")).toBe("Ponte Norte");
    expect(normalizeConversationName(` ${"a".repeat(90)} `)).toHaveLength(80);
    expect(normalizeConversationName("   ")).toBe("");
  });

  it("numbers project names without reusing one", () => {
    expect(nextProjectName(["Project 1", "Project 2"], "Project")).toBe("Project 3");
    expect(nextProjectName(["Projeto 2"], "Projeto")).toBe("Projeto 1");
  });

  it("rejects an empty rename and keeps the session when the name changes", () => {
    const record = createConversation({ name: "Project 1", now: 10, createId: ids() });
    expect(renameRecord(record, "   ")).toBeNull();
    expect(renameRecord(record, "Project 1")).toBe(record);
    const renamed = renameRecord(record, "  Viaduto  Sul ", 25);
    expect(renamed).toMatchObject({ name: "Viaduto Sul", sessionId: record.sessionId, updatedAt: 25 });
  });
});

describe("conversation library", () => {
  it("creates one conversation on the first visit and reopens it", async () => {
    const repo = repoFor(createMemoryByteStore());
    const first = await bootstrapConversations(repo, {
      defaultName: "Project 1",
      now: 1_000,
      createId: ids(),
    });
    expect(first.records).toHaveLength(1);
    expect(first.active).toMatchObject({ name: "Project 1", createdAt: 1_000 });
    expect(await repo.getActiveId()).toBe(first.active.id);
    expect(isBlankConversation(first.active)).toBe(true);

    const second = await bootstrapConversations(repo, {
      legacySessionId: "another-session",
      defaultName: "Project 9",
      createId: ids(),
    });
    expect(second.records).toHaveLength(1);
    expect(second.active.id).toBe(first.active.id);
    expect(second.active.sessionId).toBe(first.active.sessionId);
  });

  it("keeps a previous single chat by reusing its server session", async () => {
    const repo = repoFor(createMemoryByteStore());
    const booted = await bootstrapConversations(repo, {
      legacySessionId: "legacy-session-id",
      defaultName: "Project 1",
      createId: ids(),
    });
    expect(booted.active.sessionId).toBe("legacy-session-id");
    expect(booted.active.id).not.toBe("legacy-session-id");
  });

  it("ignores a legacy id that is not a session id", async () => {
    const repo = repoFor(createMemoryByteStore());
    const created = await bootstrapConversations(repo, {
      legacySessionId: "short",
      defaultName: "Project 1",
      createId: ids(),
    });
    expect(created.active.sessionId).not.toBe("short");
    expect(created.records).toHaveLength(1);
  });

  it("opens the newest conversation when the saved active id is gone", async () => {
    const repo = repoFor(createMemoryByteStore());
    const older = createConversation({ name: "Older", now: 10, createId: ids() });
    const newer = createConversation({ name: "Newer", now: 20, createId: ids() });
    await repo.put(older);
    await repo.put(newer);
    await repo.setActiveId("missing-session-id");
    const booted = await bootstrapConversations(repo, { defaultName: "Project 1" });
    expect(booted.active.id).toBe(newer.id);
    expect(await repo.getActiveId()).toBe(newer.id);
  });

  it("keeps each conversation's messages, register, and check separate", async () => {
    const repo = repoFor(createMemoryByteStore());
    const createId = ids();
    const first = createConversation({ name: "Bridge", now: 1, createId });
    const second = createConversation({ name: "Tunnel", now: 2, createId });
    expect(first.sessionId).not.toBe(second.sessionId);

    const bridge = withConversationContent(first, {
      name: "Bridge",
      messages: [message("m1", "Read the bridge register")],
      understanding: { fileName: "bridge.xlsx", deliverableCount: 12 } as PublicUnderstanding,
      confirmed: true,
      comparison: null,
      folderCount: 4,
    }, 30);
    const tunnel = withConversationContent(second, {
      messages: [message("m2", "Check the tunnel folder")],
      understanding: null,
      confirmed: false,
      comparison: { missing: 2, extra: 1 } as Comparison,
      folderCount: 9,
    }, 40);
    await repo.put(bridge);
    await repo.put(tunnel);

    const storedBridge = await repo.get(first.id);
    const storedTunnel = await repo.get(second.id);
    expect(storedBridge?.messages.map((entry) => entry.text)).toEqual(["Read the bridge register"]);
    expect(storedBridge?.understanding?.fileName).toBe("bridge.xlsx");
    expect(storedBridge?.confirmed).toBe(true);
    expect(storedBridge?.comparison).toBeNull();
    expect(storedBridge?.folderCount).toBe(4);
    expect(storedTunnel?.messages.map((entry) => entry.text)).toEqual(["Check the tunnel folder"]);
    expect(storedTunnel?.understanding).toBeNull();
    expect(storedTunnel?.comparison).toMatchObject({ missing: 2, extra: 1 });
    expect(storedTunnel?.folderCount).toBe(9);

    storedBridge?.messages.push(message("m3", "mutated"));
    expect((await repo.get(first.id))?.messages).toHaveLength(1);
  });

  it("drops a corrupt record and still opens one conversation", async () => {
    const bytes = createMemoryByteStore({
      "conversation:bad-record-id": "{",
      "conversation:also-bad-id": JSON.stringify({ id: "short", name: "Nope" }),
    });
    const repo = repoFor(bytes);
    expect(await repo.list()).toEqual([]);
    expect(await bytes.keys()).toEqual([]);
    const booted = await bootstrapConversations(repo, { defaultName: "Project 1", createId: ids() });
    expect(booted.records).toHaveLength(1);
    const again = await bootstrapConversations(repo, { defaultName: "Project 1", createId: ids() });
    expect(again.active.id).toBe(booted.active.id);
  });

  it("does not let an empty server session wipe a saved project", () => {
    const record = withConversationContent(
      createConversation({ name: "Bridge", createId: ids() }),
      {
        messages: [message("m1", "hello")],
        understanding: { fileName: "a.xlsx" } as PublicUnderstanding,
        confirmed: true,
        comparison: { missing: 1 } as Comparison,
        folderCount: 3,
      },
    );
    expect(hasServerContext({ messages: [], understanding: null, comparison: null, folderCount: 0 })).toBe(false);
    expect(withServerSnapshot(record, { messages: [], understanding: null, comparison: null, folderCount: 0 })).toBe(record);
  });

  it("prefers the live server context without renaming the project", () => {
    const record = createConversation({ name: "Bridge", sessionId: "session-bridge", createId: ids() });
    const merged = withServerSnapshot(record, {
      messages: [message("m1", "from the server")],
      understanding: { fileName: "live.xlsx", deliverableCount: 4 } as PublicUnderstanding,
      confirmed: true,
      comparison: { ok: 4 } as Comparison,
      folderCount: 8,
    }, 50);
    expect(merged.name).toBe("Bridge");
    expect(merged.sessionId).toBe(record.sessionId);
    expect(merged.updatedAt).toBe(50);
    expect(merged.messages[0]?.text).toBe("from the server");
    expect(merged.folderCount).toBe(8);
    expect(withServerSnapshot(merged, {
      messages: merged.messages,
      understanding: merged.understanding,
      confirmed: true,
      comparison: merged.comparison,
      folderCount: 8,
    })).toBe(merged);
  });

  it("strips the local greeting before saving", () => {
    const record = createConversation({ name: "Project 1", createId: ids() });
    const saved = withConversationContent(record, {
      messages: [
        { id: "greeting", role: "assistant", text: "Hello" },
        message("m1", "A register"),
      ],
      understanding: null,
      confirmed: false,
      comparison: null,
      folderCount: 0,
    });
    expect(saved.messages.map((entry) => entry.id)).toEqual(["m1"]);
  });
});

describe("deleting a conversation", () => {
  it("asks the library to keep the newest remaining project", async () => {
    const repo = repoFor(createMemoryByteStore());
    const createId = ids();
    const first = createConversation({ name: "First", now: 10, createId });
    const second = createConversation({ name: "Second", now: 20, createId });
    const third = createConversation({ name: "Third", now: 15, createId });
    await repo.put(first);
    await repo.put(second);
    await repo.put(third);
    await repo.setActiveId(first.id);

    expect(pickConversationAfterDelete([first, second, third], second.id, first.id)?.id).toBe(first.id);
    expect(pickConversationAfterDelete([first, second, third], first.id, first.id)?.id).toBe(second.id);

    const next = await deleteConversationFromRepository(repo, first.id, { replacementName: "Project 9" });
    expect(next?.id).toBe(second.id);
    expect(await repo.get(first.id)).toBeNull();
    expect(await repo.get(second.id)).toMatchObject({ name: "Second" });
    expect(await repo.getActiveId()).toBe(second.id);
  });

  it("creates a replacement when the last conversation is deleted", async () => {
    const repo = repoFor(createMemoryByteStore());
    const createId = ids();
    const only = createConversation({ name: "Only", now: 5, createId });
    await repo.put(only);
    await repo.setActiveId(only.id);
    const next = await deleteConversationFromRepository(repo, only.id, {
      replacementName: "Project 1",
      now: 8,
      createId,
    });
    expect(next).toMatchObject({ name: "Project 1", createdAt: 8 });
    expect(next?.id).not.toBe(only.id);
    expect(await repo.list()).toHaveLength(1);
    expect(isBlankConversation(next as ConversationRecord)).toBe(true);
  });

  it("leaves the open conversation in place when another one is deleted", async () => {
    const repo = repoFor(createMemoryByteStore());
    const createId = ids();
    const open = createConversation({ name: "Open", now: 10, createId });
    const other = withConversationContent(createConversation({ name: "Other", now: 20, createId }), {
      messages: [message("m1", "keep me")],
      understanding: null,
      confirmed: false,
      comparison: null,
      folderCount: 0,
    });
    await repo.put(open);
    await repo.put(other);
    await repo.setActiveId(open.id);
    const next = await deleteConversationFromRepository(repo, other.id, { replacementName: "Project 1" });
    expect(next?.id).toBe(open.id);
    expect(await repo.get(other.id)).toBeNull();
    expect(await repo.getActiveId()).toBe(open.id);
  });
});

describe("localStorage driver", () => {
  it("round-trips a conversation through the same repository", async () => {
    const storage = new MemoryStorage();
    const repo = createConversationRepository(createLocalStorageByteStore(storage));
    const record = withConversationContent(createConversation({ name: "Metro", createId: ids(), now: 4 }), {
      messages: [message("m1", "linha azul")],
      understanding: null,
      confirmed: false,
      comparison: { extra: 3 } as Comparison,
      folderCount: 1,
    });
    await repo.put(record);
    await repo.setActiveId(record.id);
    const again = createConversationRepository(createLocalStorageByteStore(storage));
    expect(await again.getActiveId()).toBe(record.id);
    expect(await again.get(record.id)).toMatchObject({
      name: "Metro",
      folderCount: 1,
      messages: [expect.objectContaining({ text: "linha azul" })],
      comparison: { extra: 3 },
    });
  });
});
