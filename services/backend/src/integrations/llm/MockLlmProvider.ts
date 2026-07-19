import type { LlmMessage, LlmProvider } from "./LlmProvider.js";

/**
 * Deterministic stand-in used until a real LLM key is configured. Echoes intent
 * rather than fabricating sales content, so nothing it returns is mistaken for
 * a real recommendation, price, or specification.
 */
export class MockLlmProvider implements LlmProvider {
  async complete(messages: LlmMessage[]): Promise<string> {
    const lastUser = [...messages].reverse().find((m) => m.role === "user");
    return `[mock-llm] Получено сообщение: "${lastUser?.content ?? ""}". ` +
      "LLM_PROVIDER не настроен — задайте ANTHROPIC_API_KEY для реальных ответов.";
  }

  async describeImage(imageUrl: string): Promise<string> {
    return `[mock-llm] Изображение не проанализировано (LLM_PROVIDER не настроен): ${imageUrl}`;
  }
}
