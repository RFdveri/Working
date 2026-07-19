/** Long-term customer memory the spec requires the assistant to retain across the dialog. */
export interface CustomerMemory {
  preferences: string[];
  sizes: {
    width?: number;
    height?: number;
    thickness?: number;
    openingType?: string;
  };
  budget?: {
    min?: number;
    max?: number;
    currency: string;
  };
  coverings: string[];
  selectedModels: string[];
  /** Ids of prior conversations/deals with this contact, oldest first. */
  historicalConversationIds: string[];
}

export function createEmptyMemory(): CustomerMemory {
  return {
    preferences: [],
    sizes: {},
    coverings: [],
    selectedModels: [],
    historicalConversationIds: [],
  };
}
