"use client";

import { useEffect, useRef, useState } from "react";
import type { ConversationSummary } from "@/lib/conversations/model";
import type { Copy } from "@/lib/uiCopy";

export function ConversationList({
  copy,
  conversations,
  activeId,
  open,
  disabled,
  storageFailed,
  renameRequest,
  onSelect,
  onCreate,
  onRename,
  onDelete,
}: {
  copy: Copy;
  conversations: ConversationSummary[];
  activeId: string;
  open: boolean;
  disabled: boolean;
  storageFailed: boolean;
  renameRequest: { id: string; name: string; nonce: number } | null;
  onSelect: (id: string) => void;
  onCreate: () => void;
  onRename: (id: string, name: string) => Promise<boolean> | boolean;
  onDelete: (id: string) => void;
}) {
  const [renameId, setRenameId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState("");
  const [pendingDelete, setPendingDelete] = useState<ConversationSummary | null>(null);
  const renameInput = useRef<HTMLInputElement>(null);
  const cancelButton = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!renameRequest) return;
    setRenameId(renameRequest.id);
    setRenameValue(renameRequest.name);
  }, [renameRequest]);

  useEffect(() => {
    if (!renameId) return;
    renameInput.current?.focus();
    renameInput.current?.select();
  }, [renameId]);

  useEffect(() => {
    if (!pendingDelete) return;
    cancelButton.current?.focus();
  }, [pendingDelete]);

  function startRename(id: string, currentName: string) {
    setRenameId(id);
    setRenameValue(currentName);
  }

  async function commitRename() {
    if (!renameId) return;
    const ok = await onRename(renameId, renameValue);
    if (ok) setRenameId(null);
  }

  return (
    <aside className={open ? "convos open" : "convos"} aria-label={copy.conversations}>
      <div className="convos-head">
        <h2>{copy.conversations}</h2>
        <button type="button" className="convo-new" onClick={onCreate} disabled={disabled}>
          {copy.newConversation}
        </button>
      </div>
      <p className="convo-hint">{copy.conversationHint}</p>
      {storageFailed ? <p className="storage-note">{copy.storageError}</p> : null}
      <div className="convo-list" role="list">
        {conversations.map((conversation) => {
          const active = conversation.id === activeId;
          const editing = renameId === conversation.id;
          return (
            <div key={conversation.id} className={active ? "convo active" : "convo"} role="listitem">
              {editing ? (
                <form
                  className="convo-rename"
                  onSubmit={(event) => {
                    event.preventDefault();
                    void commitRename();
                  }}
                >
                  <input
                    ref={renameInput}
                    aria-label={copy.renameLabel}
                    value={renameValue}
                    maxLength={80}
                    onChange={(event) => setRenameValue(event.target.value)}
                    onKeyDown={(event) => {
                      if (event.key === "Escape") {
                        event.preventDefault();
                        setRenameId(null);
                      }
                    }}
                    onBlur={(event) => {
                      const next = event.relatedTarget as HTMLElement | null;
                      if (next?.dataset.action === "cancel-rename") return;
                      void commitRename();
                    }}
                  />
                  <div className="convo-rename-actions">
                    <button type="submit">{copy.saveName}</button>
                    <button type="button" data-action="cancel-rename" onClick={() => setRenameId(null)}>
                      {copy.cancel}
                    </button>
                  </div>
                </form>
              ) : (
                <>
                  <button
                    type="button"
                    className="convo-select"
                    aria-current={active ? "page" : undefined}
                    onClick={() => onSelect(conversation.id)}
                    onDoubleClick={() => startRename(conversation.id, conversation.name)}
                    disabled={disabled}
                  >
                    <span className="convo-name">{conversation.name}</span>
                    {conversation.hasCheck ? <span className="convo-meta">{copy.check}</span> : null}
                    {!conversation.hasCheck && conversation.hasRegister ? <span className="convo-meta">{copy.register}</span> : null}
                  </button>
                  <div className="convo-actions">
                    <button
                      type="button"
                      onClick={() => startRename(conversation.id, conversation.name)}
                      disabled={disabled}
                    >
                      {copy.rename}
                    </button>
                    <button
                      type="button"
                      onClick={() => setPendingDelete(conversation)}
                      disabled={disabled}
                    >
                      {copy.deleteConversation}
                    </button>
                  </div>
                </>
              )}
            </div>
          );
        })}
      </div>
      {pendingDelete ? (
        <div
          className="modal"
          role="dialog"
          aria-modal="true"
          aria-labelledby="delete-convo-title"
          onKeyDown={(event) => {
            if (event.key === "Escape") setPendingDelete(null);
          }}
        >
          <div className="modal-card">
            <h2 id="delete-convo-title">{copy.deleteTitle}</h2>
            <p>{copy.deleteBody.replaceAll("{name}", pendingDelete.name)}</p>
            <div className="modal-actions">
              <button ref={cancelButton} type="button" className="ghost" onClick={() => setPendingDelete(null)}>
                {copy.cancel}
              </button>
              <button
                type="button"
                className="danger"
                onClick={() => {
                  const id = pendingDelete.id;
                  setPendingDelete(null);
                  onDelete(id);
                }}
              >
                {copy.deleteConversation}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </aside>
  );
}
