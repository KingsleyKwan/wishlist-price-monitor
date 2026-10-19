import type { Lang } from "@/lib/copy";

export type OfferView = { shop: string; price: number; url: string; title: string };

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
  const best = [...offers].sort((a, b) => a.price - b.price)[0];
  const previous = item.lastPrice;
  const next: WishlistItem = {
    ...item,
    prevPrice: previous != null && previous !== best.price ? previous : item.prevPrice,
    lastPrice: best.price,
    lastShop: best.shop,
    lastUrl: best.url,
    offers: offers.slice(0, 6),
    lastError: null,
    lastCheckedAt: checkedAt,
  };
  const below = next.targetHkd != null && best.price <= next.targetHkd;
  const dropped =
    previous != null &&
    best.price < previous &&
    previous - best.price >= 50 &&
    best.price <= previous * 0.92;
  if (!below && !dropped) return { item: next, alert: null };
  return {
    item: next,
    alert: {
      id: crypto.randomUUID(),
      itemId: item.id,
      productName: item.name,
      price: best.price,
      shop: best.shop,
      url: best.url,
      reason: below ? "below_target" : "dropped",
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
