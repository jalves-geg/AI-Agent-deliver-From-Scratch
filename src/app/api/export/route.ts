import { comparisonToCsv, comparisonToXlsx } from "@/lib/exportSheet";
import { isLang, json } from "@/lib/http";
import { getSession } from "@/lib/session/store";
import type { Lang } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export function GET(request: Request) {
  const url = new URL(request.url);
  const session = getSession(url.searchParams.get("sessionId") ?? "");
  if (!session?.comparison) return json({ error: "There is no check to export yet." }, 404);
  const lang: Lang = isLang(url.searchParams.get("lang")) ? (url.searchParams.get("lang") as Lang) : session.replyLang;
  const format = url.searchParams.get("format") === "xlsx" ? "xlsx" : "csv";
  if (format === "csv") {
    const body = comparisonToCsv(session.comparison, lang);
    return new Response(body, {
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": "attachment; filename=\"geg-deliverables-check.csv\"",
      },
    });
  }
  const body = comparisonToXlsx(session.comparison, lang);
  return new Response(new Uint8Array(body), {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": "attachment; filename=\"geg-deliverables-check.xlsx\"",
    },
  });
}
