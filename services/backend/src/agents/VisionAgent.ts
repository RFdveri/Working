import type { Agent, AgentContext, AgentResult } from "@ai-door-assistant/shared";
import type { LlmProvider } from "../integrations/llm/LlmProvider.js";
import { log } from "./support.js";

export interface VisionAgentInput {
  imageUrl: string;
  /** What to look for: door, room, interior, opening, color, etc. */
  focus?: string;
}

/** Analyzes photos of doors, rooms, interiors, or openings to ground the sales conversation. */
export class VisionAgent implements Agent<VisionAgentInput, string> {
  readonly name = "vision" as const;

  constructor(private readonly llm: LlmProvider) {}

  async handle(
    _context: AgentContext,
    input: VisionAgentInput
  ): Promise<AgentResult<string>> {
    if (!this.llm.describeImage) {
      return {
        agent: this.name,
        reply: undefined,
        logs: [log(this.name, "unsupported", "current LLM provider has no vision support")],
        clarifyingQuestions: [
          "Не могу проанализировать изображение — не настроен провайдер с поддержкой зрения.",
        ],
      };
    }

    const prompt =
      `Опиши, что на фото важно для подбора межкомнатной/входной двери` +
      (input.focus ? ` (обрати внимание на: ${input.focus})` : "") +
      ". Отметь только то, что реально видно: цвет, тип проёма, стиль интерьера, размеры на глаз.";

    const analysis = await this.llm.describeImage(input.imageUrl, prompt);

    return {
      agent: this.name,
      reply: analysis,
      logs: [log(this.name, "analyze-image", input.imageUrl)],
    };
  }
}
