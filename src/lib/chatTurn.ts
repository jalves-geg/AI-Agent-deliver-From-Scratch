import type { FileKind } from "./types";

export function fileKind(name: string): FileKind {
  const ext = name.toLowerCase().split(".").pop() ?? "";
  if (ext === "xlsx" || ext === "xlsm" || ext === "xls" || ext === "csv") return "spreadsheet";
  if (ext === "pdf") return "pdf";
  return "other";
}

export function composeUserContent(options: {
  text: string;
  files: { id: string; name: string; kind: FileKind }[];
  folderCount: number;
}): string {
  const parts: string[] = [];
  if (options.files.length > 0) {
    const lines = options.files.map((file) => `- id: ${file.id} | name: ${file.name} | kind: ${file.kind}`);
    parts.push(`[attached-files]\n${lines.join("\n")}\n[/attached-files]`);
  }
  if (options.folderCount > 0) {
    parts.push(
      `[folder]\n${options.folderCount} filenames are staged in the session. Call list_folder with {"usePending": true}. Do not invent names.\n[/folder]`,
    );
  }
  parts.push(options.text.trim() || "(no text)");
  return parts.join("\n\n");
}
