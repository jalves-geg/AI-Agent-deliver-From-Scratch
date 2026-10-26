import type { Comparison, PublicUnderstanding, UiMessage } from "../types";

/**
 * Conversations are a client-side library. The repository interface is the
 * storage boundary: IndexedDB today, a database later, without changing the
 * chat UI. Each conversation points at its own server session, so the
 * assistant reads only that project’s register and folder.
 */

export const LEGACY_SESSION_STORAGE_KEY = "geg.session";

const STORAGE_ID = /^[A-Za-z0-9-]{8,80}$/;

export type ConversationContext = {
  messages: UiMessage[];
  understanding: PublicUnderstanding | null;
  confirmed: boolean;
  comparison: Comparison | null;
  folderCount: number;
};

export type ConversationRecord = ConversationContext & {
  id: string;
  name: string;
  sessionId: string;
  createdAt: number;
  updatedAt: number;
};

export type ConversationSummary = {
  id: string;
  name: string;
  sessionId: string;
  createdAt: number;
  updatedAt: number;
  messageCount: number;
  hasRegister: boolean;
  hasCheck: boolean;
};

export type ServerConversationSnapshot = {
  messages?: UiMessage[] | null;
  understanding?: PublicUnderstanding | null;
  confirmed?: boolean;
  comparison?: Comparison | null;
  folderCount?: number;
};

export interface ConversationRepository {
  list(): Promise<ConversationRecord[]>;
  get(id: string): Promise<ConversationRecord | null>;
  put(record: ConversationRecord): Promise<void>;
  remove(id: string): Promise<void>;
  getActiveId(): Promise<string | null>;
  setActiveId(id: string | null): Promise<void>;
}

export function isStorageId(value: unknown): value is string {
  return typeof value === "string" && STORAGE_ID.test(value);
}

export function normalizeConversationName(name: string): string {
  return name.trim().replace(/\s+/g, " ").slice(0, 80);
}

export function createConversation(input: {
  name: string;
  id?: string;
  sessionId?: string;
  now?: number;
  createId?: () => string;
}): ConversationRecord {
  const createId = input.createId ?? (() => crypto.randomUUID());
  const id = input.id ?? createId();
  const sessionId = input.sessionId ?? createId();
  const name = normalizeConversationName(input.name);
  if (!isStorageId(id) || !isStorageId(sessionId)) throw new Error("Invalid conversation id");
  if (!name) throw new Error("Conversation name is empty");
  const now = input.now ?? Date.now();
  return {
    id,
    name,
    sessionId,
    createdAt: now,
    updatedAt: now,
    messages: [],
    understanding: null,
    confirmed: false,
    comparison: null,
    folderCount: 0,
  };
}

export function sortConversations(records: ConversationRecord[]): ConversationRecord[] {
  return [...records].sort((a, b) => b.updatedAt - a.updatedAt || b.createdAt - a.createdAt || a.id.localeCompare(b.id));
}

export function summarizeConversation(record: ConversationRecord): ConversationSummary {
  return {
    id: record.id,
    name: record.name,
    sessionId: record.sessionId,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
    messageCount: record.messages.length,
    hasRegister: record.understanding !== null,
    hasCheck: record.comparison !== null,
  };
}

export function nextProjectName(names: string[], label: string): string {
  const used = new Set(names);
  let index = 1;
  while (used.has(`${label} ${index}`)) index += 1;
  return `${label} ${index}`;
}

export function isBlankConversation(record: ConversationContext): boolean {
  return record.messages.length === 0 && record.understanding === null && record.comparison === null && record.folderCount === 0;
}

export function conversationContentKey(record: { name?: string } & ConversationContext): string {
  return JSON.stringify({
    name: record.name ?? "",
    confirmed: record.confirmed,
    folderCount: record.folderCount,
    messages: record.messages,
    understanding: record.understanding,
    comparison: record.comparison,
  });
}

export function hasServerContext(snapshot: ServerConversationSnapshot): boolean {
  return Boolean(
    (snapshot.messages && snapshot.messages.length > 0) ||
      snapshot.understanding ||
      snapshot.comparison ||
      (typeof snapshot.folderCount === "number" && snapshot.folderCount > 0),
  );
}

export function withServerSnapshot(
  record: ConversationRecord,
  snapshot: ServerConversationSnapshot,
  now = Date.now(),
): ConversationRecord {
  if (!hasServerContext(snapshot)) return record;
  const next: ConversationRecord = {
    ...record,
    messages: Array.isArray(snapshot.messages)
      ? snapshot.messages.filter((message) => message.id !== "greeting")
      : record.messages,
    understanding: snapshot.understanding ?? null,
    confirmed: typeof snapshot.confirmed === "boolean" ? snapshot.confirmed : record.confirmed,
    comparison: snapshot.comparison ?? null,
    folderCount: typeof snapshot.folderCount === "number" ? snapshot.folderCount : record.folderCount,
  };
  if (conversationContentKey(next) === conversationContentKey(record)) return record;
  return { ...next, updatedAt: now };
}

export function withConversationContent(
  record: ConversationRecord,
  content: ConversationContext & { name?: string },
  now = Date.now(),
): ConversationRecord {
  const name = content.name === undefined ? record.name : normalizeConversationName(content.name);
  if (!name) return record;
  const next: ConversationRecord = {
    ...record,
    name,
    messages: content.messages.filter((message) => message.id !== "greeting"),
    understanding: content.understanding,
    confirmed: content.confirmed,
    comparison: content.comparison,
    folderCount: content.folderCount,
  };
  if (conversationContentKey(next) === conversationContentKey(record)) return record;
  return { ...next, updatedAt: now };
}

export function renameRecord(record: ConversationRecord, name: string, now = Date.now()): ConversationRecord | null {
  const normalized = normalizeConversationName(name);
  if (!normalized) return null;
  if (normalized === record.name) return record;
  return { ...record, name: normalized, updatedAt: now };
}

export function pickConversationAfterDelete(
  records: ConversationRecord[],
  deletedId: string,
  activeId: string,
): ConversationRecord | null {
  const remaining = sortConversations(records.filter((record) => record.id !== deletedId));
  if (remaining.length === 0) return null;
  return remaining.find((record) => record.id === activeId) ?? remaining[0];
}

export async function bootstrapConversations(
  repo: ConversationRepository,
  options: {
    legacySessionId?: string | null;
    defaultName: string;
    now?: number;
    createId?: () => string;
  },
): Promise<{ active: ConversationRecord; records: ConversationRecord[] }> {
  const records = sortConversations(await repo.list());
  if (records.length === 0) {
    const legacy = options.legacySessionId && isStorageId(options.legacySessionId) ? options.legacySessionId : undefined;
    const created = createConversation({
      name: options.defaultName,
      sessionId: legacy,
      now: options.now,
      createId: options.createId,
    });
    await repo.put(created);
    await repo.setActiveId(created.id);
    return { active: created, records: [created] };
  }
  const activeId = await repo.getActiveId();
  const active = records.find((record) => record.id === activeId) ?? records[0];
  if (active.id !== activeId) await repo.setActiveId(active.id);
  return { active, records };
}

export async function deleteConversationFromRepository(
  repo: ConversationRepository,
  id: string,
  options: { replacementName: string; now?: number; createId?: () => string },
): Promise<ConversationRecord | null> {
  const records = await repo.list();
  if (!records.some((record) => record.id === id)) {
    const activeId = await repo.getActiveId();
    return records.find((record) => record.id === activeId) ?? sortConversations(records)[0] ?? null;
  }
  const activeId = (await repo.getActiveId()) ?? id;
  await repo.remove(id);
  if (activeId !== id) {
    return records.find((record) => record.id === activeId) ?? null;
  }
  const next = pickConversationAfterDelete(records, id, activeId);
  if (next) {
    await repo.setActiveId(next.id);
    return next;
  }
  const created = createConversation({
    name: options.replacementName,
    now: options.now,
    createId: options.createId,
  });
  await repo.put(created);
  await repo.setActiveId(created.id);
  return created;
}
