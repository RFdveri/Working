import type { Message } from "./conversation.js";
import type { CustomerMemory } from "./memory.js";

/** The 12 agents described in the project specification. */
export type AgentName =
  | "director"
  | "crm"
  | "product"
  | "search"
  | "price"
  | "materialExpert"
  | "humanSales"
  | "vision"
  | "document"
  | "voice"
  | "task"
  | "summary";

/** Widget operating modes (Автоматический / Полуавтоматический / Только подсказки / Выключен). */
export type AssistantMode = "auto" | "semi-auto" | "hints-only" | "off";

export interface AgentLogEntry {
  id: string;
  timestamp: string;
  agent: AgentName;
  action: string;
  detail?: string;
  /** True when the agent had to stop and ask a clarifying question instead of guessing. */
  clarificationNeeded?: boolean;
}

/**
 * Context passed to every agent invocation. Agents must treat this as read-only input
 * and return changes via AgentResult rather than mutating it directly.
 */
export interface AgentContext {
  conversationId: string;
  dealId?: string;
  contactId?: string;
  mode: AssistantMode;
  /** Once a human manager has replied, the Director stops the AI from answering the customer. */
  managerActive: boolean;
  memory: CustomerMemory;
  history: Message[];
}

export interface AgentResult<TPayload = unknown> {
  agent: AgentName;
  /** Free-form textual output meant for the customer or the manager, depending on mode. */
  reply?: string;
  payload?: TPayload;
  logs: AgentLogEntry[];
  /** Set when the agent lacks the data it needs and must not guess (prices, dates, stock, specs). */
  clarifyingQuestions?: string[];
  managerTasks?: ManagerTaskDraft[];
}

export interface Agent<TInput = unknown, TPayload = unknown> {
  readonly name: AgentName;
  handle(context: AgentContext, input: TInput): Promise<AgentResult<TPayload>>;
}

export interface ManagerTaskDraft {
  type:
    | "call-back"
    | "prepare-quote"
    | "check-availability"
    | "schedule-measurement"
    | "negotiate-discount"
    | "other";
  text: string;
  dueAt?: string;
  dealId?: string;
}
