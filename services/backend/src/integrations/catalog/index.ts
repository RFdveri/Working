import { RfDveriYmlCatalogClient } from "./RfDveriYmlCatalogClient.js";
import { RfDveriProductConfiguratorClient } from "./RfDveriProductConfiguratorClient.js";
import { env } from "../../config/env.js";
import type { CatalogClient } from "./CatalogClient.js";
import type { ProductConfiguratorClient } from "./ProductConfiguratorClient.js";

export type { CatalogClient } from "./CatalogClient.js";
export type { ProductConfiguratorClient, KitComponentGroup, KitComponentOption } from "./ProductConfiguratorClient.js";

export function createCatalogClient(): CatalogClient {
  return new RfDveriYmlCatalogClient(env.catalog.feedUrl, env.catalog.feedTtlMs);
}

export function createProductConfiguratorClient(): ProductConfiguratorClient {
  return new RfDveriProductConfiguratorClient();
}
