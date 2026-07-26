import type { Agent, AgentContext, AgentResult, AttachmentKind } from "@ai-door-assistant/shared";
import type { OcrProvider } from "../integrations/ocr/OcrProvider.js";
import { log } from "./support.js";

export interface DocumentAgentInput {
  fileUrl: string;
  kind: AttachmentKind;
  mimeType: string;
}

/** Extracts text/data from PDFs, Word/Excel files, drawings (DWG), and scanned images. */
export class DocumentAgent implements Agent<DocumentAgentInput, string> {
  readonly name = "document" as const;

  constructor(private readonly ocr: OcrProvider) {}

  async handle(
    _context: AgentContext,
    input: DocumentAgentInput
  ): Promise<AgentResult<string>> {
    const extractedText = await this.ocr.extractText(input.fileUrl, input.mimeType);

    return {
      agent: this.name,
      payload: extractedText,
      logs: [log(this.name, `extract-${input.kind}`, input.fileUrl)],
    };
  }
}
