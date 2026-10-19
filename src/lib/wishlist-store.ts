import type { Lang } from "@/lib/copy";

export type OfferView = {
  shop: string;
  price: number;
  url: string;
  title: string;
  chain?: boolean;
};

export function chainOffers(offers: OfferView[]) {
  return offers.filter((offer) => offer.chain).sort((a, b) => a.price - b.price);
}

export function headlineOffer(offers: OfferView[], target: number | null): OfferView | null {
  const chains = chainOffers(offers);
  if (chains[0]) return chains[0];
  const ranked = [...offers].sort((a, b) => a.price - b.price);
  if (target == null) return ranked[0] ?? null;
  return ranked.find((offer) => offer.price <= target) ?? ranked[0] ?? null;
}

export function underTargetOffers(offers: OfferView[], target: number | null): OfferView[] {
  if (target == null) return [];
  const chains = chainOffers(offers);
  if (chains.some((offer) => offer.price <= target)) return [];
  const headline = headlineOffer(offers, target);
  return offers
    .filter((offer) => offer.price <= target && offer.url !== headline?.url)
    .sort((a, b) => a.price - b.price)
    .slice(0, 5);
}

export type WishlistItem = {
  id: string;
  name: string;
  targetHkd: number | null;
  monitor: boolean;
  lastPrice: number | null;
  prevPrice: number | null;
  lastShop: string | null;
  lastUrl: string | null;
  offers: OfferView[];
  lastCheckedAt: string | null;
  lastError: "blocked" | "timeout" | "empty" | "failed" | null;
};

export type PriceAlert = {
  id: string;
  itemId: string;
  productName: string;
  price: number;
  shop: string | null;
  url: string | null;
  reason: "below_target" | "dropped";
  read: boolean;
  createdAt: string;
};

export type Book = {
  lang: Lang;
  items: WishlistItem[];
  alerts: PriceAlert[];
};

const KEY = "pricebook.v1";

export const emptyBook: Book = { lang: "zh", items: [], alerts: [] };

function isItem(value: unknown): value is WishlistItem {
  if (!value || typeof value !== "object") return false;
  const item = value as WishlistItem;
  return typeof item.id === "string" && typeof item.name === "string";
}

export function loadBook(): Book {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return emptyBook;
    const parsed = JSON.parse(raw) as Partial<Book>;
    return {
      lang: parsed.lang === "en" ? "en" : "zh",
      items: Array.isArray(parsed.items) ? parsed.items.filter(isItem).slice(0, 40) : [],
      alerts: Array.isArray(parsed.alerts) ? parsed.alerts.slice(0, 30) : [],
    };
  } catch {
    return emptyBook;
  }
}

export function saveBook(book: Book) {
  localStorage.setItem(KEY, JSON.stringify(book));
}

export function applyQuote(
  item: WishlistItem,
  offers: OfferView[],
  error: WishlistItem["lastError"],
): { item: WishlistItem; alert: PriceAlert | null } {
  const checkedAt = new Date().toISOString();
  if (error || offers.length === 0) {
    return {
      item: { ...item, lastError: error ?? "empty", lastCheckedAt: checkedAt },
      alert: null,
    };
  }
  const best = headlineOffer(offers, item.targetHkd);
  if (!best) {
    return { item: { ...item, lastError: "empty", lastCheckedAt: checkedAt }, alert: null };
  }
  const under = underTargetOffers(offers, item.targetHkd);
  const deal = [best, ...under]
    .filter((offer) => item.targetHkd != null && offer.price <= item.targetHkd)
    .sort((a, b) => a.price - b.price)[0];
  const previous = item.lastPrice;
  const next: WishlistItem = {
    ...item,
    prevPrice: previous != null && previous !== best.price ? previous : item.prevPrice,
    lastPrice: best.price,
    lastShop: best.shop,
    lastUrl: best.url,
    offers,
    lastError: null,
    lastCheckedAt: checkedAt,
  };
  const dropped =
    !deal &&
    previous != null &&
    best.price < previous &&
    previous - best.price >= 50 &&
    best.price <= previous * 0.92;
  if (!deal && !dropped) return { item: next, alert: null };
  const picked = deal ?? best;
  return {
    item: next,
    alert: {
      id: crypto.randomUUID(),
      itemId: item.id,
      productName: item.name,
      price: picked.price,
      shop: picked.shop,
      url: picked.url,
      reason: deal ? "below_target" : "dropped",
      read: false,
      createdAt: checkedAt,
    },
  };
}

export function recentSamePrice(alerts: PriceAlert[], alert: PriceAlert) {
  const cutoff = Date.now() - 20 * 60 * 60 * 1000;
  return alerts.some(
    (existing) =>
      existing.itemId === alert.itemId &&
      existing.price === alert.price &&
      new Date(existing.createdAt).getTime() > cutoff,
  );
}
