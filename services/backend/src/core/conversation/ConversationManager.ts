import { randomUUID } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import type {
  AgentLogEntry,
  AssistantMode,
  FocusProductRef,
  Message,
  OrderSpec,
} from "@ai-door-assistant/shared";

export interface Conversation {
  id: string;
  dealId?: string;
  contactId?: string;
  mode: AssistantMode;
  managerActive: boolean;
  messages: Message[];
  logs: AgentLogEntry[];
  focusProduct?: FocusProductRef;
  orderSpec?: OrderSpec;
}

interface ConversationRow {
  id: string;
  deal_id: string | null;
  contact_id: string | null;
  mode: string;
  manager_active: number;
  focus_product: string | null;
  order_spec: string | null;
}

interface MessageRow {
  role: string;
  text: string;
  attachments: string | null;
  timestamp: string;
  id: string;
}

interface LogRow {
  entry: string;
}

/**
 * Holds conversation state (messages, mode, manager-handoff flag, action log)
 * that the widget panel reads and the Director agent writes to on every turn.
 * Backed by SQLite so state survives process restarts/redeploys — see
 * `core/persistence/Database.ts`.
 */
export class ConversationManager {
  constructor(private readonly db: DatabaseSync) {}

  findByDealId(dealId: string): Conversation | undefined {
    const row = this.db
      .prepare("SELECT * FROM conversations WHERE deal_id = ?")
      .get(dealId) as ConversationRow | undefined;
    return row ? this.hydrate(row) : undefined;
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
    this.db
      .prepare(
        `INSERT INTO conversations (id, deal_id, contact_id, mode, manager_active, focus_product, order_spec)
         VALUES (?, ?, ?, ?, ?, NULL, NULL)`
      )
      .run(
        conversation.id,
        conversation.dealId ?? null,
        conversation.contactId ?? null,
        conversation.mode,
        0
      );
    return conversation;
  }

  get(conversationId: string): Conversation | undefined {
    const row = this.db
      .prepare("SELECT * FROM conversations WHERE id = ?")
      .get(conversationId) as ConversationRow | undefined;
    return row ? this.hydrate(row) : undefined;
  }

  requireConversation(conversationId: string): Conversation {
    const conversation = this.get(conversationId);
    if (!conversation) {
      throw new Error(`Unknown conversation: ${conversationId}`);
    }
    return conversation;
  }

  appendMessage(conversationId: string, message: Message): Conversation {
    this.requireConversation(conversationId);
    const seq = this.nextMessageSeq(conversationId);
    this.db
      .prepare(
        `INSERT INTO messages (id, conversation_id, seq, role, text, attachments, timestamp)
         VALUES (?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        message.id,
        conversationId,
        seq,
        message.role,
        message.text,
        message.attachments ? JSON.stringify(message.attachments) : null,
        message.timestamp
      );
    return this.requireConversation(conversationId);
  }

  appendLogs(conversationId: string, logs: AgentLogEntry[]): Conversation {
    this.requireConversation(conversationId);
    if (logs.length > 0) {
      const seq = this.nextLogSeq(conversationId);
      const insert = this.db.prepare(
        "INSERT INTO agent_logs (conversation_id, seq, entry) VALUES (?, ?, ?)"
      );
      logs.forEach((log, index) => {
        insert.run(conversationId, seq + index, JSON.stringify(log));
      });
    }
    return this.requireConversation(conversationId);
  }

  setMode(conversationId: string, mode: AssistantMode): Conversation {
    this.requireConversation(conversationId);
    this.db.prepare("UPDATE conversations SET mode = ? WHERE id = ?").run(mode, conversationId);
    return this.requireConversation(conversationId);
  }

  /**
   * Once a human manager replies, the AI stops answering the customer per the spec's
   * handoff rule ("AI перестает отвечать клиенту") and switches to hints-only support.
   */
  markManagerActive(conversationId: string): Conversation {
    this.requireConversation(conversationId);
    this.db
      .prepare("UPDATE conversations SET manager_active = 1, mode = 'hints-only' WHERE id = ?")
      .run(conversationId);
    return this.requireConversation(conversationId);
  }

  setFocusProduct(conversationId: string, focusProduct: FocusProductRef): Conversation {
    this.requireConversation(conversationId);
    this.db
      .prepare("UPDATE conversations SET focus_product = ? WHERE id = ?")
      .run(JSON.stringify(focusProduct), conversationId);
    return this.requireConversation(conversationId);
  }

  setOrderSpec(conversationId: string, orderSpec: OrderSpec): Conversation {
    this.requireConversation(conversationId);
    this.db
      .prepare("UPDATE conversations SET order_spec = ? WHERE id = ?")
      .run(JSON.stringify(orderSpec), conversationId);
    return this.requireConversation(conversationId);
  }

  private nextMessageSeq(conversationId: string): number {
    const row = this.db
      .prepare("SELECT COALESCE(MAX(seq), -1) AS maxSeq FROM messages WHERE conversation_id = ?")
      .get(conversationId) as { maxSeq: number };
    return row.maxSeq + 1;
  }

  private nextLogSeq(conversationId: string): number {
    const row = this.db
      .prepare("SELECT COALESCE(MAX(seq), -1) AS maxSeq FROM agent_logs WHERE conversation_id = ?")
      .get(conversationId) as { maxSeq: number };
    return row.maxSeq + 1;
  }

  private hydrate(row: ConversationRow): Conversation {
    const messages = this.db
      .prepare("SELECT id, role, text, attachments, timestamp FROM messages WHERE conversation_id = ? ORDER BY seq ASC")
      .all(row.id) as unknown as MessageRow[];
    const logs = this.db
      .prepare("SELECT entry FROM agent_logs WHERE conversation_id = ? ORDER BY seq ASC")
      .all(row.id) as unknown as LogRow[];

    return {
      id: row.id,
      dealId: row.deal_id ?? undefined,
      contactId: row.contact_id ?? undefined,
      mode: row.mode as AssistantMode,
      managerActive: row.manager_active === 1,
      focusProduct: row.focus_product ? (JSON.parse(row.focus_product) as FocusProductRef) : undefined,
      orderSpec: row.order_spec ? (JSON.parse(row.order_spec) as OrderSpec) : undefined,
      messages: messages.map((m) => ({
        id: m.id,
        role: m.role as Message["role"],
        text: m.text,
        attachments: m.attachments ? JSON.parse(m.attachments) : undefined,
        timestamp: m.timestamp,
      })),
      logs: logs.map((l) => JSON.parse(l.entry) as AgentLogEntry),
    };
  }
}
