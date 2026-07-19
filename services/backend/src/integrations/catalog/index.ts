import { env } from "../../config/env.js";
import { RfDveriYmlCatalogClient } from "./RfDveriYmlCatalogClient.js";
import type { CatalogClient } from "./CatalogClient.js";

export type { CatalogClient } from "./CatalogClient.js";

export function createCatalogClient(): CatalogClient {
  return new RfDveriYmlCatalogClient(env.catalog.feedUrl, env.catalog.feedTtlMs);
}
