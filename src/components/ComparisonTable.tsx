"use client";

import { useEffect, useMemo, useState } from "react";
import type { Copy } from "@/lib/uiCopy";
import type { Comparison, ComparisonStatus, Lang } from "@/lib/types";

const PAGE = 12;

type Tab = "issues" | ComparisonStatus | "all";

export function ComparisonTable({
  comparison,
  lang,
  copy,
  sessionId,
}: {
  comparison: Comparison;
  lang: Lang;
  copy: Copy;
  sessionId: string;
}) {
  const [tab, setTab] = useState<Tab>(comparison.wrongRevision + comparison.missing + comparison.extra > 0 ? "issues" : "all");
  const [query, setQuery] = useState("");
  const [page, setPage] = useState(0);
  const [exporting, setExporting] = useState<"csv" | "xlsx" | null>(null);

  useEffect(() => {
    setTab(comparison.wrongRevision + comparison.missing + comparison.extra > 0 ? "issues" : "all");
    setPage(0);
    setQuery("");
  }, [comparison]);

  const rows = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return comparison.rows.filter((row) => {
      if (tab === "issues" && row.status === "ok") return false;
      if (tab !== "issues" && tab !== "all" && row.status !== tab) return false;
      if (!needle) return true;
      const hay = [row.deliverable, row.expectedRevision, row.foundRevision, ...row.foundFiles].filter(Boolean).join(" ").toLowerCase();
      return hay.includes(needle);
    });
  }, [comparison.rows, query, tab]);

  const pages = Math.max(1, Math.ceil(rows.length / PAGE));
  const visible = rows.slice(page * PAGE, page * PAGE + PAGE);

  async function download(format: "csv" | "xlsx") {
    setExporting(format);
    try {
      const response = await fetch(`/api/export?sessionId=${encodeURIComponent(sessionId)}&format=${format}&lang=${lang}`);
      if (!response.ok) return;
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = format === "csv" ? "geg-deliverables-check.csv" : "geg-deliverables-check.xlsx";
      link.click();
      URL.revokeObjectURL(url);
    } finally {
      setExporting(null);
    }
  }

  const tabs: { id: Tab; label: string; count: number }[] = [
    { id: "issues", label: copy.issues, count: comparison.wrongRevision + comparison.missing + comparison.extra },
    { id: "wrong_revision", label: copy.wrong, count: comparison.wrongRevision },
    { id: "missing", label: copy.missing, count: comparison.missing },
    { id: "extra", label: copy.extra, count: comparison.extra },
    { id: "ok", label: copy.found, count: comparison.ok },
    { id: "all", label: copy.all, count: comparison.rows.length },
  ];

  return (
    <section className="results">
      <div className="results-top">
        <div className="counts">
          <span className="count ok">{comparison.ok} {copy.found}</span>
          <span className="count bad">{comparison.wrongRevision} {copy.wrong}</span>
          <span className="count bad">{comparison.missing} {copy.missing}</span>
          <span className="count extra">{comparison.extra} {copy.extra}</span>
        </div>
        <div className="exports">
          <button type="button" onClick={() => download("csv")} disabled={exporting != null}>{exporting === "csv" ? "…" : copy.exportCsv}</button>
          <button type="button" onClick={() => download("xlsx")} disabled={exporting != null}>{exporting === "xlsx" ? "…" : copy.exportXlsx}</button>
        </div>
      </div>
      <div className="tabs" role="tablist">
        {tabs.map((item) => (
          <button
            key={item.id}
            type="button"
            role="tab"
            aria-selected={tab === item.id}
            className={tab === item.id ? "tab on" : "tab"}
            onClick={() => {
              setTab(item.id);
              setPage(0);
            }}
          >
            {item.label} <em>{item.count}</em>
          </button>
        ))}
      </div>
      <label className="filter">
        <span className="sr">{copy.search}</span>
        <input value={query} onChange={(event) => { setQuery(event.target.value); setPage(0); }} placeholder={copy.search} />
      </label>
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>{copy.status}</th>
              <th>{copy.document}</th>
              <th>{copy.revisions}</th>
              <th>{copy.files}</th>
            </tr>
          </thead>
          <tbody>
            {visible.length === 0 ? (
              <tr>
                <td colSpan={4} className="empty">{copy.empty}</td>
              </tr>
            ) : (
              visible.map((row, index) => (
                <tr key={`${row.status}-${row.deliverable ?? row.foundFiles[0]}-${index}`}>
                  <td><span className={`pill ${row.status}`}>{label(row.status, copy)}</span></td>
                  <td className="mono">{row.deliverable ?? row.foundFiles[0]}</td>
                  <td>
                    {row.status === "wrong_revision" ? (
                      <span className="revpair">
                        <span>{copy.expected} {row.expectedRevision ?? "—"}</span>
                        <span className="arrow" aria-hidden>→</span>
                        <span>{copy.foundRev} {row.foundRevision ?? "—"}</span>
                      </span>
                    ) : row.status === "extra" ? (
                      <span>{row.foundRevision ?? "—"}</span>
                    ) : (
                      <span>
                        {row.expectedRevision ?? "—"}
                        {row.alsoFoundRevisions.length > 0 ? ` · ${copy.also} ${row.alsoFoundRevisions.join(", ")}` : ""}
                      </span>
                    )}
                  </td>
                  <td className="files">{row.foundFiles.length ? row.foundFiles.join(", ") : "—"}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
      {pages > 1 ? (
        <div className="pager">
          <button type="button" disabled={page === 0} onClick={() => setPage((value) => value - 1)}>←</button>
          <span>{copy.page} {page + 1} / {pages}</span>
          <button type="button" disabled={page + 1 >= pages} onClick={() => setPage((value) => value + 1)}>→</button>
        </div>
      ) : null}
    </section>
  );
}

function label(status: ComparisonStatus, copy: Copy): string {
  if (status === "ok") return copy.found;
  if (status === "wrong_revision") return copy.wrong;
  if (status === "missing") return copy.missing;
  return copy.extra;
}
