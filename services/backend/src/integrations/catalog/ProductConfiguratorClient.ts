export interface KitComponentOption {
  /** e.g. "Массив дерева 2080x75x40" — the part after "Коробка: " / "Наличник: " in the source label. */
  label: string;
  price: number;
}

export interface KitComponentGroup {
  /** Raw role from the page, e.g. "Коробка", "Наличник", "Добор", "Плинтус". */
  role: string;
  options: KitComponentOption[];
}

/**
 * Reads the frame/casing/jamb-extension/skirting options offered on a specific
 * door's own product page. Unlike the base catalog (YML feed), these prices are
 * NOT exposed as separate feed offers — they only exist as this product's own
 * configurator options, so they must be read per-door, not searched generically.
 */
export interface ProductConfiguratorClient {
  getComponentGroups(productUrl: string): Promise<KitComponentGroup[]>;
}
