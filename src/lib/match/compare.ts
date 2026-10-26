import { basename, splitDocumentId } from "../documentNumber";
import type { Comparison, ComparisonRow, Deliverable } from "../types";

export type ExpectedDoc = Pick<Deliverable, "number" | "baseKey" | "revision">;

const STATUS_ORDER: Record<ComparisonRow["status"], number> = {
  wrong_revision: 0,
  missing: 1,
  extra: 2,
  ok: 3,
};

type Found = {
  path: string;
  baseKey: string;
  revision: string | null;
  used: boolean;
};

function analyze(path: string): Found | null {
  const name = basename(path).trim();
  if (!name || name.startsWith(".")) return null;
  const id = splitDocumentId(name);
  if (!id.baseKey) return null;
  return { path: path.trim(), baseKey: id.baseKey, revision: id.revision, used: false };
}

/**
 * Match deliverables to filenames.
 * Extensions are ignored. The key is the document identity without the revision
 * suffix. A different suffix is a wrong revision (expected vs found), not a miss
 * and not an unrelated extra file. Files that share the identity are consumed
 * together so a second revision is reported on the same row.
 */
export function compareDeliverables(
  expected: ExpectedDoc[],
  fileNames: string[],
): Omit<Comparison, "confirmed"> {
  const uniquePaths: string[] = [];
  const seenPath = new Set<string>();
  for (const name of fileNames) {
    const trimmed = name.trim();
    if (!trimmed) continue;
    const key = trimmed.toLowerCase();
    if (seenPath.has(key)) continue;
    seenPath.add(key);
    uniquePaths.push(trimmed);
  }

  const found = uniquePaths.map(analyze).filter((item): item is Found => item != null);
  const byBase = new Map<string, Found[]>();
  for (const item of found) {
    const list = byBase.get(item.baseKey) ?? [];
    list.push(item);
    byBase.set(item.baseKey, list);
  }

  const seenExpected = new Set<string>();
  const rows: ComparisonRow[] = [];

  for (const doc of expected) {
    const identity = `${doc.baseKey}|${doc.revision ?? ""}`;
    if (seenExpected.has(identity)) continue;
    seenExpected.add(identity);

    const hits = (byBase.get(doc.baseKey) ?? []).filter((item) => !item.used);
    if (hits.length === 0) {
      rows.push({
        status: "missing",
        deliverable: doc.number,
        expectedRevision: doc.revision,
        foundRevision: null,
        foundFiles: [],
        alsoFoundRevisions: [],
      });
      continue;
    }

    for (const item of hits) item.used = true;
    const exact = doc.revision ? hits.filter((item) => item.revision === doc.revision) : hits;

    if (doc.revision && exact.length === 0) {
      const revisions = [...new Set(hits.map((item) => item.revision).filter((rev): rev is string => Boolean(rev)))];
      rows.push({
        status: "wrong_revision",
        deliverable: doc.number,
        expectedRevision: doc.revision,
        foundRevision: revisions[0] ?? null,
        foundFiles: hits.map((item) => item.path),
        alsoFoundRevisions: revisions.slice(1),
      });
      continue;
    }

    const matched = exact.length > 0 ? exact : hits;
    const others = hits.filter((item) => !matched.includes(item));
    rows.push({
      status: "ok",
      deliverable: doc.number,
      expectedRevision: doc.revision,
      foundRevision: matched[0]?.revision ?? doc.revision,
      foundFiles: matched.map((item) => item.path),
      alsoFoundRevisions: [...new Set(others.map((item) => item.revision).filter((rev): rev is string => Boolean(rev)))],
    });
  }

  for (const item of found) {
    if (item.used) continue;
    item.used = true;
    rows.push({
      status: "extra",
      deliverable: null,
      expectedRevision: null,
      foundRevision: item.revision,
      foundFiles: [item.path],
      alsoFoundRevisions: [],
    });
  }

  rows.sort((a, b) => {
    const byStatus = STATUS_ORDER[a.status] - STATUS_ORDER[b.status];
    if (byStatus !== 0) return byStatus;
    return (a.deliverable ?? a.foundFiles[0] ?? "").localeCompare(b.deliverable ?? b.foundFiles[0] ?? "");
  });

  return {
    expected: seenExpected.size,
    folderFiles: uniquePaths.length,
    ok: rows.filter((row) => row.status === "ok").length,
    wrongRevision: rows.filter((row) => row.status === "wrong_revision").length,
    missing: rows.filter((row) => row.status === "missing").length,
    extra: rows.filter((row) => row.status === "extra").length,
    rows,
  };
}
