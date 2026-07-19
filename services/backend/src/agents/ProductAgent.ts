import type {
  Agent,
  AgentContext,
  AgentResult,
  Product,
} from "@ai-door-assistant/shared";
import type { CatalogClient } from "../integrations/catalog/CatalogClient.js";
import { log } from "./support.js";

export interface ProductAgentInput {
  productId?: string;
  sku?: string;
}

/**
 * Looks up authoritative product data from the rf-dveri.ru catalog.
 * Never fabricates characteristics, price, or availability — if the catalog
 * doesn't have the field, it is left undefined and the caller must ask the customer.
 */
export class ProductAgent implements Agent<ProductAgentInput, Product | null> {
  readonly name = "product" as const;

  constructor(private readonly catalog: CatalogClient) {}

  async handle(
    _context: AgentContext,
    input: ProductAgentInput
  ): Promise<AgentResult<Product | null>> {
    const product = input.sku
      ? await this.catalog.getBySku(input.sku)
      : input.productId
        ? await this.catalog.getById(input.productId)
        : null;

    if (!product) {
      return {
        agent: this.name,
        payload: null,
        logs: [log(this.name, "lookup-miss", JSON.stringify(input))],
        clarifyingQuestions: [
          "Уточните, пожалуйста, артикул или название модели двери — не нашёл её в каталоге.",
        ],
      };
    }

    return {
      agent: this.name,
      payload: product,
      logs: [log(this.name, "lookup", `${product.sku} — ${product.name}`)],
    };
  }
}
