import type {
  KitComponentGroup,
  ProductConfiguratorClient,
} from "./ProductConfiguratorClient.js";

// Matches: <input ... name="ComponentInTheFormOfTradeOffer[<groupId>]" value="<value>"
// data-price="<price>" type="radio" ...> optionally followed by a same-group
// <label ... title="<Role>: <Label>">. The empty-value / data-price="0" entry in
// each group is the page's own "not selected" placeholder and is skipped here.
const OPTION_PATTERN =
  /<input[^>]*name="ComponentInTheFormOfTradeOffer\[(\d+)\]"[^>]*value="([^"]+)"[^>]*data-price="([^"]+)"[^>]*>(?:\s*<label[^>]*title="([^"]*)")?/g;

/**
 * Scrapes the frame/casing/jamb-extension/skirting configurator embedded in a
 * specific door's own product page — this data doesn't exist anywhere in the
 * bulk YML feed, only on the per-product page itself.
 */
export class RfDveriProductConfiguratorClient implements ProductConfiguratorClient {
  async getComponentGroups(productUrl: string): Promise<KitComponentGroup[]> {
    const response = await fetch(productUrl, {
      headers: { "User-Agent": "Mozilla/5.0 (AI-Door-Assistant)" },
    });
    if (!response.ok) {
      throw new Error(`Product page request failed: ${response.status} ${response.statusText}`);
    }
    const html = await response.text();

    const groups = new Map<string, KitComponentGroup>();
    for (const match of html.matchAll(OPTION_PATTERN)) {
      const [, groupId, value, priceRaw, title] = match;
      if (!value || value === "") continue; // the page's own "not selected" placeholder
      const price = Number(priceRaw);
      if (Number.isNaN(price)) continue;

      const [role, label] = splitTitle(title);
      if (!groups.has(groupId)) groups.set(groupId, { role: role ?? groupId, options: [] });
      groups.get(groupId)!.options.push({ label: label ?? title ?? value, price });
    }

    return [...groups.values()];
  }
}

function splitTitle(title: string | undefined): [string | undefined, string | undefined] {
  if (!title) return [undefined, undefined];
  const separatorIndex = title.indexOf(":");
  if (separatorIndex === -1) return [undefined, title.trim()];
  return [title.slice(0, separatorIndex).trim(), title.slice(separatorIndex + 1).trim()];
}
