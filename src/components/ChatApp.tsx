"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { ComparisonTable } from "@/components/ComparisonTable";
import { RichText } from "@/components/RichText";
import { copy, type Copy } from "@/lib/uiCopy";
import type { Comparison, Lang, PublicUnderstanding, ToolTrace, UiMessage } from "@/lib/types";

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
  const [busy, setBusy] = useState(false);
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
      }
    }).catch(() => setError("Could not reach the app server."));
  }, []);

  useEffect(() => {
    threadRef.current?.scrollTo({ top: threadRef.current.scrollHeight, behavior: "smooth" });
  }, [messages, busy, comparison]);

  function applySession(data: {
    messages?: UiMessage[];
    understanding?: PublicUnderstanding | null;
    confirmed?: boolean;
    comparison?: Comparison | null;
  }, used: Copy) {
    setMessages([greeting(used), ...(data.messages ?? [])]);
    setUnderstanding(data.understanding ?? null);
    setConfirmed(Boolean(data.confirmed));
    setComparison(data.comparison ?? null);
  }

  async function send(input: SendInput) {
    const id = input.session ?? sessionId;
    const bodyText = input.text.trim();
    if (!id || (!bodyText && !input.fileIds?.length && !input.folderNames?.length)) return;
    setBusy(true);
    setError(null);
    const optimistic: UiMessage = {
      id: crypto.randomUUID(),
      role: "user",
      text: bodyText || text.attached,
      attachments: input.fileLabels,
      folderCount: input.folderNames?.length,
    };
    setMessages((current) => [...current, optimistic]);
    setDraft("");
    setPendingFiles([]);
    setPendingFolder(null);
    try {
      const response = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sessionId: id,
          text: bodyText,
          fileIds: input.fileIds,
          folderNames: input.folderNames,
          demo: input.demo === true,
          lang,
        }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Request failed");
      applySession(data, copy[lang]);
    } catch (caught) {
      const message = caught instanceof Error ? caught.message : "Request failed";
      setError(message);
      throw caught instanceof Error ? caught : new Error(message);
    } finally {
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
    setPendingFiles([]);
    setPendingFolder(null);
    setError(null);
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
    setPendingFiles([]);
    setPendingFolder(null);
    setDraft("");
    setError(null);
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
            {busy ? <p className="typing">{text.typing}…</p> : null}
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
