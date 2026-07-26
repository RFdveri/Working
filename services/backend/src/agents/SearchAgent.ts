import type {
  Agent,
  AgentContext,
  AgentResult,
  Product,
  ProductSearchQuery,
} from "@ai-door-assistant/shared";
import type { CatalogClient } from "../integrations/catalog/CatalogClient.js";
import { log } from "./support.js";

/** Searches the catalog by name, article, collection, characteristics, or similarity. */
export class SearchAgent implements Agent<ProductSearchQuery, Product[]> {
  readonly name = "search" as const;

  constructor(private readonly catalog: CatalogClient) {}

  async handle(
    _context: AgentContext,
    input: ProductSearchQuery
  ): Promise<AgentResult<Product[]>> {
    const results = await this.catalog.search(input);

    if (results.length === 0) {
      return {
        agent: this.name,
        payload: [],
        logs: [log(this.name, "search-empty", JSON.stringify(input))],
        clarifyingQuestions: [
          "Ничего не нашёл по этому запросу. Уточните артикул, коллекцию или характеристики двери?",
        ],
      };
    }

    return {
      agent: this.name,
      payload: results,
      logs: [log(this.name, "search", `${results.length} товар(ов) по запросу ${JSON.stringify(input)}`)],
    };
  }
}
