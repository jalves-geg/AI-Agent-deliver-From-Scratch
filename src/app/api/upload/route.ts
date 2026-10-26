import { fileKind } from "@/lib/chatTurn";
import { json } from "@/lib/http";
import { ensureSession, putFile } from "@/lib/session/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_BYTES = 20 * 1024 * 1024;

export async function POST(request: Request) {
  const form = await request.formData();
  const sessionId = String(form.get("sessionId") ?? "");
  const value = form.get("file");
  if (!(value instanceof File)) return json({ error: "Choose a file to upload." }, 400);
  if (value.size > MAX_BYTES) return json({ error: "That file is larger than 20 MB." }, 400);
  const session = ensureSession(sessionId);
  const buffer = Buffer.from(await value.arrayBuffer());
  const stored = putFile(session, {
    name: value.name,
    mime: value.type || "application/octet-stream",
    kind: fileKind(value.name),
    buffer,
  });
  return json({ id: stored.id, name: stored.name, kind: stored.kind, sessionId: session.id });
}
