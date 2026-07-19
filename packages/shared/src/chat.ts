import type { FocusProductRef } from "./agents.js";
import type { PriceCalculation } from "./pricing.js";
import type { Product } from "./product.js";

/** Wire-level shape of a Director turn result, shared by the backend response and the widget UI. */
export interface ChatTurnResult {
  reply?: string;
  foundProducts: Product[];
  priceCalculation?: PriceCalculation;
  /** The product this turn anchored the conversation to — persisted for the next turn. */
  focusProduct?: FocusProductRef;
}
