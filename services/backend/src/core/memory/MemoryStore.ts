import type { DatabaseSync } from "node:sqlite";
import { createEmptyMemory, type CustomerMemory } from "@ai-door-assistant/shared";

/**
 * Persists what the spec calls "ПАМЯТЬ": preferences, sizes, budget, coverings,
 * conversation history references, selected models — keyed by contact.
 */
export interface MemoryStore {
  get(contactId: string): Promise<CustomerMemory>;
  update(
    contactId: string,
    patch: Partial<CustomerMemory>
  ): Promise<CustomerMemory>;
}

/** SQLite-backed store — survives process restarts. See `core/persistence/Database.ts`. */
export class SqliteMemoryStore implements MemoryStore {
  constructor(private readonly db: DatabaseSync) {}

  async get(contactId: string): Promise<CustomerMemory> {
    const row = this.db
      .prepare("SELECT data FROM customer_memory WHERE contact_id = ?")
      .get(contactId) as { data: string } | undefined;
    return row ? (JSON.parse(row.data) as CustomerMemory) : createEmptyMemory();
  }

  async update(
    contactId: string,
    patch: Partial<CustomerMemory>
  ): Promise<CustomerMemory> {
    const current = await this.get(contactId);
    const merged: CustomerMemory = {
      ...current,
      ...patch,
      preferences: mergeUnique(current.preferences, patch.preferences),
      coverings: mergeUnique(current.coverings, patch.coverings),
      selectedModels: mergeUnique(current.selectedModels, patch.selectedModels),
      historicalConversationIds: mergeUnique(
        current.historicalConversationIds,
        patch.historicalConversationIds
      ),
      sizes: { ...current.sizes, ...patch.sizes },
      budget: patch.budget ?? current.budget,
    };
    this.db
      .prepare(
        `INSERT INTO customer_memory (contact_id, data) VALUES (?, ?)
         ON CONFLICT (contact_id) DO UPDATE SET data = excluded.data`
      )
      .run(contactId, JSON.stringify(merged));
    return merged;
  }
}

function mergeUnique(a: string[], b?: string[]): string[] {
  if (!b || b.length === 0) return a;
  return Array.from(new Set([...a, ...b]));
}
