export interface LlmMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export interface LlmProvider {
  complete(messages: LlmMessage[]): Promise<string>;
  /** Optional: providers with vision support (e.g. Claude) can describe an image for the Vision Agent. */
  describeImage?(imageUrl: string, prompt: string): Promise<string>;
}
