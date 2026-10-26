export type Lang = "pt" | "en";

export type FileKind = "spreadsheet" | "pdf" | "other";

export type ParseOverrides = {
  sheetName?: string;
  headerRow?: number;
  numberColumn?: string;
};

export type CodeEntry = {
  name: string;
  code: string;
};

export type CodeSection = {
  category: string;
  entries: CodeEntry[];
};

export type Deliverable = {
  number: string;
  base: string;
  baseKey: string;
  revision: string | null;
  row: number;
  sheet: string;
};

export type PatternSegment = {
  role: string;
  sample: string;
};

export type PatternInfo = {
  expression: string;
  segments: PatternSegment[];
  tail: {
    raw: string;
    sheetType?: string;
    chapter?: string;
    serial?: string;
  } | null;
  revisionSample: string | null;
  consistent: number;
  sampled: number;
};

export type SheetSummary = {
  name: string;
  role: "codes" | "register" | "other";
  rows: number;
};

export type RegisterUnderstanding = {
  fileName: string;
  kind: "xlsx" | "csv" | "pdf";
  sheets: SheetSummary[];
  codes: CodeSection[];
  registerSheet: string | null;
  headerRow: number | null;
  numberColumn: string | null;
  numberColumnIndex: number | null;
  pattern: PatternInfo | null;
  deliverableCount: number;
  deliverables: Deliverable[];
  samples: string[];
  skippedHeadings: string[];
  skippedHeadingCount: number;
  warnings: string[];
  overrides: ParseOverrides;
};

export type PublicUnderstanding = Omit<RegisterUnderstanding, "deliverables" | "codes"> & {
  codes: Array<CodeSection & { entryCount: number }>;
};

export type ComparisonStatus = "ok" | "wrong_revision" | "missing" | "extra";

export type ComparisonRow = {
  status: ComparisonStatus;
  deliverable: string | null;
  expectedRevision: string | null;
  foundRevision: string | null;
  foundFiles: string[];
  alsoFoundRevisions: string[];
};

export type Comparison = {
  expected: number;
  folderFiles: number;
  ok: number;
  wrongRevision: number;
  missing: number;
  extra: number;
  confirmed: boolean;
  rows: ComparisonRow[];
};

export type ToolTrace = {
  name: string;
  ok: boolean;
  summary: string;
};

export type UiMessage = {
  id: string;
  role: "user" | "assistant";
  text: string;
  attachments?: string[];
  folderCount?: number;
  tools?: ToolTrace[];
  showComparison?: boolean;
};

export type StoredFile = {
  id: string;
  name: string;
  mime: string;
  kind: FileKind;
  buffer: Buffer;
  relativePath?: string;
};

export type ModelToolCall = {
  id: string;
  name: string;
  arguments: Record<string, unknown>;
};

export type ModelMessage = {
  role: "system" | "user" | "assistant" | "tool";
  content: string;
  toolCalls?: ModelToolCall[];
  toolCallId?: string;
  name?: string;
};
