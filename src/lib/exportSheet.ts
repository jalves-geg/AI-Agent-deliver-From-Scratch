import * as XLSX from "xlsx";
import type { Comparison, Lang } from "./types";

const STATUS_LABEL: Record<Lang, Record<Comparison["rows"][number]["status"], string>> = {
  en: {
    ok: "Found",
    wrong_revision: "Wrong revision",
    missing: "Missing",
    extra: "Extra",
  },
  pt: {
    ok: "Encontrado",
    wrong_revision: "Revisão diferente",
    missing: "Em falta",
    extra: "A mais",
  },
};

function headers(lang: Lang): string[] {
  return lang === "pt"
    ? ["Estado", "Entregável", "Revisão esperada", "Revisão encontrada", "Ficheiros encontrados", "Outras revisões"]
    : ["Status", "Deliverable", "Expected revision", "Found revision", "Found files", "Other revisions"];
}

function cell(value: string): string {
  return /^[=+\-@]/.test(value) ? `'${value}` : value;
}

export function comparisonRows(comparison: Comparison, lang: Lang): string[][] {
  const body = comparison.rows.map((row) => [
    cell(STATUS_LABEL[lang][row.status]),
    cell(row.deliverable ?? ""),
    cell(row.expectedRevision ?? ""),
    cell(row.foundRevision ?? ""),
    cell(row.foundFiles.join("; ")),
    cell(row.alsoFoundRevisions.join("; ")),
  ]);
  return [headers(lang), ...body];
}

export function comparisonToCsv(comparison: Comparison, lang: Lang): string {
  const rows = comparisonRows(comparison, lang);
  const csv = rows
    .map((row) =>
      row
        .map((value) => (/[",\n\r]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value))
        .join(","),
    )
    .join("\r\n");
  return `\uFEFF${csv}`;
}

export function comparisonToXlsx(comparison: Comparison, lang: Lang): Buffer {
  const sheet = XLSX.utils.aoa_to_sheet(comparisonRows(comparison, lang));
  sheet["!cols"] = [{ wch: 20 }, { wch: 52 }, { wch: 18 }, { wch: 20 }, { wch: 64 }, { wch: 22 }];
  const book = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(book, sheet, lang === "pt" ? "Conferencia" : "Check");
  return XLSX.write(book, { type: "buffer", bookType: "xlsx" }) as Buffer;
}
