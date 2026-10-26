import * as XLSX from "xlsx";
import {
  columnIndexFromLetter,
  columnLetter,
  isDocumentNumber,
  normKey,
  splitDocumentId,
  stripKnownExtension,
} from "../documentNumber";
import type {
  Deliverable,
  ParseOverrides,
  RegisterUnderstanding,
  SheetSummary,
} from "../types";
import { findSegmentWidths, parseCodeSheet } from "./codes";
import { inferPattern } from "./pattern";

export type ParsedSheet = {
  name: string;
  rows: string[][];
};

const HEADER_WEIGHTS: { phrase: string; weight: number }[] = [
  { phrase: "drawing numbering", weight: 12 },
  { phrase: "drawing number", weight: 11 },
  { phrase: "document number", weight: 10 },
  { phrase: "numero do documento", weight: 10 },
  { phrase: "n do documento", weight: 8 },
  { phrase: "deliverable number", weight: 9 },
  { phrase: "deliverable no", weight: 8 },
  { phrase: "doc number", weight: 8 },
  { phrase: "doc no", weight: 7 },
  { phrase: "file name", weight: 6 },
  { phrase: "filename", weight: 6 },
  { phrase: "numbering", weight: 6 },
  { phrase: "numeracao", weight: 6 },
];

function cellText(cell: XLSX.CellObject | undefined): string {
  if (!cell) return "";
  if (cell.w != null && String(cell.w).trim()) return String(cell.w).trim();
  if (cell.v != null) return String(cell.v).trim();
  return "";
}

export function sheetToMatrix(sheet: XLSX.WorkSheet): string[][] {
  const ref = sheet["!ref"];
  if (!ref) return [];
  const range = XLSX.utils.decode_range(ref);
  const rows: string[][] = [];
  for (let rowIndex = range.s.r; rowIndex <= range.e.r; rowIndex += 1) {
    const row: string[] = [];
    for (let colIndex = range.s.c; colIndex <= range.e.c; colIndex += 1) {
      const address = XLSX.utils.encode_cell({ r: rowIndex, c: colIndex });
      row.push(cellText(sheet[address]));
    }
    rows.push(row);
  }
  return rows;
}

export function readTabularBuffer(buffer: Buffer, filename: string): { kind: "xlsx" | "csv"; sheets: ParsedSheet[] } {
  const lower = filename.toLowerCase();
  if (lower.endsWith(".csv")) {
    const text = buffer.toString("utf8").replace(/^\uFEFF/, "");
    const book = XLSX.read(text, { type: "string" });
    const name = book.SheetNames[0] ?? "CSV";
    return {
      kind: "csv",
      sheets: [{ name: name === "Sheet1" ? "CSV" : name, rows: sheetToMatrix(book.Sheets[name]) }],
    };
  }
  const book = XLSX.read(buffer, { type: "buffer", cellDates: false });
  return {
    kind: "xlsx",
    sheets: book.SheetNames.map((name) => ({
      name,
      rows: sheetToMatrix(book.Sheets[name]),
    })),
  };
}

function headerScore(row: string[]): number {
  let score = 0;
  for (const cell of row) {
    const key = normKey(cell);
    if (!key) continue;
    if (isDocumentNumber(cell)) score -= 6;
    for (const hint of HEADER_WEIGHTS) {
      if (key.includes(hint.phrase)) score += hint.weight;
    }
  }
  return score;
}

function columnNameScore(header: string): number {
  const key = normKey(header);
  if (!key) return 0;
  if (key.includes("drawing numbering")) return 20;
  if (key.includes("drawing number")) return 18;
  if (key.includes("document number") || key.includes("numero do documento")) return 16;
  if (key.includes("deliverable")) return 12;
  if (key.includes("numbering") || key.includes("numeracao")) return 14;
  if (key.includes("filename") || key.includes("file name")) return 10;
  if (key === "number" || key === "no" || key === "no.") return 5;
  return 0;
}

function countDocs(rows: string[][], column: number, startRow: number): number {
  let count = 0;
  for (let index = startRow; index < rows.length; index += 1) {
    if (isDocumentNumber(rows[index]?.[column] ?? "")) count += 1;
  }
  return count;
}

function headingLabel(row: string[]): string | null {
  const filled = row.map((cell) => cell.trim()).filter(Boolean);
  if (filled.length === 0) return null;
  const text = filled.join(" ").replace(/\s+/g, " ").trim();
  if (isDocumentNumber(text)) return null;
  if (/^(folder|book|pasta|livro|section|secao|capitulo)\b/i.test(text)) return text;
  if (filled.length === 1 && text.length <= 80 && /folder|book|pasta|livro/i.test(text)) return text;
  return null;
}

type ColumnPick = {
  headerRow: number;
  column: number;
  score: number;
  docCount: number;
};

function detectTable(rows: string[][]): ColumnPick | null {
  let best: ColumnPick | null = null;
  const lastHeader = Math.min(rows.length - 1, 40);
  for (let rowIndex = 0; rowIndex <= lastHeader; rowIndex += 1) {
    const row = rows[rowIndex] ?? [];
    const score = headerScore(row);
    if (score < 8) continue;
    const width = Math.max(row.length, ...rows.slice(rowIndex + 1, rowIndex + 12).map((item) => item.length));
    for (let column = 0; column < width; column += 1) {
      const docs = countDocs(rows, column, rowIndex + 1);
      const combined = score + columnNameScore(row[column] ?? "") + docs;
      const candidate = { headerRow: rowIndex, column, score: combined, docCount: docs };
      if (
        !best ||
        candidate.docCount > best.docCount ||
        (candidate.docCount === best.docCount && candidate.score > best.score)
      ) {
        best = candidate;
      }
    }
  }
  if (best && best.docCount > 0) return best;

  let fallbackCol = -1;
  let fallbackCount = 0;
  const width = rows.reduce((max, row) => Math.max(max, row.length), 0);
  for (let column = 0; column < width; column += 1) {
    const docs = countDocs(rows, column, 0);
    if (docs > fallbackCount) {
      fallbackCount = docs;
      fallbackCol = column;
    }
  }
  if (fallbackCol < 0 || fallbackCount === 0) return null;
  let headerRow = 0;
  for (let rowIndex = 0; rowIndex < rows.length; rowIndex += 1) {
    if (isDocumentNumber(rows[rowIndex]?.[fallbackCol] ?? "")) {
      headerRow = Math.max(0, rowIndex - 1);
      break;
    }
  }
  return { headerRow, column: fallbackCol, score: 0, docCount: fallbackCount };
}

function columnLabel(header: string, index: number): string {
  const trimmed = header.trim();
  return trimmed || `Column ${columnLetter(index)}`;
}

function applyColumnOverride(
  rows: string[][],
  headerRow: number,
  override: string | undefined,
): { column: number | null; warning?: string } {
  if (!override) return { column: null };
  const trimmed = override.trim();
  const wanted = normKey(trimmed);
  const header = rows[headerRow] ?? [];
  const exact = header.findIndex((cell) => normKey(cell) === wanted);
  if (exact >= 0) return { column: exact };
  const partial = header.findIndex((cell) => wanted.length >= 4 && normKey(cell).includes(wanted));
  if (partial >= 0) return { column: partial };
  // A one- or two-letter token that is not a header is an Excel column ("B").
  if (/^[A-Za-z]{1,2}$/.test(trimmed)) {
    const letter = columnIndexFromLetter(trimmed);
    if (letter != null) return { column: letter };
  }
  return { column: null, warning: `Column "${override}" was not found on the header row.` };
}

export function parseSheets(
  sheets: ParsedSheet[],
  filename: string,
  kind: RegisterUnderstanding["kind"],
  overrides: ParseOverrides = {},
): RegisterUnderstanding {
  const warnings: string[] = [];
  const tables = sheets.map((sheet) => ({ sheet, table: detectTable(sheet.rows) }));
  let register = [...tables].sort((a, b) => (b.table?.docCount ?? 0) - (a.table?.docCount ?? 0))[0];

  const codesBySheet = sheets.map((sheet) => ({
    sheet,
    codes: parseCodeSheet(sheet.rows),
  }));
  const registerDocCount = register?.table?.docCount ?? 0;
  const codeCarrier = [...codesBySheet]
    .filter((item) => item.codes.length >= 2)
    .filter((item) => item.sheet !== register?.sheet || registerDocCount < 3)
    .sort((a, b) => {
      const entries = (candidate: { codes: { entries: unknown[] }[] }) =>
        candidate.codes.reduce((sum, section) => sum + section.entries.length, 0);
      return entries(b) - entries(a);
    })[0];
  const codes = codeCarrier?.codes ?? [];

  if (overrides.sheetName) {
    const wanted = normKey(overrides.sheetName);
    const found = tables.find((item) => normKey(item.sheet.name) === wanted)
      ?? tables.find((item) => normKey(item.sheet.name).includes(wanted));
    if (found) register = found;
    else warnings.push(`Sheet "${overrides.sheetName}" was not found. Stayed with the best match.`);
  }

  const sheetSummaries: SheetSummary[] = sheets.map((sheet) => {
    const codeHit = codesBySheet.find((item) => item.sheet === sheet);
    const tableHit = tables.find((item) => item.sheet === sheet);
    let role: SheetSummary["role"] = "other";
    if (register?.sheet === sheet && (tableHit?.table?.docCount ?? 0) > 0) role = "register";
    else if ((codeHit?.codes.length ?? 0) >= 2) role = "codes";
    return { name: sheet.name, role, rows: sheet.rows.length };
  });

  const empty: RegisterUnderstanding = {
    fileName: filename,
    kind,
    sheets: sheetSummaries,
    codes,
    registerSheet: null,
    headerRow: null,
    numberColumn: null,
    numberColumnIndex: null,
    pattern: null,
    deliverableCount: 0,
    deliverables: [],
    samples: [],
    skippedHeadings: [],
    skippedHeadingCount: 0,
    warnings,
    overrides,
  };

  if (!register?.table) {
    warnings.push("No document-number column was found.");
    return { ...empty, registerSheet: register?.sheet.name ?? null };
  }

  let headerRow = register.table.headerRow;
  if (overrides.headerRow && overrides.headerRow >= 1) {
    const index = overrides.headerRow - 1;
    if (index >= register.sheet.rows.length) {
      warnings.push(`Header row ${overrides.headerRow} is outside the sheet.`);
    } else {
      headerRow = index;
    }
  }

  let column = register.table.column;
  const forced = applyColumnOverride(register.sheet.rows, headerRow, overrides.numberColumn);
  if (forced.warning) warnings.push(forced.warning);
  if (forced.column != null) column = forced.column;

  const headerName = columnLabel(register.sheet.rows[headerRow]?.[column] ?? "", column);
  const deliverables: Deliverable[] = [];
  const skippedHeadings: string[] = [];
  let skippedHeadingCount = 0;
  const revisionHeaderIndex = (register.sheet.rows[headerRow] ?? []).findIndex((cell) => {
    const key = normKey(cell);
    return key === "rev" || key === "rev." || key === "revision" || key === "revisao";
  });
  let revisionMismatches = 0;

  for (let rowIndex = headerRow + 1; rowIndex < register.sheet.rows.length; rowIndex += 1) {
    const row = register.sheet.rows[rowIndex] ?? [];
    const rawCell = (row[column] ?? "").trim();
    if (!rawCell) {
      const heading = headingLabel(row);
      if (heading) {
        skippedHeadingCount += 1;
        if (skippedHeadings.length < 6) skippedHeadings.push(heading);
      }
      continue;
    }
    const cleaned = stripKnownExtension(rawCell);
    if (!isDocumentNumber(cleaned)) {
      const heading = headingLabel(row) ?? (headingLabel([rawCell]) ? rawCell : null);
      if (heading) {
        skippedHeadingCount += 1;
        if (skippedHeadings.length < 6) skippedHeadings.push(heading);
      }
      continue;
    }
    const id = splitDocumentId(cleaned);
    if (revisionHeaderIndex >= 0) {
      const revCell = (row[revisionHeaderIndex] ?? "").trim().toUpperCase();
      if (revCell && id.revision && revCell !== id.revision) revisionMismatches += 1;
    }
    deliverables.push({
      number: cleaned,
      base: id.base,
      baseKey: id.baseKey,
      revision: id.revision,
      row: rowIndex + 1,
      sheet: register.sheet.name,
    });
  }

  if (revisionMismatches > 0) {
    warnings.push(
      `${revisionMismatches} row(s) have a revision column that disagrees with the suffix on the document number. The suffix is used for the check.`,
    );
  }
  if (skippedHeadingCount > 0) {
    warnings.push(`${skippedHeadingCount} section row(s) were skipped (for example folder or book headings).`);
  }

  const widths = findSegmentWidths(sheets, codes);
  const pattern = inferPattern(
    deliverables.map((item) => item.number),
    widths,
  );
  if (pattern && pattern.consistent < pattern.sampled) {
    warnings.push(
      `Naming pattern is consistent on ${pattern.consistent} of ${pattern.sampled} sampled numbers.`,
    );
  }
  if (pattern && pattern.expression.startsWith("Region-") && !pattern.tail?.sheetType) {
    warnings.push("The tail of the number was not split into sheet type, chapter, and serial. Code widths were not both fixed.");
  }

  return {
    ...empty,
    registerSheet: register.sheet.name,
    headerRow: headerRow + 1,
    numberColumn: headerName,
    numberColumnIndex: column,
    pattern,
    deliverableCount: deliverables.length,
    deliverables,
    samples: deliverables.slice(0, 5).map((item) => item.number),
    skippedHeadings,
    skippedHeadingCount,
    warnings,
  };
}

export function parseRegisterBuffer(
  buffer: Buffer,
  filename: string,
  overrides: ParseOverrides = {},
): RegisterUnderstanding {
  const tabular = readTabularBuffer(buffer, filename);
  return parseSheets(tabular.sheets, filename, tabular.kind, overrides);
}
