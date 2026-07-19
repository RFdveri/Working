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
      max_tokens: 1024,
      system,
      messages: conversation,
    });

    const textBlock = response.content.find((block) => block.type === "text");
    return textBlock && textBlock.type === "text" ? textBlock.text : "";
  }

  async describeImage(imageUrl: string, prompt: string): Promise<string> {
    const imageResponse = await fetch(imageUrl);
    const mediaType = imageResponse.headers.get("content-type") ?? "image/jpeg";
    const buffer = Buffer.from(await imageResponse.arrayBuffer());

    const response = await this.client.messages.create({
      model: this.model,
      max_tokens: 1024,
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

    const textBlock = response.content.find((block) => block.type === "text");
    return textBlock && textBlock.type === "text" ? textBlock.text : "";
  }
}
