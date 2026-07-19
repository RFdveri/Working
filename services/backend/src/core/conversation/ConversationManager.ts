import { randomUUID } from "node:crypto";
import type {
  AgentLogEntry,
  AssistantMode,
  Message,
} from "@ai-door-assistant/shared";

export interface Conversation {
  id: string;
  dealId?: string;
  contactId?: string;
  mode: AssistantMode;
  managerActive: boolean;
  messages: Message[];
  logs: AgentLogEntry[];
}

/**
 * Holds live conversation state (messages, mode, manager-handoff flag, action log)
 * that the widget panel reads and the Director agent writes to on every turn.
 */
export class ConversationManager {
  private readonly conversations = new Map<string, Conversation>();

  findByDealId(dealId: string): Conversation | undefined {
    return [...this.conversations.values()].find((c) => c.dealId === dealId);
  }

  findOrCreateByDealId(params: { dealId: string; contactId?: string }): Conversation {
    return this.findByDealId(params.dealId) ?? this.create(params);
  }

  create(params: { dealId?: string; contactId?: string }): Conversation {
    const conversation: Conversation = {
      id: randomUUID(),
      dealId: params.dealId,
      contactId: params.contactId,
      mode: "auto",
      managerActive: false,
      messages: [],
      logs: [],
    };
    this.conversations.set(conversation.id, conversation);
    return conversation;
  }

  get(conversationId: string): Conversation | undefined {
    return this.conversations.get(conversationId);
  }

  requireConversation(conversationId: string): Conversation {
    const conversation = this.get(conversationId);
    if (!conversation) {
      throw new Error(`Unknown conversation: ${conversationId}`);
    }
    return conversation;
  }

  appendMessage(conversationId: string, message: Message): Conversation {
    const conversation = this.requireConversation(conversationId);
    conversation.messages.push(message);
    return conversation;
  }

  appendLogs(conversationId: string, logs: AgentLogEntry[]): Conversation {
    const conversation = this.requireConversation(conversationId);
    conversation.logs.push(...logs);
    return conversation;
  }

  setMode(conversationId: string, mode: AssistantMode): Conversation {
    const conversation = this.requireConversation(conversationId);
    conversation.mode = mode;
    return conversation;
  }

  /**
   * Once a human manager replies, the AI stops answering the customer per the spec's
   * handoff rule ("AI перестает отвечать клиенту") and switches to hints-only support.
   */
  markManagerActive(conversationId: string): Conversation {
    const conversation = this.requireConversation(conversationId);
    conversation.managerActive = true;
    conversation.mode = "hints-only";
    return conversation;
  }
}
