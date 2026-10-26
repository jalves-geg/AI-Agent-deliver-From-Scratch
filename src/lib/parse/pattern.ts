import { splitDocumentId } from "../documentNumber";
import type { PatternInfo } from "../types";

const ROLES = [
  "Region",
  "Asset",
  "Contract",
  "Org",
  "Discipline",
  "DocType",
  "SheetType+Chapter+Serial",
];

export const CANONICAL_PATTERN =
  "Region-Asset-Contract-Org-Discipline-DocType-{SheetType}{Chapter}{Serial}_{Rev}";

export function inferPattern(
  numbers: string[],
  widths: { sheet?: number; chapter?: number },
): PatternInfo | null {
  if (numbers.length === 0) return null;
  const parsed = numbers.map((number) => {
    const id = splitDocumentId(number);
    return { id, parts: id.base.split("-").filter(Boolean) };
  });
  const counts = new Map<number, number>();
  for (const item of parsed) {
    counts.set(item.parts.length, (counts.get(item.parts.length) ?? 0) + 1);
  }
  let mode = 0;
  let modeCount = 0;
  for (const [length, count] of counts) {
    if (count > modeCount) {
      mode = length;
      modeCount = count;
    }
  }
  const sample = parsed.find((item) => item.parts.length === mode) ?? parsed[0];
  const canonical = mode === 7;
  const segments = sample.parts.map((part, index) => ({
    role: canonical ? ROLES[index] : `Segment ${index + 1}`,
    sample: part,
  }));
  const tailRaw = sample.parts[sample.parts.length - 1] ?? "";
  let tail: PatternInfo["tail"] = tailRaw ? { raw: tailRaw } : null;
  if (
    tail &&
    canonical &&
    widths.sheet &&
    widths.chapter &&
    tailRaw.length > widths.sheet + widths.chapter
  ) {
    tail = {
      raw: tailRaw,
      sheetType: tailRaw.slice(0, widths.sheet),
      chapter: tailRaw.slice(widths.sheet, widths.sheet + widths.chapter),
      serial: tailRaw.slice(widths.sheet + widths.chapter),
    };
  }
  const withRevision = parsed.filter((item) => item.id.revision).length;
  return {
    expression: canonical ? CANONICAL_PATTERN : `${segments.map((segment) => segment.role).join("-")}_{Rev}`,
    segments,
    tail,
    revisionSample: sample.id.revision,
    consistent: modeCount,
    sampled: parsed.length,
  };
}
