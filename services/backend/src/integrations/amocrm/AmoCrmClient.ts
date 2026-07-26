import type {
  AmoContact,
  AmoDeal,
  AmoNote,
  AmoOAuthTokens,
  AmoTask,
} from "@ai-door-assistant/shared";

export interface AmoCrmConfig {
  subdomain: string;
  clientId: string;
  clientSecret: string;
  redirectUri: string;
}

/**
 * Thin wrapper over the official AmoCRM REST API (https://www.amocrm.ru/developers/content/crm_platform/api-reference).
 * Handles OAuth token exchange/refresh and the CRUD calls the agents need:
 * deals, contacts, notes, tasks, and Digital Pipeline messages.
 */
export class AmoCrmClient {
  private tokens?: AmoOAuthTokens;

  constructor(private readonly config: AmoCrmConfig) {}

  get baseUrl(): string {
    return `https://${this.config.subdomain}.amocrm.ru`;
  }

  setTokens(tokens: AmoOAuthTokens): void {
    this.tokens = tokens;
  }

  getTokens(): AmoOAuthTokens | undefined {
    return this.tokens;
  }

  /** Step one of the AmoCRM OAuth flow: exchange the authorization code for tokens. */
  async exchangeAuthorizationCode(code: string): Promise<AmoOAuthTokens> {
    return this.requestTokens({
      grant_type: "authorization_code",
      client_id: this.config.clientId,
      client_secret: this.config.clientSecret,
      code,
      redirect_uri: this.config.redirectUri,
    });
  }

  async refreshAccessToken(): Promise<AmoOAuthTokens> {
    if (!this.tokens?.refreshToken) {
      throw new Error("No refresh token available to refresh AmoCRM access token");
    }
    return this.requestTokens({
      grant_type: "refresh_token",
      client_id: this.config.clientId,
      client_secret: this.config.clientSecret,
      refresh_token: this.tokens.refreshToken,
      redirect_uri: this.config.redirectUri,
    });
  }

  private async requestTokens(body: Record<string, string>): Promise<AmoOAuthTokens> {
    const response = await fetch(`${this.baseUrl}/oauth2/access_token`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!response.ok) {
      throw new Error(`AmoCRM OAuth request failed: ${response.status}`);
    }
    const json = (await response.json()) as {
      access_token: string;
      refresh_token: string;
      expires_in: number;
    };
    const tokens: AmoOAuthTokens = {
      accessToken: json.access_token,
      refreshToken: json.refresh_token,
      expiresAt: Date.now() + json.expires_in * 1000,
    };
    this.tokens = tokens;
    return tokens;
  }

  private async ensureFreshToken(): Promise<void> {
    if (!this.tokens) {
      throw new Error("AmoCRM client is not authenticated yet — run the OAuth flow first");
    }
    if (this.tokens.expiresAt - Date.now() < 60_000) {
      await this.refreshAccessToken();
    }
  }

  private async request<T>(path: string, init: RequestInit = {}): Promise<T> {
    await this.ensureFreshToken();
    const response = await fetch(`${this.baseUrl}${path}`, {
      ...init,
      headers: {
        Authorization: `Bearer ${this.tokens!.accessToken}`,
        "Content-Type": "application/json",
        ...init.headers,
      },
    });
    if (!response.ok) {
      throw new Error(`AmoCRM API ${path} failed: ${response.status} ${await response.text()}`);
    }
    if (response.status === 204) return undefined as T;
    return (await response.json()) as T;
  }

  async getDeal(dealId: number): Promise<AmoDeal> {
    const raw = await this.request<{
      id: number;
      name: string;
      pipeline_id: number;
      status_id: number;
      price?: number;
      _embedded?: { contacts?: { id: number }[] };
    }>(`/api/v4/leads/${dealId}`);
    return {
      id: raw.id,
      name: raw.name,
      pipelineId: raw.pipeline_id,
      statusId: raw.status_id,
      price: raw.price,
      contactId: raw._embedded?.contacts?.[0]?.id,
    };
  }

  async updateDealStatus(dealId: number, statusId: number): Promise<void> {
    await this.request(`/api/v4/leads/${dealId}`, {
      method: "PATCH",
      body: JSON.stringify({ status_id: statusId }),
    });
  }

  async getContact(contactId: number): Promise<AmoContact> {
    const raw = await this.request<{
      id: number;
      name: string;
      custom_fields_values?: { field_code: string; values: { value: string }[] }[];
    }>(`/api/v4/contacts/${contactId}`);
    const phones =
      raw.custom_fields_values
        ?.filter((f) => f.field_code === "PHONE")
        .flatMap((f) => f.values.map((v) => v.value)) ?? [];
    const emails =
      raw.custom_fields_values
        ?.filter((f) => f.field_code === "EMAIL")
        .flatMap((f) => f.values.map((v) => v.value)) ?? [];
    return { id: raw.id, name: raw.name, phones, emails };
  }

  async addNote(note: AmoNote): Promise<void> {
    await this.request(`/api/v4/leads/${note.dealId}/notes`, {
      method: "POST",
      body: JSON.stringify([
        {
          note_type: "common",
          params: { text: note.text },
        },
      ]),
    });
  }

  async createTask(task: AmoTask): Promise<AmoTask> {
    const raw = await this.request<{ _embedded: { tasks: { id: number }[] } }>(
      "/api/v4/tasks",
      {
        method: "POST",
        body: JSON.stringify([
          {
            entity_id: task.dealId,
            entity_type: "leads",
            text: task.text,
            complete_till: Math.floor(new Date(task.completeTill).getTime() / 1000),
            task_type_id: task.taskTypeId,
          },
        ]),
      }
    );
    return { ...task, id: raw._embedded.tasks[0]?.id };
  }

  /**
   * Sends an outbound message on the Digital Pipeline / chat channel bound to a deal.
   * The exact channel wiring (salesbot, WhatsApp, Telegram, widget chat) depends on the
   * integration registered in the AmoCRM account and must match its channel_id.
   */
  async sendDigitalPipelineMessage(dealId: number, text: string, channelId: string): Promise<void> {
    await this.request(`/api/v4/leads/${dealId}/messages`, {
      method: "POST",
      body: JSON.stringify({ channel_id: channelId, text }),
    });
  }
}
