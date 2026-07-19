import type {
  Agent,
  AgentContext,
  AgentLogEntry,
  AgentResult,
  Attachment,
  ChatTurnResult,
  Message,
  PriceCalculation,
  Product,
} from "@ai-door-assistant/shared";
import type { CrmAgent } from "./CrmAgent.js";
import type { DocumentAgent } from "./DocumentAgent.js";
import type { HumanSalesAgent } from "./HumanSalesAgent.js";
import type { PriceAgent } from "./PriceAgent.js";
import type { SearchAgent } from "./SearchAgent.js";
import type { VisionAgent } from "./VisionAgent.js";
import type { VoiceAgent } from "./VoiceAgent.js";
import { log } from "./support.js";

export interface DirectorInput {
  message: Message;
}

export type DirectorPayload = ChatTurnResult;

const PRICE_INTENT = /цен|сто[ий]т|сколько/i;
const ATTACHMENT_KIND_TO_MIME: Record<string, string> = {
  image: "image/jpeg",
  pdf: "application/pdf",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  dwg: "application/acad",
  audio: "audio/ogg",
  other: "application/octet-stream",
};

/**
 * Routes an incoming message across the specialist agents, gathers grounded facts,
 * and asks the Human Sales Agent to produce the final natural-language reply.
 * Stops producing customer replies the moment a human manager takes over the
 * conversation (context.managerActive), per the spec's handoff rule.
 */
export class DirectorAgent implements Agent<DirectorInput, DirectorPayload> {
  readonly name = "director" as const;

  constructor(
    private readonly search: SearchAgent,
    private readonly price: PriceAgent,
    private readonly humanSales: HumanSalesAgent,
    private readonly vision: VisionAgent,
    private readonly document: DocumentAgent,
    private readonly voice: VoiceAgent,
    private readonly crm: CrmAgent
  ) {}

  async handle(
    context: AgentContext,
    input: DirectorInput
  ): Promise<AgentResult<DirectorPayload>> {
    const logs: AgentLogEntry[] = [log(this.name, "receive-message", input.message.id)];

    if (context.managerActive) {
      logs.push(log(this.name, "suppressed", "manager active — not replying to customer"));
      return { agent: this.name, logs, payload: { foundProducts: [] } };
    }

    if (context.mode === "off") {
      logs.push(log(this.name, "suppressed", "mode=off"));
      return { agent: this.name, logs, payload: { foundProducts: [] } };
    }

    const { text: enrichedText, extraLogs } = await this.enrichWithAttachments(
      context,
      input.message
    );
    logs.push(...extraLogs);

    let foundProducts: Product[] = [];
    let priceCalculation: PriceCalculation | undefined;
    const clarifyingQuestions: string[] = [];
    let groundedContext = "";

    if (enrichedText.trim().length > 0) {
      const searchResult = await this.search.handle(context, { text: enrichedText });
      logs.push(...searchResult.logs);
      foundProducts = searchResult.payload ?? [];
      if (searchResult.clarifyingQuestions) clarifyingQuestions.push(...searchResult.clarifyingQuestions);

      if (foundProducts.length > 0) {
        groundedContext += `Найденные товары: ${foundProducts
          .map((p) => `${p.name} (${p.sku}), цена: ${p.price ?? "не указана"}`)
          .join("; ")}. `;

        if (PRICE_INTENT.test(enrichedText)) {
          const priceResult = await this.price.handle(context, { product: foundProducts[0] });
          logs.push(...priceResult.logs);
          priceCalculation = priceResult.payload;
          if (priceResult.payload) {
            groundedContext += `Расчёт стоимости: итого ${priceResult.payload.total} ${priceResult.payload.currency}. `;
          }
          if (priceResult.clarifyingQuestions) clarifyingQuestions.push(...priceResult.clarifyingQuestions);
        }
      }
    }

    if (context.mode === "hints-only") {
      logs.push(log(this.name, "hints-only", "reply withheld, only internal notes produced"));
      return {
        agent: this.name,
        logs,
        payload: { foundProducts, priceCalculation },
        clarifyingQuestions: clarifyingQuestions.length > 0 ? clarifyingQuestions : undefined,
      };
    }

    const salesResult = await this.humanSales.handle(context, {
      customerMessage: enrichedText,
      groundedContext,
    });
    logs.push(...salesResult.logs);

    if (context.dealId) {
      const noteResult = await this.crm.handle(context, {
        op: "add-note",
        dealId: Number(context.dealId),
        text: `AI: ${salesResult.reply ?? ""}`,
      });
      logs.push(...noteResult.logs);
    }

    return {
      agent: this.name,
      reply: salesResult.reply,
      payload: { reply: salesResult.reply, foundProducts, priceCalculation },
      logs,
      clarifyingQuestions: clarifyingQuestions.length > 0 ? clarifyingQuestions : undefined,
    };
  }

  private async enrichWithAttachments(
    context: AgentContext,
    message: Message
  ): Promise<{ text: string; extraLogs: AgentLogEntry[] }> {
    const extraLogs: AgentLogEntry[] = [];
    const parts = [message.text];

    for (const attachment of message.attachments ?? []) {
      const extracted = await this.analyzeAttachment(context, attachment);
      if (extracted) parts.push(extracted);
      extraLogs.push(log(this.name, "attachment-processed", `${attachment.kind}:${attachment.fileName}`));
    }

    return { text: parts.filter(Boolean).join("\n"), extraLogs };
  }

  private async analyzeAttachment(
    context: AgentContext,
    attachment: Attachment
  ): Promise<string | undefined> {
    switch (attachment.kind) {
      case "image": {
        const result = await this.vision.handle(context, { imageUrl: attachment.url });
        return result.reply;
      }
      case "audio": {
        const result = await this.voice.handle(context, { audioUrl: attachment.url });
        return result.payload;
      }
      case "pdf":
      case "docx":
      case "xlsx":
      case "dwg":
      case "other": {
        const result = await this.document.handle(context, {
          fileUrl: attachment.url,
          kind: attachment.kind,
          mimeType: ATTACHMENT_KIND_TO_MIME[attachment.kind],
        });
        return result.payload;
      }
    }
  }
}
