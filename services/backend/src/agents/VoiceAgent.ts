import type { Agent, AgentContext, AgentResult } from "@ai-door-assistant/shared";
import type { SttProvider } from "../integrations/stt/SttProvider.js";
import { log } from "./support.js";

export interface VoiceAgentInput {
  audioUrl: string;
}

/** Transcribes voice messages so the rest of the pipeline can use them as plain text. */
export class VoiceAgent implements Agent<VoiceAgentInput, string> {
  readonly name = "voice" as const;

  constructor(private readonly stt: SttProvider) {}

  async handle(
    _context: AgentContext,
    input: VoiceAgentInput
  ): Promise<AgentResult<string>> {
    const transcript = await this.stt.transcribe(input.audioUrl);

    return {
      agent: this.name,
      payload: transcript,
      logs: [log(this.name, "transcribe", input.audioUrl)],
    };
  }
}
