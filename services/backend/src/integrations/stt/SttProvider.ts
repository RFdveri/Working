export interface SttProvider {
  /** Transcribes a customer voice message (e.g. via Whisper) for use in the dialog context. */
  transcribe(audioUrl: string): Promise<string>;
}

export class MockSttProvider implements SttProvider {
  async transcribe(audioUrl: string): Promise<string> {
    return `[mock-stt] STT_PROVIDER не настроен, голосовое не распознано: ${audioUrl}`;
  }
}
