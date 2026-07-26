import type { Agent, AgentContext, AgentResult, DialogSummary } from "@ai-door-assistant/shared";
import type { AmoCrmClient } from "../integrations/amocrm/AmoCrmClient.js";
import type { LlmProvider } from "../integrations/llm/LlmProvider.js";
import { log } from "./support.js";

export interface SummaryAgentInput {
  preliminaryCalculationTotal?: number;
}

/** After a dialog ends: summarizes interests/recommendations/calculation and files it as an AmoCRM note. */
export class SummaryAgent implements Agent<SummaryAgentInput, DialogSummary> {
  readonly name = "summary" as const;

  constructor(
    private readonly llm: LlmProvider,
    private readonly amoCrm: AmoCrmClient | null
  ) {}

  async handle(
    context: AgentContext,
    input: SummaryAgentInput
  ): Promise<AgentResult<DialogSummary>> {
    const historyText = context.history.map((m) => `${m.role}: ${m.text}`).join("\n");

    const summaryText = await this.llm.complete([
      {
        role: "system",
        content:
          "Составь краткое резюме диалога с клиентом дверного салона: интересы клиента, " +
          "рекомендации, которые дал ассистент, и предварительный расчёт, если он был. " +
          "Только факты из диалога, ничего не придумывай.",
      },
      { role: "user", content: historyText },
    ]);

    const summary: DialogSummary = {
      conversationId: context.conversationId,
      dealId: context.dealId,
      interests: context.memory.preferences,
      recommendations: context.memory.selectedModels,
      preliminaryCalculationTotal: input.preliminaryCalculationTotal,
      notes: summaryText,
      createdAt: new Date().toISOString(),
    };

    if (this.amoCrm && context.dealId) {
      await this.amoCrm.addNote({
        dealId: Number(context.dealId),
        text: summaryText,
        createdAt: summary.createdAt,
      });
    }

    return {
      agent: this.name,
      payload: summary,
      logs: [
        log(
          this.name,
          "summarize",
          this.amoCrm && context.dealId ? "note added to AmoCRM" : "AmoCRM не настроен — резюме не сохранено в CRM"
        ),
      ],
    };
  }
}
