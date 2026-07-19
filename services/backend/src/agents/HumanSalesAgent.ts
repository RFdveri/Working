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
  "проявляй эмпатию, не используй шаблонные фразы и канцелярит.\n\n" +
  "СТРОГОЕ ПРАВИЛО: любая цена, артикул, модель, размер или марка комплектующего " +
  "(коробка, наличник, добор, плинтус, фурнитура и т.д.), которую ты называешь клиенту, " +
  "ДОЛЖНА дословно присутствовать в разделе «Факты для ответа» ниже. Если в «Фактах» " +
  "этого нет — запрещено называть даже правдоподобный пример или \"обычно это стоит...\": " +
  "вместо этого прямо скажи клиенту, что нужно уточнить, и спроси то, чего не хватает " +
  "(агенты системы сами досчитают, когда получат ответ). Правило действует даже если " +
  "тебе кажется, что ты «примерно знаешь» типичную цену или размер — ты не источник " +
  "цен, каталог — источник цен.";

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
