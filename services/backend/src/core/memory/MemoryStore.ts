import { createEmptyMemory, type CustomerMemory } from "@ai-door-assistant/shared";

/**
 * Persists what the spec calls "ПАМЯТЬ": preferences, sizes, budget, coverings,
 * conversation history references, selected models — keyed by contact.
 * Swap the in-memory implementation for a Postgres/Redis-backed one in production;
 * the interface is the contract agents and routes depend on.
 */
export interface MemoryStore {
  get(contactId: string): Promise<CustomerMemory>;
  update(
    contactId: string,
    patch: Partial<CustomerMemory>
  ): Promise<CustomerMemory>;
}

export class InMemoryMemoryStore implements MemoryStore {
  private readonly memories = new Map<string, CustomerMemory>();

  async get(contactId: string): Promise<CustomerMemory> {
    return this.memories.get(contactId) ?? createEmptyMemory();
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
    this.memories.set(contactId, merged);
    return merged;
  }
}

function mergeUnique(a: string[], b?: string[]): string[] {
  if (!b || b.length === 0) return a;
  return Array.from(new Set([...a, ...b]));
}
