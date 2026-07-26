export type MessageRole = "customer" | "assistant" | "manager" | "system";

export type AttachmentKind =
  | "image"
  | "pdf"
  | "docx"
  | "xlsx"
  | "dwg"
  | "audio"
  | "other";

export interface Attachment {
  id: string;
  kind: AttachmentKind;
  url: string;
  fileName: string;
  /** Filled in by Vision/Document/Voice agents after processing. */
  extractedText?: string;
  analysisSummary?: string;
}

export interface Message {
  id: string;
  role: MessageRole;
  text: string;
  attachments?: Attachment[];
  timestamp: string;
}
