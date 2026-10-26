import { describe, expect, it } from "vitest";
import { buildSyntheticBundle } from "@/lib/demo/synthetic";
import { parseCodeSheet } from "@/lib/parse/codes";
import { understandingFromPdfText, parsePdfBuffer } from "@/lib/parse/pdf";
import { parseRegisterBuffer, parseSheets } from "@/lib/parse/register";

const bundle = buildSyntheticBundle();

describe("parse deliverables register", () => {
  it("reads the synthetic workbook: codes, header row 11, drawing column, pattern, count", () => {
    const result = parseRegisterBuffer(bundle.registerXlsx, bundle.fileName);
    expect(result.sheets.map((sheet) => [sheet.name, sheet.role])).toEqual([
      ["Codes", "codes"],
      ["Register", "register"],
    ]);
    expect(result.codes.map((section) => section.category)).toEqual([
      "Region",
      "Asset",
      "Contract",
      "Organization",
      "Discipline",
      "Document type",
      "Sheet type",
      "Chapter",
    ]);
    expect(result.codes.find((section) => section.category === "Organization")?.entries).toContainEqual({
      name: "BOF Engineering",
      code: "BOF",
    });
    expect(result.registerSheet).toBe("Register");
    expect(result.headerRow).toBe(11);
    expect(result.numberColumn).toBe("Drawing Numbering");
    expect(result.deliverableCount).toBe(bundle.expected.deliverableCount);
    expect(result.skippedHeadingCount).toBe(3);
    expect(result.skippedHeadings).toContain("FOLDER 01 - BOOK 01");
    expect(result.pattern?.expression).toBe(
      "Region-Asset-Contract-Org-Discipline-DocType-{SheetType}{Chapter}{Serial}_{Rev}",
    );
    expect(result.pattern?.tail).toMatchObject({ sheetType: "1", chapter: "00", serial: "001" });
    expect(result.samples[0]).toBe(bundle.deliverables[0].number);
    expect(result.warnings.some((warning) => warning.includes("not split"))).toBe(false);
  });

  it("reads the same register from CSV, including the preamble and a BOM", () => {
    const result = parseRegisterBuffer(bundle.registerCsv, "synthetic-register.csv");
    expect(result.kind).toBe("csv");
    expect(result.headerRow).toBe(11);
    expect(result.numberColumn).toBe("Drawing Numbering");
    expect(result.deliverableCount).toBe(36);
  });

  it("applies sheet, header, and column corrections", () => {
    const corrected = parseRegisterBuffer(bundle.registerXlsx, bundle.fileName, {
      sheetName: "Register",
      headerRow: 11,
      numberColumn: "Drawing Numbering",
    });
    expect(corrected.deliverableCount).toBe(36);

    const title = parseRegisterBuffer(bundle.registerXlsx, bundle.fileName, { numberColumn: "Title" });
    expect(title.numberColumn).toBe("Title");
    expect(title.deliverableCount).toBe(0);

    const letter = parseRegisterBuffer(bundle.registerXlsx, bundle.fileName, { numberColumn: "B" });
    expect(letter.numberColumn).toBe("Drawing Numbering");
    expect(letter.deliverableCount).toBe(36);

    const missing = parseRegisterBuffer(bundle.registerXlsx, bundle.fileName, { numberColumn: "Not a column" });
    expect(missing.warnings.some((warning) => warning.includes("Not a column"))).toBe(true);
    expect(missing.deliverableCount).toBe(36);
  });

  it("warns when the revision column disagrees with the suffix", () => {
    const result = parseSheets(
      [
        {
          name: "Register",
          rows: [
            ["Drawing Numbering", "Revision"],
            ["05-732800-4200000103-BOF-SUS-RPT-000001_E", "F"],
          ],
        },
      ],
      "tiny.xlsx",
      "xlsx",
    );
    expect(result.deliverableCount).toBe(1);
    expect(result.deliverables[0].revision).toBe("E");
    expect(result.warnings.some((warning) => warning.includes("revision column"))).toBe(true);
  });

  it("keeps a 1700-row register with section headings", () => {
    const rows: string[][] = [
      ["Project", "Scale"],
      ["", ""],
      ["", ""],
      ["", ""],
      ["", ""],
      ["", ""],
      ["", ""],
      ["", ""],
      ["", ""],
      ["", ""],
      ["Item", "Drawing Numbering", "Title"],
    ];
    for (let index = 0; index < 1700; index += 1) {
      if (index % 100 === 0) rows.push([`FOLDER ${String(Math.floor(index / 100) + 1).padStart(2, "0")} - BOOK 01`]);
      const serial = String(index + 1).padStart(6, "0");
      rows.push([String(index + 1), `05-732800-4200000103-BOF-SUS-RPT-${serial}_E`, `Doc ${index + 1}`]);
    }
    const started = Date.now();
    const result = parseSheets([{ name: "Register", rows }], "large.xlsx", "xlsx");
    expect(Date.now() - started).toBeLessThan(2000);
    expect(result.headerRow).toBe(11);
    expect(result.deliverableCount).toBe(1700);
    expect(result.skippedHeadingCount).toBe(17);
  });

  it("reads stacked, side-by-side, and long code lists", () => {
    const side = parseCodeSheet([
      ["Region", "Code", "", "Asset", "Code"],
      ["Campos Basin", "05", "", "FPSO Alpha", "732800"],
    ]);
    expect(side.map((section) => section.category)).toEqual(["Region", "Asset"]);
    expect(side[1].entries[0]).toEqual({ name: "FPSO Alpha", code: "732800" });

    const long = parseCodeSheet([
      ["Category", "Name", "Code"],
      ["Discipline", "Subsea", "SUS"],
      ["Document type", "Report", "RPT"],
    ]);
    expect(long.find((section) => section.category === "Discipline")?.entries[0].code).toBe("SUS");
  });

  it("pulls document numbers out of PDF text", async () => {
    const fromText = understandingFromPdfText("register.pdf", bundle.pdfText);
    expect(fromText.kind).toBe("pdf");
    expect(fromText.deliverableCount).toBe(4);
    expect(fromText.headerRow).toBeNull();
    expect(fromText.samples[0]).toBe(bundle.deliverables[0].number);

    const fromFile = await parsePdfBuffer(bundle.registerPdf, "synthetic-register.pdf");
    expect(fromFile.deliverableCount).toBe(4);
    expect(fromFile.samples).toEqual(bundle.deliverables.slice(0, 4).map((doc) => doc.number));
  });
});
