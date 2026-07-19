import type { Product, ProductSearchQuery } from "@ai-door-assistant/shared";

export interface CatalogClient {
  search(query: ProductSearchQuery): Promise<Product[]>;
  getBySku(sku: string): Promise<Product | null>;
  getById(id: string): Promise<Product | null>;
}
