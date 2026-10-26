import { buildSyntheticBundle } from "@/lib/demo/synthetic";
import { json } from "@/lib/http";
import { ensureSession, putFile } from "@/lib/session/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const body = (await request.json().catch(() => ({}))) as { sessionId?: string };
  const session = ensureSession(body.sessionId);
  const bundle = buildSyntheticBundle();
  const file = putFile(session, {
    name: bundle.fileName,
    mime: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    kind: "spreadsheet",
    buffer: bundle.registerXlsx,
  });
  return json({
    sessionId: session.id,
    fileId: file.id,
    fileName: file.name,
    folderNames: bundle.folderNames,
    deliverableCount: bundle.expected.deliverableCount,
  });
}
