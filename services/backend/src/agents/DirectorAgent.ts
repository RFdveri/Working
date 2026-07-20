import type {
  Agent,
  AgentContext,
  AgentLogEntry,
  AgentResult,
  Attachment,
  ChatTurnResult,
  Message,
  OpeningSizeKind,
  OrderDoorGroup,
  PriceCalculation,
  Product,
  StandardDoorSizeReference,
} from "@ai-door-assistant/shared";
import { formatStandardDoorSizesForPrompt, loadStandardDoorSizes } from "../integrations/reference/DoorSizeReference.js";
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
const KIT_INTENT = /комплект|под ключ|коробк|наличник|добор/i;
const DEFAULT_KIT_FRAME_QUANTITY = 3;
const DEFAULT_KIT_CASING_QUANTITY = 5;
// \w (and \b, which is built on it) only matches ASCII word characters in JS —
// it silently fails to extend across Cyrillic letters, so word stems use an
// explicit [а-яё]* class instead, and the unit is bounded with a negative
// lookahead rather than a trailing \b.
const WALL_THICKNESS_PATTERN =
  /(?:толщин[а-яё]*\s+стен[а-яё]*|стен[а-яё]*\s+толщин[а-яё]*)\D{0,10}(\d+(?:[.,]\d+)?)\s*(мм|см|м)(?![а-яё])/iu;

/** Parses "толщина стены 14см" (or the reverse word order) into millimeters. */
function parseWallThicknessMm(text: string): number | undefined {
  const match = WALL_THICKNESS_PATTERN.exec(text);
  if (!match) return undefined;
  const value = Number(match[1].replace(",", "."));
  const unit = match[2].toLowerCase();
  const multiplier = unit === "мм" ? 1 : unit === "см" ? 10 : 1000;
  return value * multiplier;
}

// Matches "3 двери 70" / "3 шт двери 70" / "3 двери 80 на 200" style
// order-quantity+size(+height) mentions. \D{0,15}? (non-digit, lazy) bridges
// words like "шириной"/"размером" between the door-count word and the size
// number without needing \w on Cyrillic text. The optional trailing group
// captures a height when given as "W на H" / "WxH".
const DOOR_GROUP_PATTERN =
  /(\d+)\s*(?:шт\.?\s*)?двер[а-яё]*\D{0,15}?(\d+)(?:\s*(?:[x×хX]|на)\s*(\d+))?/giu;
const LEAF_KEYWORD_PATTERN = /полотн[а-яё]*/iu;
const OPENING_KEYWORD_PATTERN = /про[её]м[а-яё]*/iu;

/**
 * Parses order lines like "3 двери 70, 2 двери 80" into door groups. The size
 * is assumed to be centimeters when it's a plausible door-width-in-cm value
 * (<=200) and millimeters otherwise, since customers write door sizes both
 * ways. Whether the number is the leaf's own width or the rough opening is
 * only set when a "полотно"/"проём" word appears near it — otherwise it's
 * left "unspecified" so the caller must ask rather than assume.
 */
// A door leaf/opening is never realistically outside this range — rejects
// false matches like "5 дверей: 3 штуки в жилые комнаты", where the "3" is a
// sub-count, not a size, and would otherwise parse as an absurd 30mm door.
const PLAUSIBLE_WIDTH_RANGE_MM: [number, number] = [300, 1500];

function parseDoorGroups(text: string): OrderDoorGroup[] | undefined {
  const groups: OrderDoorGroup[] = [];
  for (const match of text.matchAll(DOOR_GROUP_PATTERN)) {
    const quantity = Number(match[1]);
    const rawSize = Number(match[2]);
    if (!quantity || !rawSize || match.index === undefined) continue;

    const widthMm = rawSize <= 200 ? rawSize * 10 : rawSize;
    if (widthMm < PLAUSIBLE_WIDTH_RANGE_MM[0] || widthMm > PLAUSIBLE_WIDTH_RANGE_MM[1]) continue;

    const windowStart = Math.max(0, match.index - 20);
    const windowEnd = match.index + match[0].length + 20;
    const contextWindow = text.slice(windowStart, windowEnd);
    const widthKind: OpeningSizeKind = LEAF_KEYWORD_PATTERN.test(contextWindow)
      ? "leaf"
      : OPENING_KEYWORD_PATTERN.test(contextWindow)
        ? "opening"
        : "unspecified";

    let heightMm: number | undefined;
    const rawHeight = match[3] ? Number(match[3]) : undefined;
    if (rawHeight) {
      const candidateHeightMm = rawHeight <= 250 ? rawHeight * 10 : rawHeight;
      if (candidateHeightMm >= 1500 && candidateHeightMm <= 2500) heightMm = candidateHeightMm;
    }

    groups.push({ quantity, widthMm, widthKind, heightMm, heightKind: heightMm !== undefined ? widthKind : undefined });
  }
  return groups.length > 0 ? groups : undefined;
}

// Maps a room word in the customer's text to a row in the standard-size
// reference table (see standard-door-sizes.json). Stems, not whole words —
// "жилые комнаты", "жилую", "жилой" all start with "жил".
const ROOM_KEYWORD_STEMS: Array<{ stem: RegExp; room: string }> = [
  { stem: /кладов/iu, room: "Кладовая" },
  { stem: /санузел|ванн/iu, room: "Санузел/ванна" },
  { stem: /кухн/iu, room: "Кухня" },
  { stem: /жил/iu, room: "Жилая комната" },
  { stem: /гостин/iu, room: "Гостиная (1 полотно)" },
];
const ROOM_GROUP_PATTERN =
  /(\d+)\s*(?:шт\.?\s*)?\D{0,25}?(кладов[а-яё]*|санузел[а-яё]*|ванн[а-яё]*|кухн[а-яё]*|жил[а-яё]*|гостин[а-яё]*)/giu;
// Only apply standard sizes when the customer explicitly hands off the decision
// to us ("по стандарту", "ориентируйтесь") — otherwise a bare room mention isn't
// permission to assume a size, it's still something to ask about.
const STANDARD_SIZE_HANDOFF_PATTERN = /по\s*стандарт[а-яё]*|стандартн[а-яё]*\s*размер|ориентир[а-яё]*/iu;

/**
 * Parses "3 штуки в жилые комнаты и 2 на кухню, ориентируйтесь по стандарту"
 * into door groups using the reference table's leaf sizes for the mentioned
 * rooms — only when the customer explicitly said to go by the standard, so
 * this is following an instruction, not guessing on our own initiative.
 */
function parseRoomBasedDoorGroups(
  text: string,
  reference: StandardDoorSizeReference
): OrderDoorGroup[] | undefined {
  if (!STANDARD_SIZE_HANDOFF_PATTERN.test(text)) return undefined;

  const groups: OrderDoorGroup[] = [];
  for (const match of text.matchAll(ROOM_GROUP_PATTERN)) {
    const quantity = Number(match[1]);
    if (!quantity) continue;
    const roomMatch = ROOM_KEYWORD_STEMS.find((r) => r.stem.test(match[2]));
    const row = roomMatch && reference.rows.find((r) => r.room === roomMatch.room);
    if (!row) continue;
    groups.push({
      quantity,
      widthMm: row.leafWidthMm,
      widthKind: "leaf",
      heightMm: row.leafHeightMm,
      heightKind: "leaf",
    });
  }
  return groups.length > 0 ? groups : undefined;
}

// Generic words that show up in most door names/descriptions and don't
// identify a specific model on their own (material, door-leaf type, common
// structural words) — excluded when checking whether the customer explicitly
// named a *different* product than the one the conversation is anchored to.
const GENERIC_PRODUCT_NAME_WORDS = new Set([
  "дверь",
  "двери",
  "массива",
  "массив",
  "ольхи",
  "ольха",
  "сосны",
  "сосна",
  "дуба",
  "дуб",
  "мдф",
  "стекло",
  "стеклом",
  "эмаль",
  "эмали",
  "белый",
  "белая",
  "белое",
  "черный",
  "черная",
]);

/** Lowercases and strips spaces/hyphens so "Скай-3" and "скай 3" compare equal. */
function compact(value: string): string {
  return value.toLowerCase().replace(/[\s-]+/g, "");
}

/**
 * True when the customer's own text names this product specifically (a
 * distinguishing model word like "Валенсия" or "Скай-3"), as opposed to just
 * matching on generic material/color words a full-text search also matches
 * on. Matching is hyphen/space-insensitive since customers write "Скай-3" as
 * "скай 3" as often as not, and the threshold is 4 chars (not 5) because
 * plenty of real model names are short ("Скай", "Вита", "Уно").
 */
function mentionsProductByName(product: Product, text: string): boolean {
  const compactText = compact(text);
  return product.name
    .replace(/[()]/g, " ")
    .split(/\s+/)
    .some((word) => {
      const normalized = compact(word.replace(/[.,]/g, ""));
      if (normalized.length < 4 || GENERIC_PRODUCT_NAME_WORDS.has(normalized)) return false;
      return compactText.includes(normalized);
    });
}

/** Whether "ПГ"/"ПО" appears as its own word in the product name, not just as a substring. */
function hasDoorTypeToken(name: string, token: "ПГ" | "ПО"): boolean {
  return name
    .replace(/[()]/g, " ")
    .split(/\s+/)
    .includes(token);
}
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
      return {
        agent: this.name,
        logs,
        payload: { foundProducts: [], focusProduct: context.focusProduct, orderSpec: context.orderSpec },
      };
    }

    if (context.mode === "off") {
      logs.push(log(this.name, "suppressed", "mode=off"));
      return {
        agent: this.name,
        logs,
        payload: { foundProducts: [], focusProduct: context.focusProduct, orderSpec: context.orderSpec },
      };
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

    // Persisted order quantities/sizes/wall thickness (see OrderSpec) — merged
    // the same way as focusProduct: whatever's stated this turn updates it,
    // otherwise earlier turns' values carry forward instead of being silently
    // forgotten and re-guessed from scratch.
    let orderSpec = context.orderSpec;
    const parsedDoorGroups =
      parseDoorGroups(enrichedText) ?? parseRoomBasedDoorGroups(enrichedText, loadStandardDoorSizes());
    const parsedWallThicknessMm = parseWallThicknessMm(enrichedText);
    if (parsedDoorGroups || parsedWallThicknessMm !== undefined) {
      orderSpec = {
        doorGroups: parsedDoorGroups ?? orderSpec?.doorGroups ?? [],
        wallThicknessMm: parsedWallThicknessMm ?? orderSpec?.wallThicknessMm,
      };
    }

    // A customer answering "Это размер полотна" to the leaf-vs-opening
    // clarifying question doesn't repeat any numbers, so parseDoorGroups above
    // finds nothing and this reply would otherwise be silently lost — leaving
    // the group "unspecified" forever and re-asking the same question every
    // turn. Only a standalone leaf/opening statement (no fresh sizes this
    // turn) resolves the *existing* unresolved groups.
    if (!parsedDoorGroups && orderSpec?.doorGroups.some((g) => g.widthKind === "unspecified")) {
      const standaloneKind: OpeningSizeKind | undefined = LEAF_KEYWORD_PATTERN.test(enrichedText)
        ? "leaf"
        : OPENING_KEYWORD_PATTERN.test(enrichedText)
          ? "opening"
          : undefined;
      if (standaloneKind) {
        orderSpec = {
          ...orderSpec,
          doorGroups: orderSpec.doorGroups.map((g) =>
            g.widthKind === "unspecified"
              ? { ...g, widthKind: standaloneKind, heightKind: g.heightMm !== undefined ? standaloneKind : g.heightKind }
              : g
          ),
        };
      }
    }

    if (enrichedText.trim().length > 0) {
      const searchResult = await this.search.handle(context, { text: enrichedText });
      logs.push(...searchResult.logs);
      // Excludes standalone hardware/accessory offers (коробка, наличник, добор,
      // капитель, ...) — these are never the door itself, only priced as kit
      // components via PriceAgent's configurator-backed `kit` resolution. Without
      // this, a customer just saying "добор" could switch the conversation's focus
      // to a "Добор ..." accessory SKU instead of the door being discussed.
      foundProducts = (searchResult.payload ?? []).filter(
        (p) => !p.characteristics.categoryPath?.includes("Комплектующие")
      );
      if (searchResult.clarifyingQuestions) clarifyingQuestions.push(...searchResult.clarifyingQuestions);

      if (foundProducts.length > 0) {
        groundedContext += `Найденные товары: ${foundProducts
          .map((p) => `${p.name} (${p.sku}), цена: ${p.price ?? "не указана"}`)
          .join("; ")}. `;
      }

      // Search ranks by raw token-match count, so a generic word shared with
      // many offers (e.g. "античный орех") can outrank the specific model the
      // customer actually named — scan the whole result set for an explicit
      // name match rather than trusting foundProducts[0] alone.
      const nameMatches = foundProducts.filter((p) => mentionsProductByName(p, enrichedText));
      // A model often comes in ПГ (blind) / ПО (glazed) variants that both
      // match the same name — use "глухая"/"остеклённая" wording, when present,
      // to pick the right one instead of whichever happens to rank first.
      const wantsBlind = /глух/iu.test(enrichedText);
      const wantsGlazed = /остекл|со\s*стеклом/iu.test(enrichedText);
      const explicitMatch =
        (wantsBlind && nameMatches.find((p) => hasDoorTypeToken(p.name, "ПГ"))) ||
        (wantsGlazed && nameMatches.find((p) => hasDoorTypeToken(p.name, "ПО"))) ||
        nameMatches[0];
      const isExplicitSwitch = explicitMatch && (!anchoredProduct || explicitMatch.id !== anchoredProduct.id);

      const primaryProduct = explicitMatch ?? anchoredProduct ?? foundProducts[0];
      if (primaryProduct) {
        if (!focusProduct || isExplicitSwitch) {
          focusProduct = { id: primaryProduct.id, sku: primaryProduct.sku, name: primaryProduct.name };
        }
        // Repeated every turn (not just when first established) so the sales
        // reply stays anchored to this product even on turns where the fresh
        // search above surfaces unrelated alternatives.
        groundedContext += `Клиент сейчас обсуждает именно этот товар: ${primaryProduct.name} (${primaryProduct.sku}), цена ${primaryProduct.price ?? "не указана"}. Держись этого товара в ответе, если явно не попросили другой. `;

        // Once an order spec exists (started by an earlier "посчитайте
        // комплект"-style message), keep trying to complete/compute it on every
        // later turn too — a customer answering "толщина стены 14см" wouldn't
        // repeat "комплект", but they're still mid-way through the same kit
        // request, not asking something unrelated.
        const wantsKit = KIT_INTENT.test(enrichedText) || Boolean(orderSpec && orderSpec.doorGroups.length > 0);

        if (wantsKit) {
          // Reference-only data (never overrides what the customer actually
          // states) so the sales agent can advise on sizes competently instead
          // of inventing numbers, and so it phrases the clarifying question below
          // usefully rather than just saying "I need more data".
          groundedContext += formatStandardDoorSizesForPrompt(loadStandardDoorSizes()) + " ";

          if (orderSpec && orderSpec.doorGroups.length > 0) {
            const groupsText = orderSpec.doorGroups
              .map((g) => `${g.quantity} шт × ${g.widthMm} мм (${g.widthKind === "unspecified" ? "не уточнено, полотно или проём" : g.widthKind === "leaf" ? "полотно" : "проём"})`)
              .join("; ");
            groundedContext += `Известные группы дверей в заказе: ${groupsText}. Толщина стены: ${orderSpec.wallThicknessMm !== undefined ? `${orderSpec.wallThicknessMm} мм` : "не указана"}. `;
          }
        }

        if (wantsKit) {
          const unresolvedGroup = orderSpec?.doorGroups.find((g) => g.widthKind === "unspecified");
          if (!orderSpec || orderSpec.doorGroups.length === 0) {
            clarifyingQuestions.push(
              "Сколько дверей нужно и какого они размера — полотно или проём, в мм или см? Так посчитаю точный комплект, а не примерный."
            );
          } else if (unresolvedGroup) {
            clarifyingQuestions.push(
              `Уточните: ${unresolvedGroup.widthMm} мм — это размер полотна (самой двери) или проёма (в стене)? Обычно проём делают шире полотна на 80–100 мм и выше на 70–80 мм.`
            );
          } else if (orderSpec.wallThicknessMm === undefined) {
            clarifyingQuestions.push(
              "Подскажите, пожалуйста, толщину стены (в мм или см) — без неё не могу подобрать добор."
            );
          } else {
            const totalDoorQuantity = orderSpec.doorGroups.reduce((sum, g) => sum + g.quantity, 0);
            const priceResult = await this.price.handle(context, {
              product: primaryProduct,
              kit: {
                frameQuantity: DEFAULT_KIT_FRAME_QUANTITY,
                casingQuantity: DEFAULT_KIT_CASING_QUANTITY,
                doorQuantity: totalDoorQuantity,
                wallThicknessMm: orderSpec.wallThicknessMm,
              },
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
              groundedContext += `Расчёт стоимости на ${totalDoorQuantity} дверей (${primaryProduct.name}) — ${lineItems}; итого: ${priceResult.payload.total} ${priceResult.payload.currency}. `;

              const distinctWidths = new Set(orderSpec.doorGroups.map((g) => g.widthMm));
              if (distinctWidths.size > 1) {
                groundedContext += `Важно: цена полотна в каталоге одна на артикул, отдельной цены по ширине (${[...distinctWidths].join(" / ")} мм) нет — расчёт использует единую цену полотна для всех ${totalDoorQuantity} дверей, скажи об этом клиенту прямо, не изображай точность, которой нет. `;
              }
              if (priceResult.payload.missingInputs.length > 0) {
                groundedContext += `Данные, которых не хватает для полного расчёта (не придумывай их, спроси у клиента/менеджера): ${priceResult.payload.missingInputs.join(" ")} `;
              }
            }
            if (priceResult.clarifyingQuestions) clarifyingQuestions.push(...priceResult.clarifyingQuestions);
          }
        } else if (PRICE_INTENT.test(enrichedText)) {
          const priceResult = await this.price.handle(context, { product: primaryProduct });
          logs.push(...priceResult.logs);
          priceCalculation = priceResult.payload;
          if (priceResult.payload) {
            groundedContext += `Цена товара ${primaryProduct.name}: ${priceResult.payload.total} ${priceResult.payload.currency} (только полотно, без комплектующих). `;
            if (priceResult.payload.missingInputs.length > 0) {
              groundedContext += `Данные, которых не хватает (не придумывай их): ${priceResult.payload.missingInputs.join(" ")} `;
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
        payload: { foundProducts, priceCalculation, focusProduct, orderSpec },
        clarifyingQuestions: clarifyingQuestions.length > 0 ? clarifyingQuestions : undefined,
      };
    }

    if (clarifyingQuestions.length > 0) {
      // clarifyingQuestions is also returned structurally in AgentResult, but
      // HumanSalesAgent only sees groundedContext — without this, the specific
      // things Director determined are missing (quantity, leaf-vs-opening,
      // wall thickness, ...) never actually get asked, and the model tends to
      // improvise its own, less precise question instead.
      groundedContext += `Обязательно спроси у клиента именно это: ${clarifyingQuestions.join(" ")} `;
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
      payload: { reply: salesResult.reply, foundProducts, priceCalculation, focusProduct, orderSpec },
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
