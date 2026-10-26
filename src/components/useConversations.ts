"use client";

import { useEffect, useRef, useState } from "react";
import { openConversationRepository } from "@/lib/conversations/browser";
import {
  LEGACY_SESSION_STORAGE_KEY,
  bootstrapConversations,
  createConversation,
  deleteConversationFromRepository,
  isBlankConversation,
  nextProjectName,
  normalizeConversationName,
  renameRecord,
  sortConversations,
  summarizeConversation,
  withConversationContent,
  withServerSnapshot,
  type ConversationRecord,
  type ConversationRepository,
  type ConversationSummary,
  type ServerConversationSnapshot,
} from "@/lib/conversations/model";
import { createConversationRepository, createMemoryByteStore } from "@/lib/conversations/repository";
import type { Comparison, Lang, PublicUnderstanding, UiMessage } from "@/lib/types";

type ViewContent = {
  messages: UiMessage[];
  understanding: PublicUnderstanding | null;
  confirmed: boolean;
  comparison: Comparison | null;
  folderCount: number;
  name: string;
};

export type CreatedConversation = {
  id: string;
  sessionId: string;
  name: string;
  blank: boolean;
};

function greetingMessage(text: string): UiMessage {
  return { id: "greeting", role: "assistant", text };
}

function withoutGreeting(messages: UiMessage[]): UiMessage[] {
  return messages.filter((message) => message.id !== "greeting");
}

export function useConversations(options: {
  greetingText: string;
  projectLabel: string;
  onServerLang?: (lang: Lang) => void;
}) {
  const [ready, setReady] = useState(false);
  const [settling, setSettling] = useState(false);
  const [storageFailed, setStorageFailed] = useState(false);
  const [summaries, setSummaries] = useState<ConversationSummary[]>([]);
  const [activeId, setActiveId] = useState("");
  const [name, setName] = useState("");
  const [sessionId, setSessionId] = useState("");
  const [messages, setMessages] = useState<UiMessage[]>([greetingMessage(options.greetingText)]);
  const [understanding, setUnderstanding] = useState<PublicUnderstanding | null>(null);
  const [confirmed, setConfirmed] = useState(false);
  const [comparison, setComparison] = useState<Comparison | null>(null);
  const [folderCount, setFolderCount] = useState(0);

  const repoRef = useRef<ConversationRepository | null>(null);
  const recordRef = useRef<ConversationRecord | null>(null);
  const liveIdRef = useRef("");
  const sessionIdRef = useRef("");
  const greetingRef = useRef(options.greetingText);
  const projectLabelRef = useRef(options.projectLabel);
  const onServerLangRef = useRef(options.onServerLang);
  const readyRef = useRef(false);
  const mountedRef = useRef(true);
  const opLock = useRef(false);
  const latestRev = useRef(new Map<string, number>());
  const writeChain = useRef<Promise<void>>(Promise.resolve());
  const contentRef = useRef<ViewContent>({
    messages: [greetingMessage(options.greetingText)],
    understanding: null,
    confirmed: false,
    comparison: null,
    folderCount: 0,
    name: "",
  });

  greetingRef.current = options.greetingText;
  projectLabelRef.current = options.projectLabel;
  onServerLangRef.current = options.onServerLang;
  contentRef.current = { messages, understanding, confirmed, comparison, folderCount, name };

  function publishSummaries(records: ConversationRecord[]) {
    if (!mountedRef.current) return;
    setSummaries(sortConversations(records).map(summarizeConversation));
  }

  function queuePersist(record: ConversationRecord) {
    const repo = repoRef.current;
    if (!repo) return;
    const revision = (latestRev.current.get(record.id) ?? 0) + 1;
    latestRev.current.set(record.id, revision);
    if (liveIdRef.current === record.id) recordRef.current = record;
    writeChain.current = writeChain.current
      .catch(() => undefined)
      .then(async () => {
        if (latestRev.current.get(record.id) !== revision) return;
        try {
          await repo.put(record);
          if (!mountedRef.current || latestRev.current.get(record.id) !== revision) return;
          publishSummaries(await repo.list());
        } catch {
          if (mountedRef.current) setStorageFailed(true);
        }
      });
  }

  function show(record: ConversationRecord) {
    const nextMessages = [greetingMessage(greetingRef.current), ...record.messages];
    recordRef.current = record;
    liveIdRef.current = record.id;
    sessionIdRef.current = record.sessionId;
    contentRef.current = {
      messages: nextMessages,
      understanding: record.understanding,
      confirmed: record.confirmed,
      comparison: record.comparison,
      folderCount: record.folderCount,
      name: record.name,
    };
    setActiveId(record.id);
    setName(record.name);
    setSessionId(record.sessionId);
    setMessages(nextMessages);
    setUnderstanding(record.understanding);
    setConfirmed(record.confirmed);
    setComparison(record.comparison);
    setFolderCount(record.folderCount);
  }

  async function flush() {
    const current = recordRef.current;
    if (!current || current.id !== liveIdRef.current) return;
    const content = contentRef.current;
    const next = withConversationContent(current, {
      name: content.name,
      messages: withoutGreeting(content.messages),
      understanding: content.understanding,
      confirmed: content.confirmed,
      comparison: content.comparison,
      folderCount: content.folderCount,
    });
    if (next === current) return;
    queuePersist(next);
    await writeChain.current;
  }

  async function pullServer(record: ConversationRecord, adoptLang: boolean): Promise<ConversationRecord> {
    try {
      const response = await fetch(`/api/session?id=${encodeURIComponent(record.sessionId)}`);
      if (!response.ok) return record;
      const session = (await response.json()) as ServerConversationSnapshot & { lang?: unknown };
      if (adoptLang && (session.lang === "pt" || session.lang === "en")) onServerLangRef.current?.(session.lang);
      const base = recordRef.current?.id === record.id ? recordRef.current : record;
      const merged = withServerSnapshot(base, session);
      if (merged === base) return base;
      queuePersist(merged);
      await writeChain.current;
      return merged;
    } catch {
      return record;
    }
  }

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  useEffect(() => {
    setMessages((current) => {
      const rest = withoutGreeting(current);
      if (current[0]?.id === "greeting" && current[0].text === options.greetingText) return current;
      return [greetingMessage(options.greetingText), ...rest];
    });
  }, [options.greetingText]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const opened = await openConversationRepository();
        if (cancelled) return;
        repoRef.current = opened.repo;
        if (!opened.durable) setStorageFailed(true);
        const legacy = window.localStorage.getItem(LEGACY_SESSION_STORAGE_KEY);
        const booted = await bootstrapConversations(opened.repo, {
          legacySessionId: legacy,
          defaultName: nextProjectName([], projectLabelRef.current),
        });
        if (cancelled) return;
        if (opened.durable) window.localStorage.removeItem(LEGACY_SESSION_STORAGE_KEY);
        show(booted.active);
        publishSummaries(booted.records);
        const merged = await pullServer(booted.active, true);
        if (cancelled) return;
        if (merged.id === liveIdRef.current) show(merged);
        publishSummaries(await opened.repo.list());
        readyRef.current = true;
        setReady(true);
      } catch {
        if (cancelled) return;
        const repo = createConversationRepository(createMemoryByteStore());
        repoRef.current = repo;
        setStorageFailed(true);
        const booted = await bootstrapConversations(repo, {
          legacySessionId: window.localStorage.getItem(LEGACY_SESSION_STORAGE_KEY),
          defaultName: nextProjectName([], projectLabelRef.current),
        });
        if (cancelled) return;
        show(booted.active);
        publishSummaries(booted.records);
        readyRef.current = true;
        setReady(true);
      }
    })();
    return () => {
      cancelled = true;
    };
    // The library is loaded once. Language changes update the greeting, not the stored project name.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function createNew(requestedName?: string, createOptions?: { force?: boolean }): Promise<CreatedConversation | null> {
    const repo = repoRef.current;
    const current = recordRef.current;
    if (!repo || !readyRef.current || !current) return null;
    const content = contentRef.current;
    const blank = isBlankConversation({
      messages: withoutGreeting(content.messages),
      understanding: content.understanding,
      confirmed: content.confirmed,
      comparison: content.comparison,
      folderCount: content.folderCount,
    });
    if (blank && !createOptions?.force) {
      return { id: current.id, sessionId: current.sessionId, name: current.name, blank: true };
    }
    if (opLock.current) return null;
    opLock.current = true;
    try {
    await flush();
    const records = await repo.list();
    const normalized = requestedName ? normalizeConversationName(requestedName) : "";
    const created = createConversation({
      name: normalized || nextProjectName(records.map((record) => record.name), projectLabelRef.current),
    });
    queuePersist(created);
    await writeChain.current;
    await repo.setActiveId(created.id);
    show(created);
    return { id: created.id, sessionId: created.sessionId, name: created.name, blank: false };
    } finally {
      opLock.current = false;
    }
  }

  async function openConversation(id: string) {
    const repo = repoRef.current;
    if (!repo || !readyRef.current || id === liveIdRef.current || opLock.current) return;
    opLock.current = true;
    setSettling(true);
    try {
      await flush();
      const record = await repo.get(id);
      if (!record) {
        publishSummaries(await repo.list());
        return;
      }
      await repo.setActiveId(id);
      show(record);
      const merged = await pullServer(record, false);
      if (liveIdRef.current === id) show(merged);
      publishSummaries(await repo.list());
    } finally {
      opLock.current = false;
      if (mountedRef.current) setSettling(false);
    }
  }

  async function renameConversation(id: string, rawName: string): Promise<boolean> {
    const repo = repoRef.current;
    if (!repo || !readyRef.current || opLock.current) return false;
    opLock.current = true;
    try {
    const normalized = normalizeConversationName(rawName);
    if (!normalized) return false;
    await flush();
    const base = id === liveIdRef.current ? recordRef.current : await repo.get(id);
    if (!base) return false;
    const next = renameRecord(base, normalized);
    if (!next) return false;
    if (next === base) return true;
    if (id === liveIdRef.current) {
      contentRef.current = { ...contentRef.current, name: next.name };
      setName(next.name);
    }
    queuePersist(next);
    await writeChain.current;
    return true;
    } finally {
      opLock.current = false;
    }
  }

  async function deleteConversation(id: string) {
    const repo = repoRef.current;
    if (!repo || !readyRef.current || opLock.current) return;
    opLock.current = true;
    try {
    const records = await repo.list();
    const target = records.find((record) => record.id === id);
    if (!target) return;
    const wasActive = id === liveIdRef.current;
    if (!wasActive) await flush();
    const removed: { next: ConversationRecord | null } = { next: null };
    writeChain.current = writeChain.current.catch(() => undefined).then(async () => {
      latestRev.current.set(id, (latestRev.current.get(id) ?? 0) + 1);
      removed.next = await deleteConversationFromRepository(repo, id, {
        replacementName: nextProjectName([], projectLabelRef.current),
      });
    });
    await writeChain.current;
    void fetch(`/api/session?id=${encodeURIComponent(target.sessionId)}`, { method: "DELETE" }).catch(() => undefined);
    const next = removed.next;
    if (wasActive && next) {
      show(next);
      const merged = await pullServer(next, false);
      if (liveIdRef.current === next.id) show(merged);
    }
    publishSummaries(await repo.list());
    } finally {
      opLock.current = false;
    }
  }

  function addLocalMessage(conversationId: string, message: UiMessage) {
    const current = recordRef.current;
    if (!current || conversationId !== liveIdRef.current) return;
    const messages = [...withoutGreeting(contentRef.current.messages), message];
    const visible = [greetingMessage(greetingRef.current), ...messages];
    contentRef.current = { ...contentRef.current, messages: visible };
    setMessages(visible);
    const next = withConversationContent(current, {
      name: contentRef.current.name,
      messages,
      understanding: contentRef.current.understanding,
      confirmed: contentRef.current.confirmed,
      comparison: contentRef.current.comparison,
      folderCount: contentRef.current.folderCount,
    });
    if (next !== current) queuePersist(next);
  }

  function applyContext(
    conversationId: string,
    event: {
      understanding: PublicUnderstanding | null;
      confirmed: boolean;
      folderCount: number;
      comparison: Comparison | null;
    },
  ) {
    const current = recordRef.current;
    if (!current || conversationId !== liveIdRef.current) return;
    contentRef.current = {
      ...contentRef.current,
      understanding: event.understanding,
      confirmed: event.confirmed,
      comparison: event.comparison,
      folderCount: event.folderCount,
    };
    setUnderstanding(event.understanding);
    setConfirmed(event.confirmed);
    setComparison(event.comparison);
    setFolderCount(event.folderCount);
    const next = withConversationContent(current, {
      name: contentRef.current.name,
      messages: withoutGreeting(contentRef.current.messages),
      understanding: event.understanding,
      confirmed: event.confirmed,
      comparison: event.comparison,
      folderCount: event.folderCount,
    });
    if (next !== current) queuePersist(next);
  }

  function applySnapshot(conversationId: string, snapshot: ServerConversationSnapshot) {
    const repo = repoRef.current;
    if (!repo) return;
    if (conversationId !== liveIdRef.current) {
      void repo.get(conversationId).then((record) => {
        if (!record) return;
        const merged = withServerSnapshot(record, snapshot);
        if (merged !== record) queuePersist(merged);
      });
      return;
    }
    const current = recordRef.current;
    if (!current) return;
    const merged = withServerSnapshot(current, {
      messages: snapshot.messages ?? withoutGreeting(contentRef.current.messages),
      understanding: snapshot.understanding ?? null,
      confirmed: snapshot.confirmed === true,
      comparison: snapshot.comparison ?? null,
      folderCount: typeof snapshot.folderCount === "number" ? snapshot.folderCount : current.folderCount,
    });
    show(merged);
    if (merged !== current) queuePersist(merged);
  }

  return {
    ready,
    settling,
    storageFailed,
    summaries,
    activeId,
    name,
    sessionId,
    messages,
    understanding,
    confirmed,
    comparison,
    folderCount,
    currentConversationId: () => liveIdRef.current,
    currentSessionId: () => sessionIdRef.current,
    addLocalMessage,
    applyContext,
    applySnapshot,
    createNew,
    openConversation,
    renameConversation,
    deleteConversation,
  };
}
