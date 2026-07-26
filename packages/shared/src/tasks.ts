import type { ManagerTaskDraft } from "./agents.js";

export interface ManagerTask extends ManagerTaskDraft {
  id: string;
  createdAt: string;
  status: "open" | "done" | "cancelled";
}

export interface DialogSummary {
  conversationId: string;
  dealId?: string;
  interests: string[];
  recommendations: string[];
  preliminaryCalculationTotal?: number;
  notes: string;
  createdAt: string;
}
