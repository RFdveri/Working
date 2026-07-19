export interface CustomSizeSurchargeRule {
  maxStandardWidthMm: number;
  maxStandardHeightMm: number;
  surchargePerCmOverStandard: number;
}

/**
 * Source of truth for prices that are not part of the product record itself
 * (installation, measurement, custom-size surcharges, ...). Kept separate from
 * fabricated numbers on purpose — until this is wired to a real price list,
 * every lookup returns null and the Price Agent must ask the customer/manager
 * instead of guessing, per the spec's "не выдумывать цены" rule.
 */
export interface ServicePriceProvider {
  getServicePrice(serviceKey: string): Promise<number | null>;
  getCustomSizeSurchargeRule(): Promise<CustomSizeSurchargeRule | null>;
}

/**
 * Reads prices from a JSON file (config/service-prices.json) maintained by
 * sales ops. Replace with a real pricing API/DB-backed implementation once
 * one exists — callers only depend on the ServicePriceProvider interface.
 */
export class JsonServicePriceProvider implements ServicePriceProvider {
  constructor(
    private readonly prices: Record<string, number>,
    private readonly customSizeRule: CustomSizeSurchargeRule | null
  ) {}

  async getServicePrice(serviceKey: string): Promise<number | null> {
    return this.prices[serviceKey] ?? null;
  }

  async getCustomSizeSurchargeRule(): Promise<CustomSizeSurchargeRule | null> {
    return this.customSizeRule;
  }
}
