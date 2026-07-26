import type {
  Agent,
  AgentContext,
  AgentResult,
  PriceCalculation,
  Product,
} from "@ai-door-assistant/shared";
import type { CatalogClient } from "../integrations/catalog/CatalogClient.js";
import type { KitComponentOption, ProductConfiguratorClient } from "../integrations/catalog/ProductConfiguratorClient.js";
import type { ServicePriceProvider } from "../integrations/pricing/ServicePriceProvider.js";
import { log } from "./support.js";

export interface PriceKitComponent {
  /** Catalog SKU of the component (e.g. a specific "коробка"/"наличник" offer). */
  sku: string;
  quantity: number;
  /** Human label for the line item, e.g. "Коробка" — defaults to the catalog product's name. */
  role?: string;
}

export interface PriceKitRequest {
  /** Number of frame ("коробка") pieces per door — a standard door opening kit uses 3. */
  frameQuantity: number;
  /** Number of casing ("наличник") pieces per door — a standard door opening kit uses 5. */
  casingQuantity: number;
  /** How many complete doors this order covers — every kit quantity below is per-door and gets multiplied by this. Defaults to 1. */
  doorQuantity?: number;
  /**
   * Wall thickness in mm. If it exceeds the frame's own depth (parsed from its
   * label, e.g. "...40" in "Массив дерева 2080x75x40"), a matching добор
   * (jamb extension) option is looked up by the extra depth it covers — never
   * guessed, only picked when the door's configurator has one.
   */
  wallThicknessMm?: number;
  /** добор pieces per door — defaults to frameQuantity (it runs the same three sides as the frame). */
  jambExtensionQuantity?: number;
}

export interface PriceAgentInput {
  product: Product;
  customSize?: { widthMm: number; heightMm: number };
  services?: string[];
  /** Kit components (frame, casing, ...) priced from the catalog by SKU × quantity. */
  components?: PriceKitComponent[];
  /**
   * Auto-priced kit: reads this door's own configurator options (frame/casing
   * prices aren't in the bulk catalog feed, only on the product's own page)
   * and picks the frame if there's exactly one option, and the cheapest
   * "прямой" (flat/straight) casing per the store's default-casing rule.
   * Anything ambiguous (no single frame option, no matching casing) becomes
   * a clarifying question rather than a guess.
   */
  kit?: PriceKitRequest;
}

const FLAT_CASING_PATTERN = /прямой/iu;

/**
 * Computes door + kit components + custom-size + services pricing. Asks a
 * clarifying question instead of guessing whenever an input it needs
 * (catalog price, a component SKU, surcharge rule, service price) is missing —
 * this includes refusing to pick a frame/casing SKU on the customer's behalf
 * when the request doesn't specify one and the door's configurator doesn't
 * resolve unambiguously.
 */
export class PriceAgent implements Agent<PriceAgentInput, PriceCalculation> {
  readonly name = "price" as const;

  constructor(
    private readonly catalog: CatalogClient,
    private readonly servicePrices: ServicePriceProvider,
    private readonly productConfigurator: ProductConfiguratorClient
  ) {}

  async handle(
    _context: AgentContext,
    input: PriceAgentInput
  ): Promise<AgentResult<PriceCalculation>> {
    const missingInputs: string[] = [];
    const currency = input.product.currency ?? "RUB";

    if (input.product.price === undefined) {
      missingInputs.push(
        `Цена модели "${input.product.name}" отсутствует в каталоге — уточните у менеджера.`
      );
    }

    const components: PriceCalculation["components"] = [];
    for (const component of input.components ?? []) {
      const componentProduct = await this.catalog.getBySku(component.sku);
      if (!componentProduct || componentProduct.price === undefined) {
        missingInputs.push(
          `Не найдена цена компонента "${component.role ?? component.sku}" (артикул ${component.sku}) — уточните у менеджера.`
        );
        continue;
      }
      components.push({
        label: `${component.role ?? componentProduct.name} × ${component.quantity}`,
        amount: componentProduct.price * component.quantity,
      });
    }

    const doorQuantity = input.kit?.doorQuantity ?? 1;

    if (input.kit) {
      const groups = await this.productConfigurator.getComponentGroups(input.product.url);

      const frameGroup = groups.find((g) => /коробк/iu.test(g.role));
      let frameDepthMm: number | undefined;
      if (!frameGroup || frameGroup.options.length === 0) {
        missingInputs.push(
          `На странице модели "${input.product.name}" не нашлось вариантов коробки — уточните у менеджера.`
        );
      } else if (frameGroup.options.length > 1) {
        missingInputs.push(
          `Для коробки есть несколько вариантов (${frameGroup.options.map((o) => `${o.label}: ${o.price}`).join(", ")}) — уточните у клиента, какой нужен.`
        );
      } else {
        const [frame] = frameGroup.options;
        const frameQuantity = input.kit.frameQuantity * doorQuantity;
        frameDepthMm = parseDimensions(frame.label)?.[2];
        components.push({
          label: `Коробка: ${frame.label} × ${frameQuantity}`,
          amount: frame.price * frameQuantity,
        });
      }

      const casingGroup = groups.find((g) => /наличник/iu.test(g.role));
      const flatCasings = casingGroup?.options.filter((o) => FLAT_CASING_PATTERN.test(o.label)) ?? [];
      if (flatCasings.length === 0) {
        missingInputs.push(
          `На странице модели "${input.product.name}" не нашлось прямого наличника — уточните у менеджера, какой наличник использовать.`
        );
      } else {
        const casing = flatCasings.reduce((cheapest, o) => (o.price < cheapest.price ? o : cheapest));
        const casingQuantity = input.kit.casingQuantity * doorQuantity;
        components.push({
          label: `Наличник: ${casing.label} × ${casingQuantity}`,
          amount: casing.price * casingQuantity,
        });
      }

      if (input.kit.wallThicknessMm !== undefined) {
        if (frameDepthMm === undefined) {
          missingInputs.push(
            "Не удалось определить глубину коробки по её описанию, чтобы проверить, нужен ли добор — уточните у менеджера."
          );
        } else {
          const neededExtensionMm = input.kit.wallThicknessMm - frameDepthMm;
          if (neededExtensionMm > 0) {
            const jambGroup = groups.find((g) => /добор/iu.test(g.role));
            const jambOptions = (jambGroup?.options ?? [])
              .map((option) => ({ option, extensionMm: parseDimensions(option.label)?.[1] }))
              .filter((o): o is { option: KitComponentOption; extensionMm: number } => o.extensionMm !== undefined);

            if (jambOptions.length === 0) {
              missingInputs.push(
                `Стена (${input.kit.wallThicknessMm} мм) толще глубины коробки (${frameDepthMm} мм) — нужен добор минимум на ${neededExtensionMm} мм, но вариантов добора для этой модели не нашлось — уточните у менеджера.`
              );
            } else {
              const exact = jambOptions.find((o) => o.extensionMm === neededExtensionMm);
              const fitting = jambOptions
                .filter((o) => o.extensionMm >= neededExtensionMm)
                .sort((a, b) => a.extensionMm - b.extensionMm);
              const chosen = exact ?? fitting[0];

              if (!chosen) {
                missingInputs.push(
                  `Нужен добор минимум на ${neededExtensionMm} мм, но среди вариантов (${jambOptions.map((o) => `${o.option.label}: ${o.extensionMm} мм`).join(", ")}) нет подходящего — уточните у менеджера.`
                );
              } else {
                const jambQuantity = (input.kit.jambExtensionQuantity ?? input.kit.frameQuantity) * doorQuantity;
                components.push({
                  label: `Добор: ${chosen.option.label} × ${jambQuantity}`,
                  amount: chosen.option.price * jambQuantity,
                });
                if (!exact) {
                  missingInputs.push(
                    `Точного добора на ${neededExtensionMm} мм нет — взят ближайший больший вариант "${chosen.option.label}" (${chosen.extensionMm} мм), подтвердите у менеджера, что он подходит.`
                  );
                }
              }
            }
          }
        }
      }
    }

    let customSizeSurcharge: PriceCalculation["customSizeSurcharge"];
    if (input.customSize) {
      const rule = await this.servicePrices.getCustomSizeSurchargeRule();
      if (!rule) {
        missingInputs.push(
          "Правило доплаты за нестандартный размер не настроено — уточните у менеджера."
        );
      } else {
        const overWidth = Math.max(0, input.customSize.widthMm - rule.maxStandardWidthMm);
        const overHeight = Math.max(0, input.customSize.heightMm - rule.maxStandardHeightMm);
        const overCm = Math.ceil((overWidth + overHeight) / 10);
        if (overCm > 0) {
          customSizeSurcharge = {
            label: "Доплата за нестандартный размер",
            amount: overCm * rule.surchargePerCmOverStandard,
          };
        }
      }
    }

    const services: PriceCalculation["services"] = [];
    for (const serviceKey of input.services ?? []) {
      const price = await this.servicePrices.getServicePrice(serviceKey);
      if (price === null) {
        missingInputs.push(`Цена услуги "${serviceKey}" не настроена — уточните у менеджера.`);
        continue;
      }
      services.push({ label: serviceKey, amount: price });
    }

    const doorAmount = (input.product.price ?? 0) * doorQuantity;
    const total =
      doorAmount +
      components.reduce((sum, c) => sum + c.amount, 0) +
      (customSizeSurcharge?.amount ?? 0) +
      services.reduce((sum, s) => sum + s.amount, 0);

    const calculation: PriceCalculation = {
      currency,
      door: {
        label: doorQuantity > 1 ? `${input.product.name} × ${doorQuantity}` : input.product.name,
        amount: doorAmount,
      },
      components,
      customSizeSurcharge,
      services,
      total,
      missingInputs,
    };

    return {
      agent: this.name,
      payload: calculation,
      logs: [log(this.name, "calculate", `total=${total} missing=${missingInputs.length}`)],
      clarifyingQuestions: missingInputs.length > 0 ? missingInputs : undefined,
    };
  }
}

/**
 * Extracts the "AxBxC"-style millimeter dimensions from a configurator option
 * label (e.g. "Массив дерева 2080x75x40" -> [2080, 75, 40], "Телескопический
 * 2070x100x16" -> [2070, 100, 16]). Returns undefined when the label doesn't
 * match — callers must not guess a dimension that wasn't actually parsed.
 */
function parseDimensions(label: string): number[] | undefined {
  const match = /(\d+)\s*[x×]\s*(\d+)\s*[x×]\s*(\d+)/iu.exec(label);
  if (!match) return undefined;
  return [Number(match[1]), Number(match[2]), Number(match[3])];
}
