import { loadConfig } from "./config";
import type { Session } from "./session/store";
import { toPublicUnderstanding } from "./tools/builtins";
import type { Lang } from "./types";

export function json(data: unknown, status = 200): Response {
  return Response.json(data, { status });
}

export function isLang(value: unknown): value is Lang {
  return value === "pt" || value === "en";
}

export function sessionView(session: Session) {
  const config = loadConfig();
  return {
    sessionId: session.id,
    lang: session.uiLanguage,
    messages: session.uiMessages,
    understanding: session.register ? toPublicUnderstanding(session.register) : null,
    confirmed: session.confirmed,
    folderCount: session.folderNames?.length ?? 0,
    comparison: session.comparison,
    demoMode: config.demoMode,
    provider: config.provider,
    model: config.model,
  };
}
