export type ProviderId = "xai" | "openai" | "anthropic" | "azure" | "openai-compatible";

export type AppConfig = {
  provider: ProviderId;
  model: string;
  apiKey: string;
  baseUrl: string;
  azureApiVersion: string;
  azureDeployment: string;
  demoMode: boolean;
};

const PROVIDERS: Record<string, ProviderId> = {
  xai: "xai",
  grok: "xai",
  openai: "openai",
  anthropic: "anthropic",
  claude: "anthropic",
  azure: "azure",
  "azure-openai": "azure",
  "openai-compatible": "openai-compatible",
  compatible: "openai-compatible",
  ollama: "openai-compatible",
  local: "openai-compatible",
};

function defaultBaseUrl(provider: ProviderId): string {
  if (provider === "xai") return "https://api.x.ai/v1";
  if (provider === "openai") return "https://api.openai.com/v1";
  if (provider === "anthropic") return "https://api.anthropic.com";
  return "";
}

function defaultModel(provider: ProviderId): string {
  if (provider === "xai") return "grok-4.7";
  if (provider === "openai") return "gpt-4o";
  if (provider === "anthropic") return "claude-sonnet-4-5";
  return "";
}

function apiKeyFor(env: NodeJS.ProcessEnv, provider: ProviderId): string {
  if (env.LLM_API_KEY) return env.LLM_API_KEY;
  if (provider === "xai") return env.XAI_API_KEY || "";
  if (provider === "openai" || provider === "openai-compatible") return env.OPENAI_API_KEY || "";
  if (provider === "anthropic") return env.ANTHROPIC_API_KEY || "";
  return env.AZURE_OPENAI_API_KEY || "";
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const provider = PROVIDERS[(env.LLM_PROVIDER || "xai").trim().toLowerCase()] ?? "xai";
  const apiKey = apiKeyFor(env, provider);
  const azureDeployment = env.AZURE_OPENAI_DEPLOYMENT || env.LLM_MODEL || "";
  const model = provider === "azure" ? azureDeployment : env.LLM_MODEL || defaultModel(provider);
  const baseUrl = (
    env.LLM_BASE_URL || (provider === "azure" ? env.AZURE_OPENAI_ENDPOINT || "" : defaultBaseUrl(provider))
  ).replace(/\/$/, "");
  const forced = ["1", "true", "yes"].includes((env.GEG_DEMO_MODE || "").trim().toLowerCase());
  return {
    provider,
    model,
    apiKey,
    baseUrl,
    azureApiVersion: env.AZURE_OPENAI_API_VERSION || "2024-10-21",
    azureDeployment,
    demoMode: forced || !apiKey,
  };
}

export function chatCompletionsUrl(config: AppConfig): string {
  if (config.provider === "azure") {
    const root = config.baseUrl.replace(/\/openai\/deployments\/.*$/i, "").replace(/\/$/, "");
    const deployment = encodeURIComponent(config.azureDeployment || config.model);
    return `${root}/openai/deployments/${deployment}/chat/completions?api-version=${encodeURIComponent(config.azureApiVersion)}`;
  }
  return `${config.baseUrl}/chat/completions`;
}
