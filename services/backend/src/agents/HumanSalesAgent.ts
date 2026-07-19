import type { Agent, AgentContext, AgentResult } from "@ai-door-assistant/shared";
import type { LlmProvider } from "../integrations/llm/LlmProvider.js";
import { log } from "./support.js";

export interface HumanSalesInput {
  customerMessage: string;
  /** Grounded facts gathered by other agents this turn (product data, price, etc.) to weave into the reply. */
  groundedContext?: string;
}

const SYSTEM_PROMPT =
  "Ты опытный продавец-консультант дверного салона. Общайся живо и по-человечески, " +
  "проявляй эмпатию, не используй шаблонные фразы и канцелярит. Опирайся только на " +
  "переданные тебе факты о товарах, ценах и наличии — если данных не хватает, " +
  "прямо спроси уточнение у клиента вместо того чтобы придумывать.";

/** The conversational front for the customer — natural, empathetic, never scripted, never inventing facts. */
export class HumanSalesAgent implements Agent<HumanSalesInput, string> {
  readonly name = "humanSales" as const;

  constructor(private readonly llm: LlmProvider) {}

  async handle(
    context: AgentContext,
    input: HumanSalesInput
  ): Promise<AgentResult<string>> {
    const historyText = context.history
      .slice(-10)
      .map((m) => `${m.role}: ${m.text}`)
      .join("\n");

    const reply = await this.llm.complete([
      { role: "system", content: SYSTEM_PROMPT },
      {
        role: "user",
        content:
          `История диалога:\n${historyText}\n\n` +
          `Факты для ответа: ${input.groundedContext ?? "нет дополнительных фактов"}\n\n` +
          `Новое сообщение клиента: ${input.customerMessage}`,
      },
    ]);

    return {
      agent: this.name,
      reply,
      logs: [log(this.name, "respond", input.customerMessage.slice(0, 80))],
    };
  }
}
