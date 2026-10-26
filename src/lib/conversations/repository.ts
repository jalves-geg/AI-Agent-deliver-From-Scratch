import type { UiMessage } from "../types";
import {
  isStorageId,
  normalizeConversationName,
  type ConversationRecord,
  type ConversationRepository,
} from "./model";

/**
 * Key-value driver behind the conversation repository.
 * Swap this for another driver without changing conversation rules.
 */
export interface ByteStore {
  get(key: string): Promise<string | null>;
  set(key: string, value: string): Promise<void>;
  remove(key: string): Promise<void>;
  keys(): Promise<string[]>;
}

const RECORD_PREFIX = "conversation:";
const ACTIVE_KEY = "activeConversationId";

function parseMessages(value: unknown): UiMessage[] | null {
  if (!Array.isArray(value)) return null;
  const messages: UiMessage[] = [];
  for (const item of value) {
    if (!item || typeof item !== "object") return null;
    const message = item as UiMessage;
    if (message.id === "greeting") continue;
    if (typeof message.id !== "string" || message.id.length === 0) return null;
    if (message.role !== "user" && message.role !== "assistant") return null;
    if (typeof message.text !== "string") return null;
    const stored: UiMessage = { id: message.id, role: message.role, text: message.text };
    if (Array.isArray(message.attachments)) stored.attachments = message.attachments.filter((name) => typeof name === "string");
    if (typeof message.folderCount === "number") stored.folderCount = message.folderCount;
    if (Array.isArray(message.tools)) stored.tools = message.tools;
    if (message.showComparison === true) stored.showComparison = true;
    messages.push(stored);
  }
  return messages;
}

export function parseConversationRecord(raw: string | null): ConversationRecord | null {
  if (!raw) return null;
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const record = value as ConversationRecord;
  const name = typeof record.name === "string" ? normalizeConversationName(record.name) : "";
  const messages = parseMessages(record.messages);
  if (!isStorageId(record.id) || !isStorageId(record.sessionId) || !name || !messages) return null;
  if (typeof record.createdAt !== "number" || typeof record.updatedAt !== "number") return null;
  if (record.understanding !== null && (typeof record.understanding !== "object" || Array.isArray(record.understanding))) return null;
  if (record.comparison !== null && (typeof record.comparison !== "object" || Array.isArray(record.comparison))) return null;
  if (typeof record.folderCount !== "number" || !Number.isFinite(record.folderCount)) return null;
  return {
    id: record.id,
    name,
    sessionId: record.sessionId,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
    messages,
    understanding: record.understanding,
    confirmed: record.confirmed === true,
    comparison: record.comparison,
    folderCount: record.folderCount,
  };
}

export function createConversationRepository(store: ByteStore): ConversationRepository {
  return {
    async list() {
      const keys = await store.keys();
      const records: ConversationRecord[] = [];
      for (const key of keys) {
        if (!key.startsWith(RECORD_PREFIX)) continue;
        const raw = await store.get(key);
        const parsed = parseConversationRecord(raw);
        if (parsed) records.push(parsed);
        else if (raw !== null) await store.remove(key);
      }
      return records;
    },
    async get(id) {
      if (!isStorageId(id)) return null;
      const raw = await store.get(RECORD_PREFIX + id);
      if (raw === null) return null;
      const parsed = parseConversationRecord(raw);
      if (!parsed) {
        await store.remove(RECORD_PREFIX + id);
        return null;
      }
      return parsed;
    },
    async put(record) {
      const parsed = parseConversationRecord(JSON.stringify(record));
      if (!parsed) throw new Error("Invalid conversation");
      await store.set(RECORD_PREFIX + parsed.id, JSON.stringify(parsed));
    },
    async remove(id) {
      await store.remove(RECORD_PREFIX + id);
      if ((await store.get(ACTIVE_KEY)) === id) await store.remove(ACTIVE_KEY);
    },
    async getActiveId() {
      const id = await store.get(ACTIVE_KEY);
      return isStorageId(id) ? id : null;
    },
    async setActiveId(id) {
      if (id && isStorageId(id)) await store.set(ACTIVE_KEY, id);
      else await store.remove(ACTIVE_KEY);
    },
  };
}

export function createMemoryByteStore(initial?: Record<string, string>): ByteStore {
  const data = new Map<string, string>(Object.entries(initial ?? {}));
  return {
    async get(key) {
      return data.get(key) ?? null;
    },
    async set(key, value) {
      data.set(key, value);
    },
    async remove(key) {
      data.delete(key);
    },
    async keys() {
      return [...data.keys()];
    },
  };
}

export function createLocalStorageByteStore(storage: Pick<Storage, "getItem" | "setItem" | "removeItem" | "key" | "length">): ByteStore {
  return {
    async get(key) {
      return storage.getItem(key);
    },
    async set(key, value) {
      storage.setItem(key, value);
    },
    async remove(key) {
      storage.removeItem(key);
    },
    async keys() {
      const keys: string[] = [];
      for (let index = 0; index < storage.length; index += 1) {
        const key = storage.key(index);
        if (key) keys.push(key);
      }
      return keys;
    },
  };
}
