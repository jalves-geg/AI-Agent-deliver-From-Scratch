import { normKey } from "../documentNumber";
import type { CodeEntry, CodeSection } from "../types";

const CATEGORIES: { label: string; aliases: string[] }[] = [
  { label: "Region", aliases: ["region", "regiao"] },
  { label: "Asset", aliases: ["asset", "ativo"] },
  { label: "Contract", aliases: ["contract", "contrato"] },
  { label: "Organization", aliases: ["organization", "organisation", "organizacao", "org"] },
  { label: "Discipline", aliases: ["discipline", "disciplina"] },
  {
    label: "Document type",
    aliases: ["document type", "doc type", "doctype", "tipo de documento", "tipo documento"],
  },
  { label: "Sheet type", aliases: ["sheet type", "sheettype", "tipo de folha", "tipo folha"] },
  { label: "Chapter", aliases: ["chapter", "capitulo"] },
];

export function matchCategory(value: string): { label: string } | null {
  const key = normKey(value);
  if (!key) return null;
  for (const category of CATEGORIES) {
    if (category.aliases.includes(key)) return { label: category.label };
  }
  return null;
}

function isNameCodeHeader(cells: string[]): boolean {
  const keys = cells.map(normKey).filter(Boolean);
  const hasCode = keys.some((cell) => cell === "code" || cell === "codigo");
  const hasName = keys.some(
    (cell) => cell === "name" || cell === "nome" || cell === "description" || cell === "descricao",
  );
  return hasCode && hasName;
}

function nonEmpty(row: string[]): { value: string; index: number }[] {
  const out: { value: string; index: number }[] = [];
  row.forEach((value, index) => {
    const trimmed = value.trim();
    if (trimmed) out.push({ value: trimmed, index });
  });
  return out;
}

function parseStacked(rows: string[][]): CodeSection[] | null {
  const sections: CodeSection[] = [];
  let current: CodeSection | null = null;
  for (const row of rows) {
    const cells = row.map((cell) => cell.trim());
    const filled = nonEmpty(cells);
    if (filled.length === 0) {
      current = null;
      continue;
    }
    if (filled.length === 1) {
      const category = matchCategory(filled[0].value);
      if (category) {
        current = { category: category.label, entries: [] };
        sections.push(current);
        continue;
      }
    }
    if (!current) continue;
    if (isNameCodeHeader(cells)) continue;
    if (filled.length < 2) continue;
    const name = cells[filled[0].index];
    const code = cells[filled[1].index];
    if (!name || !code || matchCategory(name)) continue;
    current.entries.push({ name, code });
  }
  const useful = sections.filter((section) => section.entries.length > 0);
  return useful.length >= 2 ? useful : null;
}

function parseSideBySide(rows: string[][]): CodeSection[] | null {
  let headerIndex = -1;
  let anchors: { col: number; label: string }[] = [];
  const scanUntil = Math.min(rows.length, 40);
  for (let rowIndex = 0; rowIndex < scanUntil; rowIndex += 1) {
    const found: { col: number; label: string }[] = [];
    rows[rowIndex].forEach((cell, col) => {
      const category = matchCategory(cell);
      if (category) found.push({ col, label: category.label });
    });
    const paired = found.filter((anchor) => {
      const next = normKey(rows[rowIndex][anchor.col + 1] ?? "");
      return next === "code" || next === "codigo" || next === "";
    });
    if (paired.length >= 2) {
      headerIndex = rowIndex;
      anchors = paired;
      break;
    }
  }
  if (headerIndex < 0) return null;
  const sections: CodeSection[] = anchors.map((anchor) => ({
    category: anchor.label,
    entries: [],
  }));
  for (let rowIndex = headerIndex + 1; rowIndex < rows.length; rowIndex += 1) {
    const row = rows[rowIndex];
    anchors.forEach((anchor, index) => {
      const name = (row[anchor.col] ?? "").trim();
      const code = (row[anchor.col + 1] ?? "").trim();
      if (!name || !code) return;
      if (isNameCodeHeader([name, code])) return;
      if (matchCategory(name)) return;
      sections[index].entries.push({ name, code });
    });
  }
  const useful = sections.filter((section) => section.entries.length > 0);
  return useful.length >= 2 ? useful : null;
}

function parseLong(rows: string[][]): CodeSection[] | null {
  let header = -1;
  let categoryCol = -1;
  let nameCol = -1;
  let codeCol = -1;
  const scanUntil = Math.min(rows.length, 25);
  for (let rowIndex = 0; rowIndex < scanUntil; rowIndex += 1) {
    const cells = rows[rowIndex].map(normKey);
    const foundCategory = cells.findIndex(
      (cell) => cell === "category" || cell === "categoria" || cell === "type" || cell === "tipo",
    );
    const foundCode = cells.findIndex((cell) => cell === "code" || cell === "codigo");
    const foundName = cells.findIndex(
      (cell) => cell === "name" || cell === "nome" || cell === "description" || cell === "descricao",
    );
    if (foundCategory >= 0 && foundCode >= 0 && foundName >= 0) {
      header = rowIndex;
      categoryCol = foundCategory;
      nameCol = foundName;
      codeCol = foundCode;
      break;
    }
  }
  if (header < 0) return null;
  const grouped = new Map<string, CodeEntry[]>();
  for (let rowIndex = header + 1; rowIndex < rows.length; rowIndex += 1) {
    const row = rows[rowIndex];
    const category = matchCategory(row[categoryCol] ?? "");
    const name = (row[nameCol] ?? "").trim();
    const code = (row[codeCol] ?? "").trim();
    if (!category || !name || !code) continue;
    const list = grouped.get(category.label) ?? [];
    list.push({ name, code });
    grouped.set(category.label, list);
  }
  const sections = [...grouped.entries()].map(([category, entries]) => ({ category, entries }));
  return sections.length >= 2 ? sections : null;
}

function score(sections: CodeSection[] | null): number {
  if (!sections) return 0;
  return sections.reduce((sum, section) => sum + section.entries.length, 0) + sections.length * 2;
}

export function parseCodeSheet(rows: string[][]): CodeSection[] {
  const candidates = [parseStacked(rows), parseSideBySide(rows), parseLong(rows)];
  candidates.sort((a, b) => score(b) - score(a));
  return candidates[0] ?? [];
}

export function findSegmentWidths(
  sheets: { rows: string[][] }[],
  codes: CodeSection[],
): { sheet?: number; chapter?: number } {
  const widths: { sheet?: number; chapter?: number } = {};
  for (const sheet of sheets) {
    for (const row of sheet.rows) {
      const label = normKey(row[0] ?? "");
      const value = (row[1] ?? "").trim();
      if (!/^\d{1,2}$/.test(value)) continue;
      if (label === "sheet type width") widths.sheet = Number(value);
      if (label === "chapter width") widths.chapter = Number(value);
    }
  }
  if (!widths.sheet) {
    const section = codes.find((item) => item.category === "Sheet type");
    const lengths = new Set((section?.entries ?? []).map((entry) => entry.code.trim().length).filter(Boolean));
    if (lengths.size === 1) widths.sheet = [...lengths][0];
  }
  if (!widths.chapter) {
    const section = codes.find((item) => item.category === "Chapter");
    const lengths = new Set((section?.entries ?? []).map((entry) => entry.code.trim().length).filter(Boolean));
    if (lengths.size === 1) widths.chapter = [...lengths][0];
  }
  return widths;
}
