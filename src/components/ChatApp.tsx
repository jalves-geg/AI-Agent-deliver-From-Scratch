"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { ComparisonTable } from "@/components/ComparisonTable";
import { RichText } from "@/components/RichText";
import { consumeChatEvents, type ChatEvent, type SessionSnapshot } from "@/lib/chatEvents";
import { detectLang } from "@/lib/lang";
import { copy, type Copy } from "@/lib/uiCopy";
import type { Comparison, Lang, PublicUnderstanding, ToolTrace, UiMessage } from "@/lib/types";

const CLIENT_TIMEOUT_MS = 120_000;

type Health = {
  demoMode: boolean;
  provider: string;
  model: string;
  hasKey: boolean;
};

type SendInput = {
  text: string;
  fileIds?: string[];
  fileLabels?: string[];
  folderNames?: string[];
  demo?: boolean;
  session?: string;
  keepBusy?: boolean;
};

const PROVIDER_LABEL: Record<string, string> = {
  xai: "xAI",
  openai: "OpenAI",
  anthropic: "Anthropic",
  azure: "Azure OpenAI",
  "openai-compatible": "OpenAI-compatible",
};

export function ChatApp() {
  const [lang, setLang] = useState<Lang>("en");
  const [sessionId, setSessionId] = useState("");
  const [messages, setMessages] = useState<UiMessage[]>([]);
  const [understanding, setUnderstanding] = useState<PublicUnderstanding | null>(null);
  const [confirmed, setConfirmed] = useState(false);
  const [comparison, setComparison] = useState<Comparison | null>(null);
  const [health, setHealth] = useState<Health | null>(null);
  const [draft, setDraft] = useState("");
  const [pendingFiles, setPendingFiles] = useState<{ id: string; name: string }[]>([]);
  const [pendingFolder, setPendingFolder] = useState<string[] | null>(null);
  const [folderCount, setFolderCount] = useState(0);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState<string | null>(null);
  const [liveTools, setLiveTools] = useState<ToolTrace[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [contextOpen, setContextOpen] = useState(false);
  const threadRef = useRef<HTMLDivElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const folderRef = useRef<HTMLInputElement>(null);
  const text = copy[lang];
  const lastComparison = useMemo(
    () => messages.reduce((found, message, index) => (message.showComparison ? index : found), -1),
    [messages],
  );

  useEffect(() => {
    const stored = window.localStorage.getItem("geg.session");
    const id = stored && /^[A-Za-z0-9-]{8,80}$/.test(stored) ? stored : crypto.randomUUID();
    window.localStorage.setItem("geg.session", id);
    setSessionId(id);
    setMessages([greeting(copy.en)]);
    void Promise.all([
      fetch("/api/health").then((response) => response.json()),
      fetch(`/api/session?id=${id}`).then((response) => response.json()),
    ]).then(([nextHealth, session]) => {
      setHealth(nextHealth);
      if (session?.lang === "pt" || session?.lang === "en") setLang(session.lang);
      if (session?.messages?.length) {
        const used = session.lang === "pt" ? copy.pt : copy.en;
        setMessages([greeting(used), ...session.messages]);
        setUnderstanding(session.understanding);
        setConfirmed(Boolean(session.confirmed));
        setComparison(session.comparison);
        setFolderCount(Number(session.folderCount) || 0);
      }
    }).catch(() => setError("Could not reach the app server."));
  }, []);

  useEffect(() => {
    threadRef.current?.scrollTo({ top: threadRef.current.scrollHeight, behavior: "smooth" });
  }, [messages, busy, comparison, progress, liveTools]);

  function applySession(data: {
    messages?: UiMessage[];
    understanding?: PublicUnderstanding | null;
    confirmed?: boolean;
    comparison?: Comparison | null;
    folderCount?: number;
  }, used: Copy) {
    setMessages([greeting(used), ...(data.messages ?? [])]);
    setUnderstanding(data.understanding ?? null);
    setConfirmed(Boolean(data.confirmed));
    setComparison(data.comparison ?? null);
    if (typeof data.folderCount === "number") setFolderCount(data.folderCount);
  }

  function applyContext(event: Extract<ChatEvent, { type: "context" }>) {
    setUnderstanding(event.understanding);
    setConfirmed(event.confirmed);
    setComparison(event.comparison);
    setFolderCount(event.folderCount);
  }

  async function send(input: SendInput) {
    const id = input.session ?? sessionId;
    const bodyText = input.text.trim();
    if (!id || (!bodyText && !input.fileIds?.length && !input.folderNames?.length)) return;
    const replyLang = detectLang(bodyText, lang);
    setBusy(true);
    setError(null);
    setLiveTools([]);
    setProgress(replyLang === "pt" ? "A verificar…" : `${copy[replyLang].typing}…`);
    const optimistic: UiMessage = {
      id: crypto.randomUUID(),
      role: "user",
      text: bodyText || copy[replyLang].attached,
      attachments: input.fileLabels,
      folderCount: input.folderNames?.length,
    };
    setMessages((current) => [...current, optimistic]);
    setDraft("");
    setPendingFiles([]);
    setPendingFolder(null);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), CLIENT_TIMEOUT_MS);
    let finished = false;
    try {
      const response = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        signal: controller.signal,
        body: JSON.stringify({
          sessionId: id,
          text: bodyText,
          fileIds: input.fileIds,
          folderNames: input.folderNames,
          demo: input.demo === true,
          lang,
        }),
      });
      if (!response.ok) {
        const data = (await response.json().catch(() => null)) as { error?: string } | null;
        throw new Error(data?.error || `Request failed (${response.status})`);
      }
      let snapshot: SessionSnapshot | null = null;
      let streamError = "";
      await consumeChatEvents(response, (event) => {
        if (event.type === "progress") setProgress(event.text);
        if (event.type === "tool") setLiveTools((current) => [...current, event.tool]);
        if (event.type === "context") applyContext(event);
        if (event.type === "error") streamError = event.message;
        if (event.type === "done") snapshot = event.session;
      });
      if (!snapshot) throw new Error(streamError || (replyLang === "pt" ? "A resposta não chegou." : "The assistant did not finish."));
      finished = true;
      applySession(snapshot, copy[lang]);
      if (streamError) setError(streamError);
    } catch (caught) {
      const aborted = caught instanceof Error && (caught.name === "AbortError" || caught.name === "TimeoutError");
      const message = aborted
        ? replyLang === "pt"
          ? "A resposta demorou demais e parei à espera do modelo. Se o registo já foi lido, fica no painel de contexto. Tenta outra vez."
          : "The reply took too long and I stopped waiting for the model. If the register was already read, it stays in the context panel. Try again."
        : caught instanceof Error
          ? caught.message
          : "Request failed";
      if (!finished) {
        setMessages((current) => [
          ...current,
          { id: crypto.randomUUID(), role: "assistant", text: message },
        ]);
      }
      setError(message);
      if (input.demo) throw caught instanceof Error ? caught : new Error(message);
    } finally {
      clearTimeout(timer);
      setProgress(null);
      setLiveTools([]);
      if (!input.keepBusy) setBusy(false);
    }
  }

  async function runDemo() {
    const id = crypto.randomUUID();
    window.localStorage.setItem("geg.session", id);
    setSessionId(id);
    setUnderstanding(null);
    setComparison(null);
    setConfirmed(false);
    setFolderCount(0);
    setPendingFiles([]);
    setPendingFolder(null);
    setError(null);
    setProgress(null);
    setLiveTools([]);
    setMessages([greeting(text)]);
    setBusy(true);
    try {
      const response = await fetch("/api/demo/seed", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sessionId: id }),
      });
      const seed = await response.json();
      if (!response.ok) throw new Error(seed.error || "Could not prepare the demo files.");
      await send({ text: text.step1, fileIds: [seed.fileId], fileLabels: [seed.fileName], demo: true, session: id, keepBusy: true });
      await send({ text: text.step2, demo: true, session: id, keepBusy: true });
      await send({ text: text.step3, folderNames: seed.folderNames, demo: true, session: id, keepBusy: true });
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Demo failed");
    } finally {
      setBusy(false);
    }
  }

  async function reset() {
    if (sessionId) await fetch(`/api/session?id=${sessionId}`, { method: "DELETE" });
    const id = crypto.randomUUID();
    window.localStorage.setItem("geg.session", id);
    setSessionId(id);
    setUnderstanding(null);
    setComparison(null);
    setConfirmed(false);
    setFolderCount(0);
    setPendingFiles([]);
    setPendingFolder(null);
    setDraft("");
    setError(null);
    setProgress(null);
    setLiveTools([]);
    setMessages([greeting(text)]);
  }

  function chooseLang(next: Lang) {
    setLang(next);
    setMessages((current) => {
      if (current.length <= 1) return [greeting(copy[next])];
      return [greeting(copy[next]), ...current.slice(1)];
    });
  }

  async function onRegister(list: FileList | null) {
    if (!list?.length || !sessionId) return;
    setBusy(true);
    setError(null);
    try {
      const uploaded: { id: string; name: string }[] = [];
      for (const file of [...list]) {
        const body = new FormData();
        body.set("sessionId", sessionId);
        body.set("file", file);
        const response = await fetch("/api/upload", { method: "POST", body });
        const data = await response.json();
        if (!response.ok) throw new Error(data.error || "Upload failed");
        uploaded.push({ id: data.id, name: data.name });
      }
      setPendingFiles((current) => [...current, ...uploaded]);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Upload failed");
    } finally {
      setBusy(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  }

  function onFolder(list: FileList | null) {
    if (!list?.length) return;
    const names = [...list].map((file) => file.webkitRelativePath || file.name).filter(Boolean);
    setPendingFolder(names);
    if (folderRef.current) folderRef.current.value = "";
  }

  const registerState = !understanding ? text.waiting : confirmed ? text.confirmed : text.needsConfirm;
  const folderState = pendingFolder
    ? `${pendingFolder.length}`
    : folderCount > 0
      ? String(folderCount)
      : comparison
        ? String(comparison.folderFiles)
        : "—";

  return (
    <div className="app">
      <header className="top">
        <div className="brand">
          <span className="stamp">GEG</span>
          <div>
            <p className="kicker">{text.kicker}</p>
            <h1>{text.product}</h1>
          </div>
        </div>
        <div className="top-actions">
          <div className="langs" role="group" aria-label="Language">
            <button type="button" className={lang === "en" ? "on" : ""} onClick={() => chooseLang("en")}>EN</button>
            <button type="button" className={lang === "pt" ? "on" : ""} onClick={() => chooseLang("pt")}>PT</button>
          </div>
          <button type="button" className="ghost context-toggle" onClick={() => setContextOpen((open) => !open)}>{text.context}</button>
          <button type="button" className="ghost" onClick={() => void reset()} disabled={busy}>{text.reset}</button>
          <button type="button" className="primary" onClick={() => void runDemo()} disabled={busy}>{text.demo}</button>
        </div>
      </header>

      <div className="shell">
        <main className="thread-wrap">
          {health ? (
            <p className={health.demoMode ? "banner demo" : "banner live"}>
              {health.demoMode
                ? text.demoBanner
                : `${text.modelBanner}: ${PROVIDER_LABEL[health.provider] ?? health.provider} · ${health.model}`}
            </p>
          ) : null}
          <div className="thread" ref={threadRef} aria-live="polite">
            {messages.map((message, index) => (
              <article key={message.id} className={`bubble ${message.role}`}>
                <header>
                  <span>{message.role === "user" ? text.you : text.bot}</span>
                  {message.tools?.length ? (
                    <span className="tools">
                      {message.tools.map((tool) => (
                        <span key={`${tool.name}-${tool.summary}`} className={tool.ok ? "tool" : "tool bad"} title={tool.summary}>
                          {toolLabel(tool)}
                        </span>
                      ))}
                    </span>
                  ) : null}
                </header>
                {message.attachments?.length ? (
                  <ul className="chips">
                    {message.attachments.map((name) => <li key={name}>{name}</li>)}
                  </ul>
                ) : null}
                {message.folderCount ? <p className="folder-chip">{text.folderLabel}: {message.folderCount}</p> : null}
                <RichText text={message.text} />
                {index === lastComparison && comparison ? (
                  <ComparisonTable comparison={comparison} lang={lang} copy={text} sessionId={sessionId} />
                ) : null}
              </article>
            ))}
            {busy ? (
              <p className="typing">
                {progress || `${text.typing}…`}
                {liveTools.length > 0 ? (
                  <span className="tools">
                    {liveTools.map((tool) => (
                      <span key={`${tool.name}-${tool.summary}`} className={tool.ok ? "tool" : "tool bad"} title={tool.summary}>
                        {toolLabel(tool)}
                      </span>
                    ))}
                  </span>
                ) : null}
              </p>
            ) : null}
            {error ? <p className="error">{error}</p> : null}
          </div>
          <form
            className="composer"
            onSubmit={(event) => {
              event.preventDefault();
              void send({
                text: draft,
                fileIds: pendingFiles.map((file) => file.id),
                fileLabels: pendingFiles.map((file) => file.name),
                folderNames: pendingFolder ?? undefined,
              });
            }}
          >
            <div className="suggest">
              {text.suggestions.map((suggestion) => (
                <button key={suggestion} type="button" onClick={() => setDraft(suggestion)}>{suggestion}</button>
              ))}
            </div>
            {(pendingFiles.length > 0 || pendingFolder) && (
              <ul className="staged">
                {pendingFiles.map((file) => (
                  <li key={file.id}>
                    {file.name}
                    <button type="button" onClick={() => setPendingFiles((current) => current.filter((item) => item.id !== file.id))} aria-label={`Remove ${file.name}`}>×</button>
                  </li>
                ))}
                {pendingFolder ? (
                  <li>
                    {text.folderLabel}: {pendingFolder.length} {text.filesStaged}
                    <button type="button" onClick={() => setPendingFolder(null)} aria-label={text.clearFolder}>×</button>
                  </li>
                ) : null}
              </ul>
            )}
            <div className="composer-row">
              <button type="button" className="ghost" onClick={() => fileRef.current?.click()}>{text.attach}</button>
              <button type="button" className="ghost" onClick={() => folderRef.current?.click()}>{text.folder}</button>
              <textarea
                value={draft}
                aria-label={text.placeholder}
                placeholder={text.placeholder}
                rows={2}
                onChange={(event) => setDraft(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter" && !event.shiftKey) {
                    event.preventDefault();
                    event.currentTarget.form?.requestSubmit();
                  }
                }}
              />
              <button type="submit" className="primary" disabled={busy || (!draft.trim() && pendingFiles.length === 0 && !pendingFolder)}>
                {text.send}
              </button>
            </div>
            <p className="privacy">{text.privacy}</p>
            <input ref={fileRef} hidden type="file" accept=".xlsx,.xlsm,.xls,.csv,.pdf" onChange={(event) => void onRegister(event.target.files)} />
            <input
              ref={folderRef}
              hidden
              type="file"
              multiple
              onChange={(event) => onFolder(event.target.files)}
              {...{ webkitdirectory: "", directory: "" }}
            />
          </form>
        </main>
        <aside className={contextOpen ? "sidebar open" : "sidebar"}>
          <h2>{text.context}</h2>
          <dl className="facts">
            <div><dt>{text.register}</dt><dd>{registerState}</dd></div>
            <div><dt>{text.folderLabel}</dt><dd>{folderState}</dd></div>
            <div><dt>{text.check}</dt><dd>{comparison ? `${comparison.missing + comparison.wrongRevision + comparison.extra}` : "—"}</dd></div>
          </dl>
          {understanding ? (
            <div className="understanding">
              <p><span>{text.sheets}</span> {understanding.sheets.map((sheet) => sheet.name).join(", ") || "—"}</p>
              <p><span>{text.header}</span> {understanding.headerRow ?? "—"}</p>
              <p><span>{text.column}</span> {understanding.numberColumn ?? "—"}</p>
              <p><span>{text.count}</span> {understanding.deliverableCount}</p>
              <p className="pattern"><span>{text.pattern}</span> <code>{understanding.pattern?.expression ?? "—"}</code></p>
              {understanding.codes.length > 0 ? (
                <p><span>{text.codes}</span> {understanding.codes.map((section) => section.category).join(", ")}</p>
              ) : null}
              {understanding.samples[0] ? <p className="sample"><code>{understanding.samples[0]}</code></p> : null}
            </div>
          ) : (
            <p className="muted">{text.noContext}</p>
          )}
        </aside>
      </div>
    </div>
  );
}

function greeting(used: Copy): UiMessage {
  return { id: "greeting", role: "assistant", text: used.greeting };
}

function toolLabel(tool: ToolTrace): string {
  if (tool.name === "parse_deliverables") return "parse";
  if (tool.name === "confirm_register") return "confirm";
  if (tool.name === "list_folder") return "folder";
  return tool.name;
}
