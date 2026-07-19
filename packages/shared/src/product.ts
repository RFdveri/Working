export type CoveringMaterial =
  | "enamel"
  | "eco-veneer"
  | "pvc"
  | "solid-wood"
  | "natural-veneer"
  | "polypropylene"
  | "laminate"
  | "other";

export interface ProductCharacteristics {
  collection?: string;
  covering?: CoveringMaterial;
  color?: string;
  width?: number;
  height?: number;
  thickness?: number;
  openingType?: string;
  soundproofing?: string;
  fireRating?: string;
  [key: string]: unknown;
}

/**
 * A product as found in the rf-dveri.ru catalog. Every field here must come from the
 * catalog client — agents must never invent characteristics, prices, or availability.
 */
export interface Product {
  id: string;
  sku: string;
  name: string;
  characteristics: ProductCharacteristics;
  price?: number;
  currency?: string;
  availability?: "in-stock" | "on-order" | "unavailable" | "unknown";
  url: string;
  images: string[];
}

export interface ProductSearchQuery {
  text?: string;
  sku?: string;
  collection?: string;
  characteristics?: Partial<ProductCharacteristics>;
  similarToProductId?: string;
}
