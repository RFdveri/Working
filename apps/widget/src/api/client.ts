import type {
  AgentLogEntry,
  AssistantMode,
  ChatTurnResult,
  ManagerTask,
  Message,
  PriceCalculation,
} from "@ai-door-assistant/shared";

export interface ConversationDto {
  id: string;
  dealId?: string;
  contactId?: string;
  mode: AssistantMode;
  managerActive: boolean;
  messages: Message[];
  logs: AgentLogEntry[];
}

const API_BASE = "/api";

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${API_BASE}${path}`, {
    ...init,
    headers: { "Content-Type": "application/json", ...init?.headers },
  });
  if (!response.ok) {
    const body = await response.json().catch(() => ({ error: response.statusText }));
    throw new Error(body.error ?? `Request failed: ${response.status}`);
  }
  return response.json() as Promise<T>;
}

export function createConversation(params: { dealId?: string; contactId?: string }) {
  return request<ConversationDto>("/conversations", {
    method: "POST",
    body: JSON.stringify(params),
  });
}

export function getConversation(id: string) {
  return request<ConversationDto>(`/conversations/${id}`);
}

export function setConversationMode(id: string, mode: AssistantMode) {
  return request<ConversationDto>(`/conversations/${id}/mode`, {
    method: "PATCH",
    body: JSON.stringify({ mode }),
  });
}

export function sendMessage(id: string, text: string, role: "customer" | "manager" = "customer") {
  return request<{ conversation: ConversationDto; result?: { payload?: ChatTurnResult } }>(
    `/conversations/${id}/messages`,
    { method: "POST", body: JSON.stringify({ role, text }) }
  );
}

export function createManagerTask(
  id: string,
  task: { type: ManagerTask["type"]; text: string; dueAt?: string }
) {
  return request<ManagerTask>(`/conversations/${id}/tasks`, {
    method: "POST",
    body: JSON.stringify(task),
  });
}

export function createSummary(id: string) {
  return request(`/conversations/${id}/summary`, { method: "POST" });
}

export interface CalculatePriceRequest {
  sku: string;
  customSize?: { widthMm: number; heightMm: number };
  services?: string[];
  components?: Array<{ sku: string; quantity: number; role?: string }>;
}

export function calculatePrice(id: string, body: CalculatePriceRequest) {
  return request<PriceCalculation>(`/conversations/${id}/price`, {
    method: "POST",
    body: JSON.stringify(body),
  });
}
