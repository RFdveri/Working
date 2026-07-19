import Anthropic from "@anthropic-ai/sdk";
import type { LlmMessage, LlmProvider } from "./LlmProvider.js";

export class AnthropicProvider implements LlmProvider {
  private readonly client: Anthropic;

  constructor(
    private readonly apiKey: string,
    private readonly model: string
  ) {
    this.client = new Anthropic({ apiKey: this.apiKey });
  }

  async complete(messages: LlmMessage[]): Promise<string> {
    const system = messages.find((m) => m.role === "system")?.content;
    const conversation = messages
      .filter((m) => m.role !== "system")
      .map((m) => ({
        role: m.role === "assistant" ? ("assistant" as const) : ("user" as const),
        content: m.content,
      }));

    const response = await this.client.messages.create({
      model: this.model,
      max_tokens: 4096,
      system,
      messages: conversation,
    });

    return extractText(response);
  }

  async describeImage(imageUrl: string, prompt: string): Promise<string> {
    const imageResponse = await fetch(imageUrl);
    const mediaType = imageResponse.headers.get("content-type") ?? "image/jpeg";
    const buffer = Buffer.from(await imageResponse.arrayBuffer());

    const response = await this.client.messages.create({
      model: this.model,
      max_tokens: 4096,
      messages: [
        {
          role: "user",
          content: [
            {
              type: "image",
              source: {
                type: "base64",
                media_type: mediaType as "image/jpeg" | "image/png" | "image/gif" | "image/webp",
                data: buffer.toString("base64"),
              },
            },
            { type: "text", text: prompt },
          ],
        },
      ],
    });

    return extractText(response);
  }
}

/**
 * Throws instead of silently returning "" when the API produced no text —
 * a swallowed empty reply used to mean the customer's message got no answer
 * at all, with no error surfaced anywhere.
 */
function extractText(response: Anthropic.Messages.Message): string {
  const textBlock = response.content.find((block) => block.type === "text");
  if (!textBlock || textBlock.type !== "text" || textBlock.text.trim().length === 0) {
    const blockTypes = response.content.map((block) => block.type).join(", ") || "none";
    throw new Error(
      `Anthropic response had no text content (stop_reason: ${response.stop_reason ?? "unknown"}, blocks: ${blockTypes})`
    );
  }
  if (response.stop_reason === "max_tokens") {
    // eslint-disable-next-line no-console
    console.warn("Anthropic response was truncated by max_tokens — consider raising the limit.");
  }
  return textBlock.text;
}
