export type Offer = {
  shop: string;
  price: number;
  url: string;
  title: string;
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

function relevant(query: string, text: string): boolean {
  const tokens = query
    .split(/\s+/)
    .map((token) => token.trim())
    .filter((token) => token.length >= 2);
  const hay = text.toLowerCase();
  const model = tokens.find((token) => /\d/.test(token));
  if (model) return hay.includes(model.toLowerCase());
  const longest = [...tokens].sort((a, b) => b.length - a.length)[0];
  return longest ? hay.includes(longest.toLowerCase()) : true;
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
    offers.push({ shop: shopFrom(title, url), price, url, title });
  });

  offers.sort((a, b) => a.price - b.price);
  return offers.slice(0, 6);
}

async function searchOnce(searchQuery: string, product: string): Promise<Offer[]> {
  const url = `https://html.duckduckgo.com/html/?q=${encodeURIComponent(searchQuery)}`;
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
  if (html.length < 1500) throw new Error("Search was blocked");
  return parseSearchHtml(html, product);
}

export async function lookupOffers(product: string): Promise<Offer[]> {
  const name = product.trim().slice(0, 120);
  const first = await searchOnce(`${name} 香港 HK$ 價錢`, name);
  if (first.length > 0) return first;
  return searchOnce(`${name} Price.com.hk OR 豐澤 OR 友和 HK$`, name);
}
