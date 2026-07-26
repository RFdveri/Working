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
  /** Raw covering text from the source feed when it doesn't map to a known CoveringMaterial. */
  coveringRaw?: string;
  material?: string;
  color?: string;
  width?: number;
  height?: number;
  thickness?: number;
  weightKg?: number;
  openingType?: string;
  soundproofing?: string;
  fireRating?: string;
  /** Manufacturer/factory group as given by the feed (e.g. "Ульяновские", "Белорусские"). */
  vendorGroup?: string;
  /** Catalog category name(s) the offer is listed under (leaf, and full parent path). */
  categoryName?: string;
  categoryPath?: string[];
  /** Free-text installation recommendation from the feed ("в квартиру", "для ванны и туалета", ...). */
  installation?: string;
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
