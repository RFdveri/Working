import type { Agent, AgentContext, AgentResult, AmoContact, AmoDeal } from "@ai-door-assistant/shared";
import type { AmoCrmClient } from "../integrations/amocrm/AmoCrmClient.js";
import { log } from "./support.js";

export type CrmAgentInput =
  | { op: "get-deal"; dealId: number }
  | { op: "update-status"; dealId: number; statusId: number }
  | { op: "get-contact"; contactId: number }
  | { op: "add-note"; dealId: number; text: string }
  | { op: "send-message"; dealId: number; text: string; channelId: string };

export type CrmAgentPayload = AmoDeal | AmoContact | { sent: true } | undefined;

/** All AmoCRM read/write operations for deals, contacts, notes, Digital Pipeline messages, and statuses. */
export class CrmAgent implements Agent<CrmAgentInput, CrmAgentPayload> {
  readonly name = "crm" as const;

  constructor(private readonly amoCrm: AmoCrmClient | null) {}

  async handle(
    _context: AgentContext,
    input: CrmAgentInput
  ): Promise<AgentResult<CrmAgentPayload>> {
    if (!this.amoCrm) {
      return {
        agent: this.name,
        logs: [log(this.name, "not-configured", input.op)],
        clarifyingQuestions: [
          "AmoCRM не подключён — настройте AMOCRM_CLIENT_ID/SECRET и пройдите OAuth, чтобы включить CRM-операции.",
        ],
      };
    }

    switch (input.op) {
      case "get-deal": {
        const deal = await this.amoCrm.getDeal(input.dealId);
        return { agent: this.name, payload: deal, logs: [log(this.name, "get-deal", String(input.dealId))] };
      }
      case "update-status": {
        await this.amoCrm.updateDealStatus(input.dealId, input.statusId);
        return {
          agent: this.name,
          logs: [log(this.name, "update-status", `deal=${input.dealId} status=${input.statusId}`)],
        };
      }
      case "get-contact": {
        const contact = await this.amoCrm.getContact(input.contactId);
        return {
          agent: this.name,
          payload: contact,
          logs: [log(this.name, "get-contact", String(input.contactId))],
        };
      }
      case "add-note": {
        await this.amoCrm.addNote({ dealId: input.dealId, text: input.text, createdAt: new Date().toISOString() });
        return { agent: this.name, logs: [log(this.name, "add-note", `deal=${input.dealId}`)] };
      }
      case "send-message": {
        await this.amoCrm.sendDigitalPipelineMessage(input.dealId, input.text, input.channelId);
        return {
          agent: this.name,
          payload: { sent: true },
          logs: [log(this.name, "send-message", `deal=${input.dealId}`)],
        };
      }
    }
  }
}
