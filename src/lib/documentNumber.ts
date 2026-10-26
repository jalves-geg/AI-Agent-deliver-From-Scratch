const EXTENSIONS = new Set([
  "pdf",
  "doc",
  "docx",
  "xls",
  "xlsx",
  "xlsm",
  "csv",
  "dwg",
  "dxf",
  "zip",
  "png",
  "jpg",
  "jpeg",
  "tif",
  "tiff",
  "ppt",
  "pptx",
  "txt",
  "rvt",
  "nwd",
  "nwc",
  "ifc",
  "xml",
  "dgn",
  "step",
  "stp",
]);

/** Hyphenated engineering number, optional short revision suffix. */
export const DOC_NUMBER_RE =
  /^[A-Za-z0-9]{1,12}(?:-[A-Za-z0-9]{1,24}){5,10}(?:_[A-Za-z0-9]{1,6})?$/;

export function normKey(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[_/]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function columnLetter(index: number): string {
  let n = index + 1;
  let out = "";
  while (n > 0) {
    const rem = (n - 1) % 26;
    out = String.fromCharCode(65 + rem) + out;
    n = Math.floor((n - 1) / 26);
  }
  return out;
}

export function columnIndexFromLetter(letter: string): number | null {
  if (!/^[A-Za-z]{1,3}$/.test(letter.trim())) return null;
  let n = 0;
  for (const ch of letter.trim().toUpperCase()) {
    n = n * 26 + (ch.charCodeAt(0) - 64);
  }
  return n - 1;
}

export function stripKnownExtension(fileName: string): string {
  const match = fileName.match(/\.([A-Za-z0-9]{1,5})$/);
  if (!match) return fileName;
  if (!EXTENSIONS.has(match[1].toLowerCase())) return fileName;
  return fileName.slice(0, -match[0].length);
}

export function basename(path: string): string {
  const parts = path.split(/[/\\]/);
  return (parts[parts.length - 1] || path).trim();
}

/**
 * Split a document number or filename stem into identity + revision.
 * Revision is the short token after the last underscore (`_E`, `_A1`, `_01`).
 * Longer tails such as `_000001` stay inside the identity.
 */
export function splitDocumentId(raw: string): {
  base: string;
  baseKey: string;
  revision: string | null;
} {
  const trimmed = stripKnownExtension(basename(raw)).trim();
  const match = trimmed.match(/^(.*)_([A-Za-z][A-Za-z0-9]{0,3}|\d{1,2})$/);
  if (!match || !match[1]) {
    return { base: trimmed, baseKey: trimmed.toUpperCase(), revision: null };
  }
  return {
    base: match[1],
    baseKey: match[1].toUpperCase(),
    revision: match[2].toUpperCase(),
  };
}

export function isDocumentNumber(value: string): boolean {
  const cleaned = stripKnownExtension(value.trim());
  return DOC_NUMBER_RE.test(cleaned);
}

export function extractDocumentNumbers(text: string): string[] {
  const re =
    /[A-Za-z0-9]{1,12}(?:-[A-Za-z0-9]{1,24}){5,10}(?:_[A-Za-z0-9]{1,6})?/g;
  const found = text.match(re) ?? [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const token of found) {
    const key = token.toUpperCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(token);
  }
  return out;
}
