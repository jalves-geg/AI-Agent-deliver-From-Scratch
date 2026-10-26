import type { Session } from "../session/store";
import type { ToolResult } from "../tools/types";

const LIMIT = 6_000;

export function buildModelDigest(session: Session): string {
  const lines: string[] = [];
  const register = session.register;
  if (register) {
    lines.push(`Register file: ${register.fileName}`);
    lines.push(
      `Sheets: ${register.sheets.map((sheet) => `${sheet.name} (${sheet.role}, ${sheet.rows} rows)`).join("; ") || "none"}`,
    );
    lines.push(`Header row: ${register.headerRow ?? "n/a"}`);
    lines.push(`Number column: ${register.numberColumn ?? "n/a"}`);
    lines.push(`Pattern: ${register.pattern?.expression ?? "n/a"}`);
    lines.push(`Deliverables: ${register.deliverableCount}`);
    lines.push(`Samples: ${register.samples.slice(0, 5).join(", ") || "none"}`);
    lines.push(
      `Section rows skipped: ${register.skippedHeadingCount}${
        register.skippedHeadings.length ? ` e.g. ${register.skippedHeadings.slice(0, 3).join(" | ")}` : ""
      }`,
    );
    if (register.codes.length > 0) {
      lines.push(`Code lists: ${register.codes.map((section) => section.category).join(", ")}`);
    }
    if (register.warnings.length > 0) lines.push(`Notes: ${register.warnings.slice(0, 4).join(" | ")}`);
  }
  const comparison = session.comparison;
  if (comparison) {
    lines.push(
      `Comparison: expected ${comparison.expected}, folder files ${comparison.folderFiles}, correct ${comparison.ok}, wrong revision ${comparison.wrongRevision}, missing ${comparison.missing}, extra ${comparison.extra}`,
    );
    const issues = comparison.rows.filter((row) => row.status !== "ok").slice(0, 8);
    for (const row of issues) {
      lines.push(
        `- ${row.status}: ${row.deliverable ?? "—"} expected ${row.expectedRevision ?? "—"} found ${row.foundRevision ?? "—"} in ${row.foundFiles[0] ?? "—"}`,
      );
    }
    const omitted = comparison.rows.filter((row) => row.status !== "ok").length - issues.length;
    if (omitted > 0) lines.push(`- ${omitted} further issues stay in the results table and were not sent to the model.`);
  }
  const text = lines.join("\n");
  return text.length > LIMIT ? `${text.slice(0, LIMIT)}\n…truncated` : text;
}

export function compactToolContent(result: ToolResult): string {
  let data = result.data;
  if (data && typeof data === "object" && !Array.isArray(data)) {
    const copy = { ...(data as Record<string, unknown>) };
    delete copy.deliverables;
    delete copy.rows;
    if (Array.isArray(copy.issues)) copy.issues = copy.issues.slice(0, 8);
    data = copy;
  }
  const payload = { ok: result.ok, summary: result.summary, data };
  const text = JSON.stringify(payload);
  if (text.length <= LIMIT) return text;
  return JSON.stringify({
    ok: result.ok,
    summary: result.summary,
    note: "Details truncated so the model is not sent the full register. The results table has every row.",
  });
}
