import { loadConfig, type AppConfig } from "../config";
import type { Session } from "../session/store";
import { createAnthropicProvider } from "./anthropic";
import { createOpenAICompatibleProvider } from "./openaiCompatible";
import { createScriptedProvider } from "./scripted";
import type { LLMProvider } from "./types";

export function createLiveProvider(config: AppConfig = loadConfig()): LLMProvider {
  if (config.provider === "anthropic") return createAnthropicProvider(config);
  return createOpenAICompatibleProvider(config);
}

export function createProvider(session: Session, forceDemo = false): LLMProvider {
  const config = loadConfig();
  if (forceDemo || config.demoMode) return createScriptedProvider(session);
  return createLiveProvider(config);
}

export type { LLMProvider } from "./types";
