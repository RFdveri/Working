import * as cheerio from "cheerio";
import type { Product, ProductSearchQuery } from "@ai-door-assistant/shared";
import type { CatalogClient } from "./CatalogClient.js";

/**
 * Talks to the rf-dveri.ru catalog. rf-dveri.ru does not publish a documented
 * public JSON API, so this client scrapes the storefront's search/product pages
 * as an interim source of truth and never invents a field it can't find.
 *
 * If/when a real catalog export or partner API becomes available, swap the
 * fetch+parse calls below for that API — the CatalogClient interface and every
 * caller (Product Agent, Search Agent, Price Agent) stay unchanged.
 */
export class RfDveriCatalogClient implements CatalogClient {
  constructor(
    private readonly baseUrl: string,
    private readonly apiKey?: string
  ) {}

  async search(query: ProductSearchQuery): Promise<Product[]> {
    const params = new URLSearchParams();
    if (query.text) params.set("q", query.text);
    if (query.sku) params.set("article", query.sku);
    if (query.collection) params.set("collection", query.collection);

    const url = `${this.baseUrl}/search/?${params.toString()}`;
    const html = await this.fetchHtml(url);
    return this.parseListing(html);
  }

  async getBySku(sku: string): Promise<Product | null> {
    const results = await this.search({ sku });
    return results.find((p) => p.sku === sku) ?? results[0] ?? null;
  }

  async getById(id: string): Promise<Product | null> {
    const url = `${this.baseUrl}/product/${encodeURIComponent(id)}/`;
    try {
      const html = await this.fetchHtml(url);
      return this.parseProductPage(html, url);
    } catch {
      return null;
    }
  }

  private async fetchHtml(url: string): Promise<string> {
    const response = await fetch(url, {
      headers: {
        "User-Agent": "AI-Door-Assistant/0.1 (+https://rf-dveri.ru)",
        ...(this.apiKey ? { Authorization: `Bearer ${this.apiKey}` } : {}),
      },
    });
    if (!response.ok) {
      throw new Error(
        `rf-dveri.ru request failed: ${response.status} ${response.statusText}`
      );
    }
    return response.text();
  }

  /**
   * NOTE: the CSS selectors below are placeholders. Inspect the live search
   * results markup on rf-dveri.ru and adjust `.product-card` / its children to
   * match before relying on this in production.
   */
  private parseListing(html: string): Product[] {
    const $ = cheerio.load(html);
    const products: Product[] = [];

    $(".product-card").each((_, el) => {
      const card = $(el);
      const url = card.attr("href") ?? card.find("a").first().attr("href") ?? "";
      const name = card.find(".product-card__title").text().trim();
      const sku = card.find(".product-card__sku").text().trim();
      const priceText = card.find(".product-card__price").text().replace(/\D/g, "");
      const image = card.find("img").attr("src") ?? "";

      if (!name) return;
      products.push({
        id: sku || url,
        sku,
        name,
        characteristics: {},
        price: priceText ? Number(priceText) : undefined,
        currency: "RUB",
        availability: "unknown",
        url: url.startsWith("http") ? url : `${this.baseUrl}${url}`,
        images: image ? [image.startsWith("http") ? image : `${this.baseUrl}${image}`] : [],
      });
    });

    return products;
  }

  private parseProductPage(html: string, url: string): Product | null {
    const $ = cheerio.load(html);
    const name = $("h1").first().text().trim();
    if (!name) return null;

    const sku = $("[itemprop='sku']").first().text().trim();
    const priceText = $("[itemprop='price']").first().attr("content")
      ?? $(".price").first().text().replace(/\D/g, "");
    const images = $("img[itemprop='image']")
      .map((_, el) => $(el).attr("src") ?? "")
      .get()
      .filter(Boolean);

    const characteristics: Record<string, string> = {};
    $(".characteristics__row, .spec-row").each((_, row) => {
      const key = $(row).find(".characteristics__key, .spec-row__key").text().trim();
      const value = $(row).find(".characteristics__value, .spec-row__value").text().trim();
      if (key && value) characteristics[key] = value;
    });

    return {
      id: sku || url,
      sku,
      name,
      characteristics,
      price: priceText ? Number(priceText) : undefined,
      currency: "RUB",
      availability: "unknown",
      url,
      images,
    };
  }
}
