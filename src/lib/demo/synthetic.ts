import * as XLSX from "xlsx";
import { CANONICAL_PATTERN } from "../parse/pattern";
import { buildSimplePdf } from "../parse/pdf";

export type SyntheticDoc = {
  number: string;
  title: string;
  discipline: string;
  docType: string;
  rev: string;
  book: string;
};

export type SyntheticBundle = {
  fileName: string;
  registerXlsx: Buffer;
  registerCsv: Buffer;
  registerPdf: Buffer;
  pdfText: string;
  folderNames: string[];
  deliverables: SyntheticDoc[];
  registerRows: string[][];
  expected: {
    deliverableCount: number;
    headerRow: number;
    column: string;
    sheet: string;
    codesSheet: string;
    ok: number;
    wrongRevision: number;
    missing: number;
    extra: number;
    skippedHeadings: number;
    wrong: { expected: string; foundPath: string; expectedRev: string; foundRev: string }[];
    missingNumbers: string[];
    extraNames: string[];
  };
};

const DISCIPLINES = [
  { code: "SUS", name: "Subsea" },
  { code: "PIP", name: "Piping" },
  { code: "ELE", name: "Electrical" },
];

function makeDoc(index: number): SyntheticDoc {
  const discipline = DISCIPLINES[index % DISCIPLINES.length];
  const docType = index % 4 === 0 ? "DWG" : "RPT";
  const sheet = docType === "DWG" ? "1" : "0";
  const chapter = "00";
  const serial = String(index + 1).padStart(3, "0");
  const rev = docType === "DWG" ? "A" : "E";
  const number = `05-732800-4200000103-BOF-${discipline.code}-${docType}-${sheet}${chapter}${serial}_${rev}`;
  return {
    number,
    title: docType === "DWG" ? `General arrangement ${serial}` : `Technical report ${serial}`,
    discipline: discipline.code,
    docType,
    rev,
    book: index < 18 ? "01" : "02",
  };
}

function bumpRev(rev: string): string {
  if (rev === "E") return "F";
  if (rev === "A") return "B";
  return "Z";
}

function csvEscape(value: string): string {
  if (/[",\n\r]/.test(value)) return `"${value.replace(/"/g, '""')}"`;
  return value;
}

function rowsToCsv(rows: string[][]): string {
  return rows.map((row) => row.map(csvEscape).join(",")).join("\r\n");
}

function stringSheet(rows: string[][]): XLSX.WorkSheet {
  const sheet = XLSX.utils.aoa_to_sheet(rows);
  for (const key of Object.keys(sheet)) {
    if (key.startsWith("!")) continue;
    const cell = sheet[key];
    const value = cell.v == null ? "" : String(cell.v);
    cell.t = "s";
    cell.v = value;
    cell.w = value;
  }
  return sheet;
}

function codesRows(): string[][] {
  const sections: [string, [string, string][]][] = [
    ["Region", [["Campos Basin", "05"], ["Santos Basin", "06"]]],
    ["Asset", [["FPSO Alpha", "732800"], ["WHP Beta", "741200"]]],
    ["Contract", [["EPC Alpha", "4200000103"], ["EPC Beta", "4200000208"]]],
    ["Organization", [["BOF Engineering", "BOF"], ["GEG Demo Office", "GEG"]]],
    ["Discipline", DISCIPLINES.map((item) => [item.name, item.code])],
    ["Document type", [["Report", "RPT"], ["Drawing", "DWG"], ["Specification", "SPE"]]],
    ["Sheet type", [["General", "0"], ["Detail", "1"]]],
    ["Chapter", [["General", "00"], ["Introduction", "01"]]],
  ];
  const rows: string[][] = [["CODE LISTS — SYNTHETIC"], []];
  for (const [title, pairs] of sections) {
    rows.push([title]);
    rows.push(["Name", "Code"]);
    for (const [name, code] of pairs) rows.push([name, code]);
    rows.push([]);
  }
  rows.push(["Numbering"]);
  rows.push(["Name", "Code"]);
  rows.push(["Pattern", CANONICAL_PATTERN]);
  rows.push(["Sheet type width", "1"]);
  rows.push(["Chapter width", "2"]);
  return rows;
}

function registerRows(docs: SyntheticDoc[]): string[][] {
  const rows: string[][] = [
    ["Project", "GEG Synthetic FPSO Alpha"],
    ["Client", "Demo Offshore"],
    ["Document", "Master Document Register"],
    ["Status", "SYNTHETIC — not client data"],
    ["Prepared for", "GEG deliverables demo"],
    ["", ""],
    ["Note", "Header is row 11. FOLDER rows are not deliverables."],
    ["", ""],
    ["", ""],
    ["", ""],
    ["Item", "Drawing Numbering", "Title", "Discipline", "Document type", "Revision", "Book"],
  ];
  docs.forEach((doc, index) => {
    if (index === 0) rows.push(["FOLDER 01 - BOOK 01"]);
    if (index === 9) rows.push(["FOLDER 01 - BOOK 02"]);
    if (index === 18) rows.push(["FOLDER 02 - BOOK 01"]);
    rows.push([String(index + 1), doc.number, doc.title, doc.discipline, doc.docType, doc.rev, doc.book]);
  });
  return rows;
}

function folderFor(index: number, fileName: string): string {
  if (index < 9) return `FOLDER 01 - BOOK 01/${fileName}`;
  if (index < 18) return `FOLDER 01 - BOOK 02/${fileName}`;
  return `FOLDER 02 - BOOK 01/${fileName}`;
}

export function buildSyntheticBundle(): SyntheticBundle {
  const deliverables = Array.from({ length: 36 }, (_, index) => makeDoc(index));
  const missingIndexes = new Set([3, 20]);
  const wrongIndexes = new Set([7, 15]);
  const folderNames: string[] = [];
  const wrong: SyntheticBundle["expected"]["wrong"] = [];
  const missingNumbers = [...missingIndexes].map((index) => deliverables[index].number);

  deliverables.forEach((doc, index) => {
    if (missingIndexes.has(index)) return;
    if (wrongIndexes.has(index)) {
      const foundRev = bumpRev(doc.rev);
      const foundName = doc.number.replace(/_[A-Za-z0-9]+$/, `_${foundRev}`) + ".pdf";
      const foundPath = folderFor(index, foundName);
      folderNames.push(foundPath);
      wrong.push({
        expected: doc.number,
        foundPath,
        expectedRev: doc.rev,
        foundRev,
      });
      return;
    }
    const extension = doc.docType === "DWG" ? "dwg" : index === 1 ? "PDF" : "pdf";
    folderNames.push(folderFor(index, `${doc.number}.${extension}`));
  });

  const extraNames = [
    "transmittals/cover-letter.pdf",
    "05-732800-4200000103-BOF-SUS-RPT-009999_A.pdf",
    "misc/notes.txt",
  ];
  folderNames.push(...extraNames);

  const codes = codesRows();
  const register = registerRows(deliverables);
  const book = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(book, stringSheet(codes), "Codes");
  XLSX.utils.book_append_sheet(book, stringSheet(register), "Register");
  const registerXlsx = XLSX.write(book, { type: "buffer", bookType: "xlsx" }) as Buffer;

  const pdfLines = [
    "SYNTHETIC GEG REGISTER",
    "Drawing Numbering",
    "FOLDER 01 - BOOK 01",
    ...deliverables.slice(0, 4).map((doc) => doc.number),
  ];

  return {
    fileName: "synthetic-register.xlsx",
    registerXlsx,
    registerCsv: Buffer.from(`\uFEFF${rowsToCsv(register)}`, "utf8"),
    registerPdf: buildSimplePdf(pdfLines),
    pdfText: pdfLines.join("\n"),
    folderNames,
    deliverables,
    registerRows: register,
    expected: {
      deliverableCount: deliverables.length,
      headerRow: 11,
      column: "Drawing Numbering",
      sheet: "Register",
      codesSheet: "Codes",
      ok: deliverables.length - missingIndexes.size - wrongIndexes.size,
      wrongRevision: wrongIndexes.size,
      missing: missingIndexes.size,
      extra: extraNames.length,
      skippedHeadings: 3,
      wrong,
      missingNumbers,
      extraNames,
    },
  };
}
