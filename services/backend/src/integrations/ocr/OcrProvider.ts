export interface OcrProvider {
  /** Extracts text/structured content from an image, PDF, or drawing (DWG export). */
  extractText(fileUrl: string, mimeType: string): Promise<string>;
}

export class MockOcrProvider implements OcrProvider {
  async extractText(fileUrl: string): Promise<string> {
    return `[mock-ocr] OCR_PROVIDER не настроен, файл не распознан: ${fileUrl}`;
  }
}
