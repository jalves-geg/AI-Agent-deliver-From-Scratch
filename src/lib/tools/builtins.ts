import { parsePdfBuffer } from "../parse/pdf";
import { parseRegisterBuffer } from "../parse/register";
import { compareDeliverables } from "../match/compare";
import type { ParseOverrides, PublicUnderstanding, RegisterUnderstanding } from "../types";
import { registerTool } from "./registry";
import type { ToolResult } from "./types";

function asString(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed || undefined;
}

function asNumber(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && /^\d+$/.test(value.trim())) return Number(value.trim());
  return undefined;
}

function overridesFrom(args: Record<string, unknown>): ParseOverrides {
  return {
    sheetName: asString(args.sheetName),
    headerRow: asNumber(args.headerRow),
    numberColumn: asString(args.numberColumn),
  };
}

export function toPublicUnderstanding(understanding: RegisterUnderstanding): PublicUnderstanding {
  const { deliverables: _omit, codes, ...rest } = understanding;
  return {
    ...rest,
    codes: codes.map((section) => ({
      ...section,
      entries: section.entries.slice(0, 12),
      entryCount: section.entries.length,
    })),
  };
}

function splitNames(value: string): string[] {
  return value
    .split(/\r?\n|[;]/)
    .map((part) => part.trim())
    .filter(Boolean);
}

registerTool({
  name: "parse_deliverables",
  description:
    "Read an uploaded deliverables register (.xlsx, .xls, .csv, or .pdf). Detect sheets, the header row, the document-number column, the naming pattern, and the deliverable count. Use overrides when the user corrects the sheet, header row, or column. Stores the result as unconfirmed session context.",
  parameters: {
    type: "object",
    properties: {
      fileId: {
        type: "string",
        description: "Id of an uploaded register file. Omit to re-read the register already in the session.",
      },
      sheetName: { type: "string", description: "Register sheet name, if the user named one." },
      headerRow: { type: "integer", description: "1-based spreadsheet row that holds the column titles." },
      numberColumn: {
        type: "string",
        description: "Header text of the document-number column, or a column letter such as C.",
      },
    },
    additionalProperties: false,
  },
  async execute(args, session): Promise<ToolResult> {
    const fileId = asString(args.fileId) || session.registerFileId || undefined;
    const file = fileId ? session.files.get(fileId) : undefined;
    if (!file) {
      return { ok: false, summary: "No register file is available to parse.", data: { reason: "missing_file" } };
    }
    if (file.kind === "other") {
      return {
        ok: false,
        summary: `${file.name} is not an Excel, CSV, or PDF register.`,
        data: { reason: "unsupported_type" },
      };
    }
    try {
      const overrides = overridesFrom(args);
      const understanding =
        file.kind === "pdf"
          ? await parsePdfBuffer(file.buffer, file.name, overrides)
          : parseRegisterBuffer(file.buffer, file.name, overrides);
      session.register = understanding;
      session.registerFileId = file.id;
      session.confirmed = false;
      session.comparison = null;
      const summary = `${understanding.registerSheet ?? "no sheet"} · row ${understanding.headerRow ?? "—"} · ${understanding.numberColumn ?? "no column"} · ${understanding.deliverableCount} deliverables`;
      return {
        ok: understanding.deliverableCount > 0,
        summary,
        data: toPublicUnderstanding(understanding),
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : "Could not read the register.";
      return { ok: false, summary: message, data: { reason: "parse_error" } };
    }
  },
});

registerTool({
  name: "confirm_register",
  description:
    "Mark the current register understanding as confirmed or rejected. Call this only after the user agrees, or with confirmed=false if they reject it.",
  parameters: {
    type: "object",
    properties: {
      confirmed: { type: "boolean" },
    },
    required: ["confirmed"],
    additionalProperties: false,
  },
  execute(args, session): ToolResult {
    if (!session.register) {
      return { ok: false, summary: "There is no register understanding to confirm.", data: { confirmed: false } };
    }
    session.confirmed = args.confirmed !== false;
    return {
      ok: true,
      summary: session.confirmed ? "Understanding confirmed" : "Understanding cleared",
      data: {
        confirmed: session.confirmed,
        deliverableCount: session.register.deliverableCount,
        folderReady: Boolean(session.folderNames?.length),
      },
    };
  },
});

registerTool({
  name: "list_folder",
  description:
    "Store the filenames to check against the register. Pass usePending when a folder upload was staged, names for an explicit list, or pastedText for a pasted block. Only filenames are stored.",
  parameters: {
    type: "object",
    properties: {
      usePending: { type: "boolean", description: "Use the folder the user just attached." },
      names: { type: "array", items: { type: "string" }, description: "Filenames or relative paths." },
      pastedText: { type: "string", description: "Raw pasted filename list." },
      fileIds: {
        type: "array",
        items: { type: "string" },
        description: "Uploaded file ids whose names should be listed.",
      },
    },
    additionalProperties: false,
  },
  execute(args, session): ToolResult {
    const names: string[] = [];
    if (args.usePending === true && session.pendingFolderNames) names.push(...session.pendingFolderNames);
    if (Array.isArray(args.names)) {
      for (const name of args.names) if (typeof name === "string" && name.trim()) names.push(name.trim());
    }
    if (typeof args.pastedText === "string") names.push(...splitNames(args.pastedText));
    if (Array.isArray(args.fileIds)) {
      for (const id of args.fileIds) {
        if (typeof id !== "string") continue;
        const file = session.files.get(id);
        if (file) names.push(file.relativePath || file.name);
      }
    }
    if (names.length === 0 && session.pendingFolderNames?.length) names.push(...session.pendingFolderNames);
    if (names.length === 0) {
      return { ok: false, summary: "No filenames were provided.", data: { count: 0 } };
    }
    session.folderNames = names;
    session.pendingFolderNames = null;
    session.comparison = null;
    return {
      ok: true,
      summary: `${names.length} filenames stored`,
      data: { count: names.length, sample: names.slice(0, 8), confirmed: session.confirmed },
    };
  },
});

registerTool({
  name: "compare",
  description:
    "Deterministically compare the stored deliverables register to the stored folder filenames. Ignores extensions. Flags wrong revision (expected vs found), missing deliverables, and extra files. Does not guess.",
  parameters: {
    type: "object",
    properties: {},
    additionalProperties: false,
  },
  execute(_args, session): ToolResult {
    if (!session.register) {
      return { ok: false, summary: "Parse a deliverables register before comparing.", data: { reason: "no_register" } };
    }
    if (!session.folderNames?.length) {
      return { ok: false, summary: "List a folder before comparing.", data: { reason: "no_folder" } };
    }
    const result = compareDeliverables(session.register.deliverables, session.folderNames);
    session.comparison = { ...result, confirmed: session.confirmed };
    const summary = `${result.ok} ok · ${result.wrongRevision} wrong rev · ${result.missing} missing · ${result.extra} extra`;
    const issues = result.rows.filter((row) => row.status !== "ok").slice(0, 20);
    return {
      ok: true,
      summary,
      data: {
        confirmed: session.confirmed,
        expected: result.expected,
        folderFiles: result.folderFiles,
        ok: result.ok,
        wrongRevision: result.wrongRevision,
        missing: result.missing,
        extra: result.extra,
        issues,
      },
    };
  },
});
