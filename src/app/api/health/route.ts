import { loadConfig } from "@/lib/config";
import { getTools } from "@/lib/tools";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export function GET() {
  const config = loadConfig();
  return Response.json({
    ok: true,
    demoMode: config.demoMode,
    provider: config.provider,
    model: config.model,
    hasKey: Boolean(config.apiKey),
    tools: getTools().map((tool) => tool.name),
  });
}
