export interface PriceLineItem {
  label: string;
  amount: number;
}

export interface PriceCalculation {
  currency: string;
  door: PriceLineItem;
  components: PriceLineItem[];
  customSizeSurcharge?: PriceLineItem;
  services: PriceLineItem[];
  total: number;
  /** Non-empty when the Price Agent could not compute a full total and must ask the customer. */
  missingInputs: string[];
}
