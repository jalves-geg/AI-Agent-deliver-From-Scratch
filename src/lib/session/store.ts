import { randomUUID } from "node:crypto";
import type {
  Comparison,
  Lang,
  ModelMessage,
  RegisterUnderstanding,
  StoredFile,
  UiMessage,
} from "../types";

export type Session = {
  id: string;
  createdAt: number;
  touchedAt: number;
  uiLanguage: Lang;
  replyLang: Lang;
  messages: ModelMessage[];
  uiMessages: UiMessage[];
  files: Map<string, StoredFile>;
  register: RegisterUnderstanding | null;
  registerFileId: string | null;
  confirmed: boolean;
  folderNames: string[] | null;
  pendingFolderNames: string[] | null;
  comparison: Comparison | null;
};

const MAX_SESSIONS = 50;

const globalStore = globalThis as unknown as { __gegSessions?: Map<string, Session> };
const sessions = globalStore.__gegSessions ?? new Map<string, Session>();
globalStore.__gegSessions = sessions;

function touch(session: Session): void {
  session.touchedAt = Date.now();
  sessions.delete(session.id);
  sessions.set(session.id, session);
  while (sessions.size > MAX_SESSIONS) {
    const oldest = sessions.keys().next().value;
    if (!oldest) break;
    sessions.delete(oldest);
  }
}

export function getSession(id: string): Session | null {
  const session = sessions.get(id);
  if (!session) return null;
  touch(session);
  return session;
}

export function createSession(id?: string): Session {
  const session: Session = {
    id: id && /^[A-Za-z0-9-]{8,80}$/.test(id) ? id : randomUUID(),
    createdAt: Date.now(),
    touchedAt: Date.now(),
    uiLanguage: "en",
    replyLang: "en",
    messages: [],
    uiMessages: [],
    files: new Map(),
    register: null,
    registerFileId: null,
    confirmed: false,
    folderNames: null,
    pendingFolderNames: null,
    comparison: null,
  };
  touch(session);
  return session;
}

export function ensureSession(id?: string): Session {
  if (id) {
    const existing = sessions.get(id);
    if (existing) {
      touch(existing);
      return existing;
    }
  }
  return createSession(id);
}

export function deleteSession(id: string): void {
  sessions.delete(id);
}

export function resetSessions(): void {
  sessions.clear();
}

export function putFile(session: Session, file: Omit<StoredFile, "id"> & { id?: string }): StoredFile {
  const stored: StoredFile = {
    ...file,
    id: file.id ?? `file_${randomUUID()}`,
  };
  session.files.set(stored.id, stored);
  touch(session);
  return stored;
}

export function addUiMessage(session: Session, message: UiMessage): void {
  session.uiMessages.push(message);
  if (session.uiMessages.length > 80) {
    session.uiMessages.splice(0, session.uiMessages.length - 80);
  }
  touch(session);
}
