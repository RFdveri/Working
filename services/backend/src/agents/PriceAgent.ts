import type {
  Agent,
  AgentContext,
  AgentResult,
  PriceCalculation,
  Product,
} from "@ai-door-assistant/shared";
import type { CatalogClient } from "../integrations/catalog/CatalogClient.js";
import type { ServicePriceProvider } from "../integrations/pricing/ServicePriceProvider.js";
import { log } from "./support.js";

export interface PriceKitComponent {
  /** Catalog SKU of the component (e.g. a specific "коробка"/"наличник" offer). */
  sku: string;
  quantity: number;
  /** Human label for the line item, e.g. "Коробка" — defaults to the catalog product's name. */
  role?: string;
}

export interface PriceAgentInput {
  product: Product;
  customSize?: { widthMm: number; heightMm: number };
  services?: string[];
  /** Kit components (frame, casing, ...) priced from the catalog by SKU × quantity. */
  components?: PriceKitComponent[];
}

/**
 * Computes door + kit components + custom-size + services pricing. Asks a
 * clarifying question instead of guessing whenever an input it needs
 * (catalog price, a component SKU, surcharge rule, service price) is missing —
 * this includes refusing to pick a frame/casing SKU on the customer's behalf
 * when the request doesn't specify one.
 */
export class PriceAgent implements Agent<PriceAgentInput, PriceCalculation> {
  readonly name = "price" as const;

  constructor(
    private readonly catalog: CatalogClient,
    private readonly servicePrices: ServicePriceProvider
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

    const total =
      (input.product.price ?? 0) +
      components.reduce((sum, c) => sum + c.amount, 0) +
      (customSizeSurcharge?.amount ?? 0) +
      services.reduce((sum, s) => sum + s.amount, 0);

    const calculation: PriceCalculation = {
      currency,
      door: { label: input.product.name, amount: input.product.price ?? 0 },
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
