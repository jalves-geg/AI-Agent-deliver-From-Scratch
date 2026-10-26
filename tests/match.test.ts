import { describe, expect, it } from "vitest";
import { buildSyntheticBundle } from "@/lib/demo/synthetic";
import { compareDeliverables } from "@/lib/match/compare";
import { parseRegisterBuffer } from "@/lib/parse/register";
import { comparisonToCsv } from "@/lib/exportSheet";

const bundle = buildSyntheticBundle();

describe("compare deliverables to filenames", () => {
  it("ignores extensions and paths, and flags wrong revision, missing, and extra", () => {
    const register = parseRegisterBuffer(bundle.registerXlsx, bundle.fileName);
    const comparison = compareDeliverables(register.deliverables, bundle.folderNames);
    expect(comparison.expected).toBe(36);
    expect(comparison.ok).toBe(bundle.expected.ok);
    expect(comparison.wrongRevision).toBe(2);
    expect(comparison.missing).toBe(2);
    expect(comparison.extra).toBe(3);

    for (const item of bundle.expected.wrong) {
      const row = comparison.rows.find((candidate) => candidate.deliverable === item.expected);
      expect(row?.status).toBe("wrong_revision");
      expect(row?.expectedRevision).toBe(item.expectedRev);
      expect(row?.foundRevision).toBe(item.foundRev);
      expect(row?.foundFiles).toContain(item.foundPath);
    }
    for (const number of bundle.expected.missingNumbers) {
      expect(comparison.rows.some((row) => row.status === "missing" && row.deliverable === number)).toBe(true);
    }
    for (const name of bundle.expected.extraNames) {
      expect(comparison.rows.some((row) => row.status === "extra" && row.foundFiles.includes(name))).toBe(true);
    }
  });

  it("matches case, backslashes, and a correct file beside another revision", () => {
    const expected = [
      {
        number: "05-732800-4200000103-BOF-SUS-RPT-000010_E",
        baseKey: "05-732800-4200000103-BOF-SUS-RPT-000010",
        revision: "E",
      },
      {
        number: "05-732800-4200000103-BOF-PIP-DWG-100011_A",
        baseKey: "05-732800-4200000103-BOF-PIP-DWG-100011",
        revision: "A",
      },
    ];
    const comparison = compareDeliverables(expected, [
      "Book 01\\05-732800-4200000103-bof-sus-rpt-000010_e.PDF",
      "Book 01/05-732800-4200000103-BOF-SUS-RPT-000010_F.pdf",
      "05-732800-4200000103-BOF-PIP-DWG-100011_B.dwg",
      "notes/readme.txt",
      "Book 01\\05-732800-4200000103-bof-sus-rpt-000010_e.PDF",
    ]);
    expect(comparison.folderFiles).toBe(4);
    const ok = comparison.rows.find((row) => row.deliverable?.endsWith("_E"));
    expect(ok?.status).toBe("ok");
    expect(ok?.foundRevision).toBe("E");
    expect(ok?.alsoFoundRevisions).toEqual(["F"]);
    const wrong = comparison.rows.find((row) => row.status === "wrong_revision");
    expect(wrong?.expectedRevision).toBe("A");
    expect(wrong?.foundRevision).toBe("B");
    expect(comparison.extra).toBe(1);
    expect(comparison.missing).toBe(0);
  });

  it("treats a file with no revision as the wrong revision when one was expected", () => {
    const comparison = compareDeliverables(
      [{ number: "05-732800-4200000103-BOF-SUS-RPT-000010_E", baseKey: "05-732800-4200000103-BOF-SUS-RPT-000010", revision: "E" }],
      ["05-732800-4200000103-BOF-SUS-RPT-000010.pdf"],
    );
    expect(comparison.wrongRevision).toBe(1);
    expect(comparison.rows[0].foundRevision).toBeNull();
    expect(comparison.rows[0].expectedRevision).toBe("E");
  });

  it("exports expected versus found for a spreadsheet", () => {
    const register = parseRegisterBuffer(bundle.registerXlsx, bundle.fileName);
    const comparison = { ...compareDeliverables(register.deliverables, bundle.folderNames), confirmed: true };
    const csv = comparisonToCsv(comparison, "en");
    expect(csv.charCodeAt(0)).toBe(0xfeff);
    expect(csv).toContain("Wrong revision");
    expect(csv).toContain("Expected revision");
    const wrong = bundle.expected.wrong[0];
    expect(csv).toContain(wrong.expected);
    expect(csv).toContain(wrong.foundRev);
  });
});
