export type Offer = {
  shop: string;
  price: number;
  url: string;
  title: string;
  chain: boolean;
};

const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36";

function decodeHref(href: string): string | null {
  if (href.includes("ad_domain") || href.includes("/y.js")) return null;
  const uddg = href.match(/[?&]uddg=([^&]+)/);
  const raw = uddg ? decodeURIComponent(uddg[1]) : href.startsWith("//") ? `https:${href}` : href;
  if (!raw.startsWith("https://") && !raw.startsWith("http://")) return null;
  try {
    const url = new URL(raw);
    if (url.protocol !== "https:" && url.protocol !== "http:") return null;
    if (url.hostname.includes("duckduckgo.com")) return null;
    return url.toString();
  } catch {
    return null;
  }
}

function strip(html: string): string {
  return html
    .replace(/<[^>]+>/g, " ")
    .replace(/&/g, "&")
    .replace(/"/g, '"')
    .replace(/&#x27;|'/g, "'")
    .replace(/</g, "<")
    .replace(/>/g, ">")
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
    .replace(/\s+/g, " ")
    .trim();
}

function pricesIn(text: string): number[] {
  const found: number[] = [];
  const re = /HK\s*\$\s*([0-9][0-9,]*)/gi;
  let match: RegExpExecArray | null;
  while ((match = re.exec(text))) {
    const value = Number(match[1].replace(/,/g, ""));
    if (value >= 20 && value <= 200_000) found.push(value);
  }
  return found;
}

function pickPrice(amounts: number[]): number | null {
  if (amounts.length === 0) return null;
  const high = Math.max(...amounts);
  const plausible = amounts.filter((amount) => amount >= high * 0.45);
  return Math.min(...(plausible.length > 0 ? plausible : amounts));
}

const SIZE = /^\d+(?:\.\d+)?(?:ml|g|kg|gb|tb|mm|cm|oz|l|inch|in)$/i;
const STOP = new Set(["the", "a", "an", "of", "for", "and", "or", "的", "及"]);

function nameTokens(query: string): string[] {
  return query
    .split(/\s+/)
    .map((token) => token.trim())
    .filter((token) => token.length >= 2 && !SIZE.test(token) && !STOP.has(token.toLowerCase()));
}

function relevant(query: string, text: string): boolean {
  const tokens = nameTokens(query);
  if (tokens.length === 0) return true;
  const hay = text.toLowerCase();
  const hits = tokens.filter((token) => hay.includes(token.toLowerCase()));
  if (!hay.includes(tokens[0].toLowerCase())) return false;
  const need = Math.min(tokens.length, Math.max(2, Math.ceil(tokens.length * 0.5)));
  return hits.length >= need;
}

function shopFrom(title: string, url: string): string {
  const piped = title.split(/\s+\|\s+/);
  const head = piped.length > 1 ? piped[1] : title;
  const dashed = head.split(/\s+[–—-]\s+/).map((part) => part.trim()).filter(Boolean);
  const candidate = piped.length > 1 ? dashed[0] : dashed[dashed.length - 1];
  if (candidate && candidate.length <= 42 && candidate !== title) return candidate;
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return "Shop";
  }
}

export function parseSearchHtml(html: string, query = ""): Offer[] {
  const titles = [...html.matchAll(/<a[^>]*class="result__a"[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi)];
  const snippets = [...html.matchAll(/<a[^>]*class="result__snippet"[^>]*>([\s\S]*?)<\/a>/gi)];
  const offers: Offer[] = [];
  const seen = new Set<string>();

  titles.forEach((titleMatch, index) => {
    const url = decodeHref(titleMatch[1]);
    if (!url) return;
    const title = strip(titleMatch[2]);
    const snippet = strip(snippets[index]?.[1] ?? "");
    const blob = `${title} ${snippet}`;
    if (query && !relevant(query, blob)) return;
    const price = pickPrice(pricesIn(blob));
    if (price == null) return;
    const key = `${url}|${price}`;
    if (seen.has(key)) return;
    seen.add(key);
    offers.push({ shop: shopFrom(title, url), price, url, title, chain: false });
  });

  offers.sort((a, b) => a.price - b.price);
  return offers.slice(0, 6);
}

function productUrl(href: string): { url: string; shopId: string } | null {
  const raw = href.replace(new RegExp("&" + "amp;", "g"), "&");
  const shopId = raw.match(/[?&]i=([^&]+)/)?.[1] ?? "";
  const purl = raw.match(/[?&]purl=([^&]+)/);
  if (!purl) return null;
  try {
    const url = new URL(decodeURIComponent(purl[1]));
    if (url.protocol !== "https:" && url.protocol !== "http:") return null;
    return { url: url.toString(), shopId };
  } catch {
    return null;
  }
}

function hkdAmount(text: string): number | null {
  const match = text.replace(/,/g, "").match(/\$\s*([0-9]+(?:\.[0-9]+)?)/);
  if (!match) return null;
  const value = Math.round(Number(match[1]));
  if (value < 20 || value > 200_000) return null;
  return value;
}

export function parseBigGoHtml(html: string, query = ""): Offer[] {
  const cards = [
    ...html.matchAll(
      /title="([^"]+)" href="([^"]*purl=[^"]+)"[\s\S]*?data-price="true">\s*([^<]+?)\s*<[\s\S]*?<span>([^<]+)<\/span>/gi,
    ),
  ];
  const offers: Offer[] = [];
  const seen = new Set<string>();

  for (const card of cards) {
    const title = strip(card[1]);
    const located = productUrl(card[2]);
    const price = hkdAmount(card[3]);
    const shop = strip(card[4]);
    if (!located || price == null || !shop) continue;
    if (!located.shopId.startsWith("hk_")) continue;
    if (query && !relevant(query, `${title} ${shop}`)) continue;
    const key = `${located.url}|${price}`;
    if (seen.has(key)) continue;
    seen.add(key);
    offers.push({
      shop,
      price,
      url: located.url,
      title,
      chain: located.shopId.startsWith("hk_ec_"),
    });
  }

  if (offers.length === 0) return [];
  const chains = offers.filter((offer) => offer.chain).sort((a, b) => a.price - b.price);
  const cheapestChain = chains[0];
  const floor = cheapestChain
    ? cheapestChain.price * 0.45
    : Math.max(...offers.map((offer) => offer.price)) * 0.45;
  const others = offers
    .filter((offer) => !offer.chain && offer.price >= floor)
    .sort((a, b) => a.price - b.price)
    .slice(0, 6);
  return [...chains.slice(0, 2), ...others].slice(0, 8);
}

async function searchBigGo(product: string): Promise<Offer[]> {
  const url = `https://biggo.hk/s/${encodeURIComponent(product)}`;
  const response = await fetch(url, {
    headers: {
      "User-Agent": UA,
      "Accept-Language": "zh-HK,zh;q=0.9,en;q=0.8",
      Accept: "text/html",
    },
    signal: AbortSignal.timeout(14_000),
  });
  if (!response.ok) throw new Error(`Search failed (${response.status})`);
  const html = await response.text();
  if (html.length < 1500 || /Just a moment|Access Denied/i.test(html)) {
    throw new Error("Search was blocked");
  }
  return parseBigGoHtml(html, product);
}

async function searchLite(product: string): Promise<Offer[]> {
  const url = `https://lite.duckduckgo.com/lite/?q=${encodeURIComponent(`${product} 香港 HK$ 價錢`)}`;
  const response = await fetch(url, {
    headers: {
      "User-Agent": UA,
      "Accept-Language": "zh-HK,zh;q=0.9,en;q=0.8",
      Accept: "text/html",
    },
    signal: AbortSignal.timeout(14_000),
  });
  if (!response.ok) throw new Error(`Search failed (${response.status})`);
  const html = await response.text();
  if (html.length < 1500 || /bots use DuckDuckGo|anomaly-modal/i.test(html)) {
    throw new Error("Search was blocked");
  }
  const offers = parseSearchHtml(html, product);
  if (offers.length > 0) return offers;
  return parseLiteHtml(html, product);
}

export function parseLiteHtml(html: string, query = ""): Offer[] {
  const titles = [...html.matchAll(/<a[^>]*class='result-link'[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi)];
  const snippets = [...html.matchAll(/class='result-snippet'>([\s\S]*?)<\/td>/gi)];
  const offers: Offer[] = [];
  const seen = new Set<string>();
  titles.forEach((titleMatch, index) => {
    const url = decodeHref(titleMatch[1]);
    if (!url) return;
    const title = strip(titleMatch[2]);
    const snippet = strip(snippets[index]?.[1] ?? "");
    const blob = `${title} ${snippet}`;
    if (query && !relevant(query, blob)) return;
    const price = pickPrice(pricesIn(blob));
    if (price == null) return;
    const key = `${url}|${price}`;
    if (seen.has(key)) return;
    seen.add(key);
    offers.push({ shop: shopFrom(title, url), price, url, title, chain: false });
  });
  offers.sort((a, b) => a.price - b.price);
  return offers.slice(0, 6);
}

export async function lookupOffers(product: string): Promise<Offer[]> {
  const name = product.trim().slice(0, 120);
  const failures: string[] = [];
  for (const search of [searchBigGo, searchLite]) {
    try {
      const offers = await search(name);
      if (offers.length > 0) return offers;
    } catch (error) {
      failures.push(error instanceof Error ? error.message : "Search failed");
    }
  }
  if (failures.length === 2) throw new Error(failures[0]);
  return [];
}
