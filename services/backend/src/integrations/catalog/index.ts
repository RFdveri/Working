import { env } from "../../config/env.js";
import { RfDveriCatalogClient } from "./RfDveriCatalogClient.js";
import type { CatalogClient } from "./CatalogClient.js";

export type { CatalogClient } from "./CatalogClient.js";

export function createCatalogClient(): CatalogClient {
  return new RfDveriCatalogClient(env.catalog.baseUrl, env.catalog.apiKey);
}
