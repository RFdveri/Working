import { env, isAmoCrmConfigured } from "../../config/env.js";
import { AmoCrmClient } from "./AmoCrmClient.js";

export { AmoCrmClient } from "./AmoCrmClient.js";
export type { AmoCrmConfig } from "./AmoCrmClient.js";

export function createAmoCrmClient(): AmoCrmClient | null {
  if (!isAmoCrmConfigured()) return null;
  const client = new AmoCrmClient({
    subdomain: env.amocrm.subdomain!,
    clientId: env.amocrm.clientId!,
    clientSecret: env.amocrm.clientSecret!,
    redirectUri: env.amocrm.redirectUri ?? `${env.baseUrl}/api/amocrm/oauth/callback`,
  });
  if (env.amocrm.accessToken && env.amocrm.refreshToken) {
    client.setTokens({
      accessToken: env.amocrm.accessToken,
      refreshToken: env.amocrm.refreshToken,
      expiresAt: Date.now() + 60_000,
    });
  }
  return client;
}
