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
import type { ProductAgent } from "./ProductAgent.js";
import type { SearchAgent } from "./SearchAgent.js";
import type { VisionAgent } from "./VisionAgent.js";
import type { VoiceAgent } from "./VoiceAgent.js";
import { log } from "./support.js";

export interface DirectorInput {
  message: Message;
}

export type DirectorPayload = ChatTurnResult;

const PRICE_INTENT = /цен|сто[ий]т|сколько/i;
const KIT_INTENT = /комплект|под ключ|коробк|наличник/i;
const DEFAULT_KIT_FRAME_QUANTITY = 3;
const DEFAULT_KIT_CASING_QUANTITY = 5;
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
    private readonly product: ProductAgent,
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
      return { agent: this.name, logs, payload: { foundProducts: [], focusProduct: context.focusProduct } };
    }

    if (context.mode === "off") {
      logs.push(log(this.name, "suppressed", "mode=off"));
      return { agent: this.name, logs, payload: { foundProducts: [], focusProduct: context.focusProduct } };
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

    // Resolve the product already anchoring this conversation (if any) by SKU, so a
    // later turn that doesn't repeat the product's name can't silently price a
    // different, unrelated item that a fresh full-text search happens to match.
    let focusProduct = context.focusProduct;
    let anchoredProduct: Product | undefined;
    if (focusProduct) {
      const focusLookup = await this.product.handle(context, { sku: focusProduct.sku });
      logs.push(...focusLookup.logs);
      anchoredProduct = focusLookup.payload ?? undefined;
    }

    if (enrichedText.trim().length > 0) {
      const searchResult = await this.search.handle(context, { text: enrichedText });
      logs.push(...searchResult.logs);
      foundProducts = searchResult.payload ?? [];
      if (searchResult.clarifyingQuestions) clarifyingQuestions.push(...searchResult.clarifyingQuestions);

      if (foundProducts.length > 0) {
        groundedContext += `Найденные товары: ${foundProducts
          .map((p) => `${p.name} (${p.sku}), цена: ${p.price ?? "не указана"}`)
          .join("; ")}. `;
      }

      const primaryProduct = anchoredProduct ?? foundProducts[0];
      if (primaryProduct) {
        if (!focusProduct) {
          focusProduct = { id: primaryProduct.id, sku: primaryProduct.sku, name: primaryProduct.name };
        }
        // Repeated every turn (not just when first established) so the sales
        // reply stays anchored to this product even on turns where the fresh
        // search above surfaces unrelated alternatives.
        groundedContext += `Клиент сейчас обсуждает именно этот товар: ${primaryProduct.name} (${primaryProduct.sku}), цена ${primaryProduct.price ?? "не указана"}. Держись этого товара в ответе, если явно не попросили другой. `;

        const wantsKit = KIT_INTENT.test(enrichedText);
        if (PRICE_INTENT.test(enrichedText) || wantsKit) {
          const priceResult = await this.price.handle(context, {
            product: primaryProduct,
            kit: wantsKit
              ? { frameQuantity: DEFAULT_KIT_FRAME_QUANTITY, casingQuantity: DEFAULT_KIT_CASING_QUANTITY }
              : undefined,
          });
          logs.push(...priceResult.logs);
          priceCalculation = priceResult.payload;
          if (priceResult.payload) {
            const lineItems = [
              priceResult.payload.door,
              ...priceResult.payload.components,
              ...(priceResult.payload.customSizeSurcharge ? [priceResult.payload.customSizeSurcharge] : []),
              ...priceResult.payload.services,
            ]
              .map((item) => `${item.label}: ${item.amount} ${priceResult.payload!.currency}`)
              .join("; ");
            groundedContext += `Расчёт стоимости (для товара ${primaryProduct.name}) — ${lineItems}; итого: ${priceResult.payload.total} ${priceResult.payload.currency}. `;
            if (priceResult.payload.missingInputs.length > 0) {
              groundedContext += `Данные, которых не хватает для полного расчёта (не придумывай их, спроси у клиента/менеджера): ${priceResult.payload.missingInputs.join(" ")} `;
            }
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
        payload: { foundProducts, priceCalculation, focusProduct },
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
      payload: { reply: salesResult.reply, foundProducts, priceCalculation, focusProduct },
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
