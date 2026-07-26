import { env } from "../../config/env.js";
import { AnthropicProvider } from "./AnthropicProvider.js";
import { MockLlmProvider } from "./MockLlmProvider.js";
import type { LlmProvider } from "./LlmProvider.js";

export type { LlmProvider, LlmMessage } from "./LlmProvider.js";

export function createLlmProvider(): LlmProvider {
  if (env.llm.provider === "anthropic" && env.llm.anthropicApiKey) {
    return new AnthropicProvider(env.llm.anthropicApiKey, env.llm.anthropicModel);
  }
  return new MockLlmProvider();
}
