import { createServerFn } from "@tanstack/react-start";
import { getSql } from "@/lib/db";
import { authMiddleware } from "@/lib/auth/middleware";

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
  lastError: string | null;
};

export type PriceAlert = {
  id: string;
  itemId: string;
  productName: string;
  price: number;
  shop: string | null;
  url: string | null;
  reason: string;
  read: boolean;
  createdAt: string;
};

type ItemRow = {
  id: string;
  name: string;
  target_hkd: number | null;
  monitor: boolean;
  last_price: number | null;
  prev_price: number | null;
  last_shop: string | null;
  last_url: string | null;
  offers_json: string;
  last_checked_at: string | Date | null;
  last_error: string | null;
};

function num(value: unknown): number | null {
  if (value == null) return null;
  const n = typeof value === "number" ? value : Number(value);
  return Number.isFinite(n) ? Math.round(n) : null;
}

function stamp(value: string | Date | null): string | null {
  if (!value) return null;
  if (value instanceof Date) return value.toISOString();
  return String(value);
}

function mapItem(row: ItemRow): WishlistItem {
  let offers: OfferView[] = [];
  try {
    const parsed = JSON.parse(row.offers_json) as OfferView[];
    if (Array.isArray(parsed)) offers = parsed.slice(0, 6);
  } catch {
    offers = [];
  }
  return {
    id: row.id,
    name: row.name,
    targetHkd: num(row.target_hkd),
    monitor: Boolean(row.monitor),
    lastPrice: num(row.last_price),
    prevPrice: num(row.prev_price),
    lastShop: row.last_shop,
    lastUrl: row.last_url,
    offers,
    lastCheckedAt: stamp(row.last_checked_at),
    lastError: row.last_error,
  };
}

export const listItems = createServerFn({ method: "GET" })
  .middleware([authMiddleware])
  .handler(async ({ context }) => {
    const sql = await getSql();
    const rows = await sql<ItemRow>`
      select id, name, target_hkd, monitor, last_price, prev_price, last_shop, last_url,
             offers_json, last_checked_at::text as last_checked_at, last_error
      from wishlist_items
      where user_id = ${context.userId}
      order by created_at desc
    `;
    return rows.map(mapItem);
  });

export const listAlerts = createServerFn({ method: "GET" })
  .middleware([authMiddleware])
  .handler(async ({ context }) => {
    const sql = await getSql();
    const rows = await sql<{
      id: string;
      item_id: string;
      product_name: string;
      price: number;
      shop: string | null;
      url: string | null;
      reason: string;
      read: boolean;
      created_at: string | Date;
    }>`
      select id, item_id, product_name, price, shop, url, reason, read, created_at::text as created_at
      from price_alerts
      where user_id = ${context.userId}
      order by created_at desc
      limit 30
    `;
    return rows.map((row) => ({
      id: row.id,
      itemId: row.item_id,
      productName: row.product_name,
      price: num(row.price) ?? 0,
      shop: row.shop,
      url: row.url,
      reason: row.reason,
      read: Boolean(row.read),
      createdAt: stamp(row.created_at) ?? "",
    }));
  });

export const addItem = createServerFn({ method: "POST" })
  .validator((input: { name: string; targetHkd: number | null }) => input)
  .middleware([authMiddleware])
  .handler(async ({ context, data }) => {
    const name = data.name.trim().slice(0, 120);
    if (name.length < 2) return { ok: false as const, error: "產品名稱太短" };
    const target =
      data.targetHkd == null
        ? null
        : Number.isInteger(data.targetHkd) && data.targetHkd > 0 && data.targetHkd < 2_000_000
          ? data.targetHkd
          : null;
    if (data.targetHkd != null && target == null) {
      return { ok: false as const, error: "目標價要係正整數" };
    }
    const sql = await getSql();
    const id = crypto.randomUUID();
    await sql`
      insert into wishlist_items (id, user_id, name, target_hkd)
      values (${id}, ${context.userId}, ${name}, ${target})
    `;
    return { ok: true as const, id };
  });

export const updateItem = createServerFn({ method: "POST" })
  .validator((input: { id: string; targetHkd: number | null; monitor: boolean }) => input)
  .middleware([authMiddleware])
  .handler(async ({ context, data }) => {
    if (!/^[0-9a-f-]{36}$/i.test(data.id)) return { ok: false as const };
    const target =
      data.targetHkd == null || !Number.isInteger(data.targetHkd) || data.targetHkd <= 0
        ? null
        : data.targetHkd;
    const sql = await getSql();
    await sql`
      update wishlist_items
      set target_hkd = ${target}, monitor = ${Boolean(data.monitor)}
      where id = ${data.id} and user_id = ${context.userId}
    `;
    return { ok: true as const };
  });

export const removeItem = createServerFn({ method: "POST" })
  .validator((id: string) => id)
  .middleware([authMiddleware])
  .handler(async ({ context, data: id }) => {
    const sql = await getSql();
    await sql`delete from price_alerts where item_id = ${id} and user_id = ${context.userId}`;
    await sql`delete from wishlist_items where id = ${id} and user_id = ${context.userId}`;
    return { ok: true as const };
  });

export const markAlertsRead = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .handler(async ({ context }) => {
    const sql = await getSql();
    await sql`update price_alerts set read = true where user_id = ${context.userId} and read = false`;
    return { ok: true as const };
  });

export const checkNow = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .handler(async ({ context }) => {
    const { checkUserItems } = await import("@/lib/monitor.server");
    return checkUserItems(context.userId, true);
  });

export const checkDue = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .handler(async ({ context }) => {
    const { checkUserItems } = await import("@/lib/monitor.server");
    return checkUserItems(context.userId, false);
  });
