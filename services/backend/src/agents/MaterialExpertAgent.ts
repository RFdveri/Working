import type { Agent, AgentContext, AgentResult, CoveringMaterial } from "@ai-door-assistant/shared";
import type { LlmProvider } from "../integrations/llm/LlmProvider.js";
import { log } from "./support.js";

export interface MaterialExpertInput {
  covering: CoveringMaterial;
  usageConditions?: string;
}

const COVERING_FACTS: Record<CoveringMaterial, string> = {
  enamel:
    "Эмаль: гладкая глянцевая/матовая поверхность, легко моется, чувствительна к сколам и точечным ударам.",
  "eco-veneer":
    "Экошпон: точная имитация текстуры дерева, устойчив к влаге и выгоранию лучше натурального шпона.",
  pvc: "ПВХ-плёнка: бюджетное решение, влагостойкая, менее долговечна при перепадах температур.",
  "solid-wood":
    "Массив: натуральный премиальный материал, требует стабильного микроклимата, чувствителен к влажности.",
  "natural-veneer":
    "Натуральный шпон: премиальный внешний вид натурального дерева, менее устойчив к влаге, чем экошпон.",
  polypropylene:
    "Полипропилен: устойчив к влаге и механическим воздействиям, подходит для интенсивной эксплуатации.",
  laminate:
    "Ламинат: прочное износостойкое покрытие, хорошее соотношение цены и долговечности.",
  other: "Материал покрытия не из стандартного списка — уточните характеристики у менеджера.",
};

/** Gives covering/material recommendations grounded in known facts, tailored by usage conditions via the LLM. */
export class MaterialExpertAgent implements Agent<MaterialExpertInput, string> {
  readonly name = "materialExpert" as const;

  constructor(private readonly llm: LlmProvider) {}

  async handle(
    _context: AgentContext,
    input: MaterialExpertInput
  ): Promise<AgentResult<string>> {
    const facts = COVERING_FACTS[input.covering];

    const reply = await this.llm.complete([
      {
        role: "system",
        content:
          "Ты эксперт по покрытиям межкомнатных и входных дверей. Используй только факты, " +
          "переданные тебе явно, ничего не придумывай про цены, сроки или наличие.",
      },
      {
        role: "user",
        content:
          `Материал: ${input.covering}. Факты: ${facts}. ` +
          `Условия эксплуатации клиента: ${input.usageConditions ?? "не указаны"}. ` +
          "Дай короткую рекомендацию.",
      },
    ]);

    return {
      agent: this.name,
      reply,
      logs: [log(this.name, "recommend", input.covering)],
    };
  }
}
