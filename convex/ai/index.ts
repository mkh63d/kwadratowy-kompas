import type { AIConfig } from "./config";
import { createMockProvider } from "./mock";
import {
  createOpenAICompatibleProvider,
  type OpenAICompatibleDeps,
} from "./openaiCompatible";
import type { AIProvider } from "./types";

// No fallback between real providers: a failing real provider surfaces its own error.
export function getProvider(
  config: AIConfig,
  deps?: OpenAICompatibleDeps,
): AIProvider {
  if (config.provider === "mock") return createMockProvider();
  return createOpenAICompatibleProvider(config, deps);
}
