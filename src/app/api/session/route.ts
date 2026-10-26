import { deleteSession, ensureSession, getSession } from "@/lib/session/store";
import { isLang, json, sessionView } from "@/lib/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export function GET(request: Request) {
  const id = new URL(request.url).searchParams.get("id") ?? "";
  const session = getSession(id);
  if (!session) return json({ messages: [], understanding: null, confirmed: false, comparison: null });
  return json(sessionView(session));
}

export function DELETE(request: Request) {
  const id = new URL(request.url).searchParams.get("id") ?? "";
  if (id) deleteSession(id);
  return json({ ok: true });
}

export async function POST(request: Request) {
  const body = (await request.json().catch(() => ({}))) as { sessionId?: string; lang?: string };
  const session = ensureSession(body.sessionId);
  if (isLang(body.lang)) session.uiLanguage = body.lang;
  return json(sessionView(session));
}
