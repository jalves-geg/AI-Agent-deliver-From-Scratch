import { extractDocumentNumbers, splitDocumentId } from "../documentNumber";
import type { ParseOverrides, RegisterUnderstanding } from "../types";
import { inferPattern } from "./pattern";

export function buildSimplePdf(lines: string[]): Buffer {
  const commands = lines.map((line, index) => {
    const y = 780 - index * 16;
    const escaped = line.replace(/\\/g, "\\\\").replace(/\(/g, "\\(").replace(/\)/g, "\\)");
    return `BT /F1 11 Tf 48 ${y} Td (${escaped}) Tj ET`;
  });
  const stream = commands.join("\n");
  const objects = [
    "1 0 obj << /Type /Catalog /Pages 2 0 R >> endobj\n",
    "2 0 obj << /Type /Pages /Kids [3 0 R] /Count 1 >> endobj\n",
    "3 0 obj << /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >> endobj\n",
    `4 0 obj << /Length ${Buffer.byteLength(stream)} >>\nstream\n${stream}\nendstream\nendobj\n`,
    "5 0 obj << /Type /Font /Subtype /Type1 /BaseFont /Helvetica >> endobj\n",
  ];
  let body = "%PDF-1.4\n";
  const offsets: number[] = [];
  for (const object of objects) {
    offsets.push(Buffer.byteLength(body));
    body += object;
  }
  const xrefAt = Buffer.byteLength(body);
  let xref = "xref\n0 6\n0000000000 65535 f \n";
  for (const offset of offsets) {
    xref += `${String(offset).padStart(10, "0")} 00000 n \n`;
  }
  body += xref;
  body += `trailer << /Size 6 /Root 1 0 R >>\nstartxref\n${xrefAt}\n%%EOF`;
  return Buffer.from(body, "latin1");
}

export async function extractPdfText(buffer: Buffer): Promise<string> {
  const { extractText } = await import("unpdf");
  const result = await extractText(new Uint8Array(buffer), { mergePages: true });
  return result.text;
}

export function understandingFromPdfText(
  filename: string,
  text: string,
  overrides: ParseOverrides = {},
): RegisterUnderstanding {
  const numbers = extractDocumentNumbers(text);
  const deliverables = numbers.map((number, index) => {
    const id = splitDocumentId(number);
    return {
      number,
      base: id.base,
      baseKey: id.baseKey,
      revision: id.revision,
      row: index + 1,
      sheet: "PDF",
    };
  });
  const pattern = inferPattern(numbers, {});
  return {
    fileName: filename,
    kind: "pdf",
    sheets: [{ name: "PDF", role: deliverables.length ? "register" : "other", rows: deliverables.length }],
    codes: [],
    registerSheet: deliverables.length ? "PDF" : null,
    headerRow: null,
    numberColumn: deliverables.length ? "text" : null,
    numberColumnIndex: null,
    pattern,
    deliverableCount: deliverables.length,
    deliverables,
    samples: deliverables.slice(0, 5).map((item) => item.number),
    skippedHeadings: [],
    skippedHeadingCount: 0,
    warnings: [
      "PDF text does not keep spreadsheet rows. Numbers were read from the text. Confirm them, or send the Excel register if you have it.",
    ],
    overrides,
  };
}

export async function parsePdfBuffer(
  buffer: Buffer,
  filename: string,
  overrides: ParseOverrides = {},
): Promise<RegisterUnderstanding> {
  const text = await extractPdfText(buffer);
  return understandingFromPdfText(filename, text, overrides);
}
