import "dotenv/config";

function optional(name: string): string | undefined {
  const value = process.env[name];
  return value && value.length > 0 ? value : undefined;
}

function required(name: string, fallback: string): string {
  return optional(name) ?? fallback;
}

export const env = {
  port: Number(optional("PORT") ?? 4000),
  nodeEnv: required("NODE_ENV", "development"),
  baseUrl: required("BASE_URL", "http://localhost:4000"),

  amocrm: {
    subdomain: optional("AMOCRM_SUBDOMAIN"),
    clientId: optional("AMOCRM_CLIENT_ID"),
    clientSecret: optional("AMOCRM_CLIENT_SECRET"),
    redirectUri: optional("AMOCRM_REDIRECT_URI"),
    accessToken: optional("AMOCRM_ACCESS_TOKEN"),
    refreshToken: optional("AMOCRM_REFRESH_TOKEN"),
  },

  catalog: {
    baseUrl: required("CATALOG_BASE_URL", "https://rf-dveri.ru"),
    apiKey: optional("CATALOG_API_KEY"),
  },

  llm: {
    provider: required("LLM_PROVIDER", "mock") as "mock" | "anthropic",
    anthropicApiKey: optional("ANTHROPIC_API_KEY"),
    anthropicModel: required("ANTHROPIC_MODEL", "claude-sonnet-5"),
  },

  stt: {
    provider: required("STT_PROVIDER", "mock"),
  },
  ocr: {
    provider: required("OCR_PROVIDER", "mock"),
  },

  telegram: {
    botToken: optional("TELEGRAM_BOT_TOKEN"),
  },
};

export function isAmoCrmConfigured(): boolean {
  return Boolean(
    env.amocrm.subdomain && env.amocrm.clientId && env.amocrm.clientSecret
  );
}
