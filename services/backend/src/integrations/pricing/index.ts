import servicePricesRaw from "../../config/service-prices.json" with { type: "json" };
import {
  JsonServicePriceProvider,
  type CustomSizeSurchargeRule,
  type ServicePriceProvider,
} from "./ServicePriceProvider.js";

export type { ServicePriceProvider, CustomSizeSurchargeRule } from "./ServicePriceProvider.js";

interface ServicePricesFile {
  prices: Record<string, number | null>;
  customSizeSurchargeRule: CustomSizeSurchargeRule | null;
}

export function createServicePriceProvider(): ServicePriceProvider {
  const file = servicePricesRaw as unknown as ServicePricesFile;
  const prices: Record<string, number> = {};
  for (const [key, value] of Object.entries(file.prices)) {
    if (typeof value === "number") prices[key] = value;
  }
  return new JsonServicePriceProvider(prices, file.customSizeSurchargeRule ?? null);
}
