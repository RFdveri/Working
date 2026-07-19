import { randomUUID } from "node:crypto";
import type { Agent, AgentContext, AgentResult, ManagerTask, ManagerTaskDraft } from "@ai-door-assistant/shared";
import type { AmoCrmClient } from "../integrations/amocrm/AmoCrmClient.js";
import { log } from "./support.js";

const AMOCRM_TASK_TYPE_MAP: Record<ManagerTaskDraft["type"], number | undefined> = {
  "call-back": 1,
  "prepare-quote": undefined,
  "check-availability": undefined,
  "schedule-measurement": undefined,
  "negotiate-discount": undefined,
  other: undefined,
};

/** Creates manager tasks (call back, prepare quote, check availability, schedule measurement, negotiate discount, ...). */
export class TaskAgent implements Agent<ManagerTaskDraft, ManagerTask> {
  readonly name = "task" as const;

  constructor(private readonly amoCrm: AmoCrmClient | null) {}

  async handle(
    context: AgentContext,
    input: ManagerTaskDraft
  ): Promise<AgentResult<ManagerTask>> {
    const dealId = input.dealId ?? context.dealId;
    const dueAt = input.dueAt ?? new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();

    if (this.amoCrm && dealId) {
      await this.amoCrm.createTask({
        dealId: Number(dealId),
        text: input.text,
        completeTill: dueAt,
        taskTypeId: AMOCRM_TASK_TYPE_MAP[input.type],
      });
    }

    const task: ManagerTask = {
      id: randomUUID(),
      type: input.type,
      text: input.text,
      dueAt,
      dealId,
      createdAt: new Date().toISOString(),
      status: "open",
    };

    return {
      agent: this.name,
      payload: task,
      logs: [
        log(
          this.name,
          "create-task",
          `${input.type}: ${input.text}${this.amoCrm ? "" : " (AmoCRM не настроен — задача только локально)"}`
        ),
      ],
    };
  }
}
