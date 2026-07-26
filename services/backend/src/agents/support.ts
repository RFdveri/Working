import { randomUUID } from "node:crypto";
import type { AgentLogEntry, AgentName } from "@ai-door-assistant/shared";

export function log(
  agent: AgentName,
  action: string,
  detail?: string,
  clarificationNeeded?: boolean
): AgentLogEntry {
  return {
    id: randomUUID(),
    timestamp: new Date().toISOString(),
    agent,
    action,
    detail,
    clarificationNeeded,
  };
}
