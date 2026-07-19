import { XMLParser } from "fast-xml-parser";
import type {
  CoveringMaterial,
  Product,
  ProductCharacteristics,
  ProductSearchQuery,
} from "@ai-door-assistant/shared";
import type { CatalogClient } from "./CatalogClient.js";

interface RawOffer {
  "@_id": string;
  "@_available"?: string;
  url?: string;
  price?: number;
  oldprice?: number;
  currencyId?: string;
  categoryId?: number;
  picture?: string[];
  name?: string;
  description?: string;
  vendor?: string;
  vendorCode?: string;
}

interface RawCategory {
  "#text": string;
  "@_id": string;
  "@_parentId"?: string;
}

interface CacheEntry {
  product: Product;
  categoryId?: number;
  /** Precomputed lowercase haystack of name/sku/characteristics for fast substring search. */
  searchText: string;
}

// Plain substring checks, not \b-based regex: JS's \b only recognizes ASCII
// word characters, so `\bэмаль\b` never matches Cyrillic text at all.
const COVERING_KEYWORDS: Array<[string, CoveringMaterial]> = [
  ["экошпон", "eco-veneer"],
  // Checked after "экошпон" (which also contains "шпон") so eco-veneer wins first.
  ["шпон", "natural-veneer"],
  ["пвх", "pvc"],
  ["полипропилен", "polypropylene"],
  ["ламинат", "laminate"],
  ["эмаль", "enamel"],
];

const STOPWORDS = new Set([
  "и",
  "в",
  "во",
  "не",
  "что",
  "он",
  "на",
  "я",
  "с",
  "со",
  "как",
  "а",
  "то",
  "все",
  "она",
  "так",
  "его",
  "но",
  "да",
  "ты",
  "у",
  "же",
  "вы",
  "за",
  "бы",
  "по",
  "только",
  "её",
  "мне",
  "было",
  "вот",
  "от",
  "меня",
  "ещё",
  "нет",
  "о",
  "из",
  "ему",
  "теперь",
  "когда",
  "даже",
  "ну",
  "вдруг",
  "ли",
  "если",
  "уже",
  "или",
  "ни",
  "быть",
  "был",
  "него",
  "до",
  "вас",
  "нибудь",
  "опять",
  "уж",
  "вам",
  "сказал",
  "здравствуйте",
  "привет",
  "добрый",
  "день",
  "подскажите",
  "пожалуйста",
  "хочу",
  "нужен",
  "нужна",
  "нужно",
  "можно",
  "стоит",
  "стоимость",
  "сколько",
  "цена",
  "цену",
  "для",
]);

/**
 * Reads the rf-dveri.ru product catalog from its YML (Yandex Market) export feed —
 * a real, structured data source (~7000 offers), refreshed on a TTL instead of being
 * scraped from HTML. Only fields the feed actually provides are populated; anything
 * else (e.g. width/height, which this feed doesn't carry) is left undefined rather
 * than guessed, per the "не выдумывать" rule.
 */
export class RfDveriYmlCatalogClient implements CatalogClient {
  private cache: CacheEntry[] | null = null;
  private cacheLoadedAt = 0;
  private loadingPromise: Promise<void> | null = null;

  constructor(
    private readonly feedUrl: string,
    private readonly feedTtlMs: number
  ) {}

  async search(query: ProductSearchQuery): Promise<Product[]> {
    await this.ensureFresh();
    const entries = this.cache ?? [];

    if (query.sku) {
      const skuLower = query.sku.toLowerCase();
      const exact = entries.filter((e) => e.product.sku.toLowerCase() === skuLower);
      if (exact.length > 0) return exact.map((e) => e.product);
    }

    if (query.similarToProductId) {
      const source = entries.find((e) => e.product.id === query.similarToProductId);
      if (!source?.categoryId) return [];
      return entries
        .filter((e) => e.categoryId === source.categoryId && e.product.id !== source.product.id)
        .slice(0, 10)
        .map((e) => e.product);
    }

    let candidates = entries;

    if (query.characteristics?.covering) {
      candidates = candidates.filter(
        (e) => e.product.characteristics.covering === query.characteristics!.covering
      );
    }

    if (query.collection) {
      const collectionLower = query.collection.toLowerCase();
      candidates = candidates.filter((e) =>
        e.product.characteristics.collection?.toLowerCase().includes(collectionLower)
      );
    }

    if (!query.text) {
      return candidates.slice(0, 20).map((e) => e.product);
    }

    const tokens = tokenize(query.text);
    if (tokens.length === 0) return [];

    const scored = candidates
      .map((e) => ({ entry: e, score: tokens.filter((t) => e.searchText.includes(t)).length }))
      .filter((s) => s.score > 0)
      .sort((a, b) => b.score - a.score);

    return scored.slice(0, 20).map((s) => s.entry.product);
  }

  async getBySku(sku: string): Promise<Product | null> {
    await this.ensureFresh();
    const skuLower = sku.toLowerCase();
    const match = (this.cache ?? []).find((e) => e.product.sku.toLowerCase() === skuLower);
    return match?.product ?? null;
  }

  async getById(id: string): Promise<Product | null> {
    await this.ensureFresh();
    const match = (this.cache ?? []).find((e) => e.product.id === id);
    return match?.product ?? null;
  }

  private async ensureFresh(): Promise<void> {
    const isStale = !this.cache || Date.now() - this.cacheLoadedAt > this.feedTtlMs;
    if (!isStale) return;

    if (!this.loadingPromise) {
      this.loadingPromise = this.loadFeed().finally(() => {
        this.loadingPromise = null;
      });
    }
    await this.loadingPromise;
  }

  private async loadFeed(): Promise<void> {
    const response = await fetch(this.feedUrl);
    if (!response.ok) {
      throw new Error(`Catalog feed request failed: ${response.status} ${response.statusText}`);
    }

    const buffer = Buffer.from(await response.arrayBuffer());
    const charset = /charset=([\w-]+)/i.exec(response.headers.get("content-type") ?? "")?.[1] ?? "utf-8";
    const xml = new TextDecoder(charset).decode(buffer);

    const parser = new XMLParser({
      ignoreAttributes: false,
      attributeNamePrefix: "@_",
      trimValues: true,
      isArray: (tagName) => tagName === "category" || tagName === "offer" || tagName === "picture",
    });
    const parsed = parser.parse(xml) as {
      yml_catalog?: { shop?: { categories?: { category?: RawCategory[] }; offers?: { offer?: RawOffer[] } } };
    };

    const shop = parsed.yml_catalog?.shop;
    const rawCategories = shop?.categories?.category ?? [];
    const rawOffers = shop?.offers?.offer ?? [];

    const categoryMap = new Map<number, { name: string; parentId?: number }>();
    for (const category of rawCategories) {
      categoryMap.set(Number(category["@_id"]), {
        name: category["#text"],
        parentId: category["@_parentId"] ? Number(category["@_parentId"]) : undefined,
      });
    }

    this.cache = rawOffers.map((offer) => this.mapOffer(offer, categoryMap));
    this.cacheLoadedAt = Date.now();
  }

  private mapOffer(
    offer: RawOffer,
    categoryMap: Map<number, { name: string; parentId?: number }>
  ): CacheEntry {
    const descriptionText = (offer.description ?? "").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
    const characteristics = extractCharacteristics(descriptionText, offer.categoryId, categoryMap);
    if (offer.vendor) characteristics.vendorGroup = offer.vendor;

    const images = offer.picture ?? [];

    const product: Product = {
      id: offer["@_id"],
      sku: offer.vendorCode ?? offer["@_id"],
      name: offer.name ?? "",
      characteristics,
      price: typeof offer.price === "number" ? offer.price : undefined,
      currency: offer.currencyId === "RUR" ? "RUB" : offer.currencyId,
      availability: offer["@_available"] === "false" ? "unavailable" : "in-stock",
      url: offer.url ?? "",
      images,
    };

    const searchText = [
      product.name,
      product.sku,
      characteristics.collection,
      characteristics.color,
      characteristics.material,
      characteristics.coveringRaw,
      characteristics.vendorGroup,
      characteristics.categoryName,
    ]
      .filter(Boolean)
      .join(" ")
      .toLowerCase();

    return { product, categoryId: offer.categoryId, searchText };
  }
}

function extractCharacteristics(
  descriptionText: string,
  categoryId: number | undefined,
  categoryMap: Map<number, { name: string; parentId?: number }>
): ProductCharacteristics {
  const characteristics: ProductCharacteristics = {};

  const colorMatch = /цвет\S*\s+([^.]+?)\s+(?:производства|от\s)/iu.exec(descriptionText);
  if (colorMatch) characteristics.color = colorMatch[1].trim();

  const materialMatch = /материала\s+(.+?)\s+с\s+покрытием/iu.exec(descriptionText);
  if (materialMatch) characteristics.material = materialMatch[1].trim();

  const coveringMatch = /с\s+покрытием\s+([^()]+?)(?:\s*\(|\s+весом|\.|$)/iu.exec(descriptionText);
  if (coveringMatch) {
    const raw = coveringMatch[1].trim();
    characteristics.coveringRaw = raw;
    const rawLower = raw.toLowerCase();
    const known = COVERING_KEYWORDS.find(([keyword]) => rawLower.includes(keyword));
    characteristics.covering = known ? known[1] : "other";
  }

  const weightMatch = /весом\s+(\d+)\s*кг/iu.exec(descriptionText);
  if (weightMatch) characteristics.weightKg = Number(weightMatch[1]);

  const seriesMatch = /серия\s+([^.]+?)\./iu.exec(descriptionText);
  if (seriesMatch) characteristics.collection = seriesMatch[1].trim();

  const installationMatch = /рекомендован\s+(?:в|для)\s+(.+?)\./iu.exec(descriptionText);
  if (installationMatch) characteristics.installation = installationMatch[1].trim();

  if (categoryId !== undefined) {
    const path: string[] = [];
    let current = categoryMap.get(categoryId);
    let cursor = categoryId;
    const visited = new Set<number>();
    while (current && !visited.has(cursor)) {
      visited.add(cursor);
      path.unshift(current.name);
      if (current.parentId === undefined) break;
      cursor = current.parentId;
      current = categoryMap.get(cursor);
    }
    if (path.length > 0) {
      characteristics.categoryName = path[path.length - 1];
      characteristics.categoryPath = path;
      if (!characteristics.collection) characteristics.collection = path[path.length - 1];
    }
  }

  return characteristics;
}

function tokenize(text: string): string[] {
  const matches = text.toLowerCase().match(/[а-яёa-z0-9]+/giu) ?? [];
  return matches.filter((token) => token.length >= 3 && !STOPWORDS.has(token));
}
