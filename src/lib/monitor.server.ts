import { getSql } from "@/lib/db";
import { lookupOffers, type Offer } from "@/lib/prices.server";

type ItemRow = {
  id: string;
  user_id: string;
  name: string;
  target_hkd: number | null;
  last_price: number | null;
};

function reasonFor(error: unknown): string {
  const message = error instanceof Error ? error.message : "Lookup failed";
  if (error instanceof Error && (error.name === "TimeoutError" || error.name === "AbortError")) {
    return `${message}。原因：公開搜尋超過 14 秒未回應。`;
  }
  if (message.startsWith("Search failed")) {
    return `${message}。原因：公開搜尋拒絕咗今次查詢。`;
  }
  if (message === "Search was blocked") {
    return `${message}。原因：返回頁面太短，通常係防機械人攔截。`;
  }
  return `${message}。原因：搜尋中途失敗。`;
}

function asInt(value: unknown): number | null {
  if (value == null) return null;
  const n = typeof value === "number" ? value : Number(value);
  return Number.isFinite(n) ? Math.round(n) : null;
}

export async function checkItem(row: ItemRow): Promise<{
  price: number | null;
  alerted: boolean;
  error: string | null;
}> {
  const sql = await getSql();
  let offers: Offer[] = [];
  try {
    offers = await lookupOffers(row.name);
  } catch (error) {
    const message = reasonFor(error).slice(0, 240);
    await sql`
      update wishlist_items
      set last_error = ${message}, last_checked_at = now()
      where id = ${row.id} and user_id = ${row.user_id}
    `;
    return { price: null, alerted: false, error: message };
  }

  if (offers.length === 0) {
    const message = "搵唔到公開報價。原因：結果入面冇同時提到呢件產品同 HK$ 價錢。";
    await sql`
      update wishlist_items
      set last_error = ${message}, last_checked_at = now()
      where id = ${row.id} and user_id = ${row.user_id}
    `;
    return { price: null, alerted: false, error: message };
  }

  const best = offers[0];
  const previous = asInt(row.last_price);
  const target = asInt(row.target_hkd);
  await sql`
    update wishlist_items
    set
      prev_price = case
        when last_price is distinct from ${best.price} then last_price
        else prev_price
      end,
      last_price = ${best.price},
      last_shop = ${best.shop},
      last_url = ${best.url},
      last_title = ${best.title.slice(0, 180)},
      offers_json = ${JSON.stringify(offers)},
      last_error = null,
      last_checked_at = now()
    where id = ${row.id} and user_id = ${row.user_id}
  `;

  const belowTarget = target != null && best.price <= target;
  const dropped =
    previous != null &&
    best.price < previous &&
    previous - best.price >= 50 &&
    best.price <= previous * 0.92;
  if (!belowTarget && !dropped) return { price: best.price, alerted: false, error: null };

  const reason = belowTarget ? "below_target" : "dropped";
  const recent = await sql<{ id: string }>`
    select id from price_alerts
    where user_id = ${row.user_id}
      and item_id = ${row.id}
      and price = ${best.price}
      and created_at > now() - interval '20 hours'
    limit 1
  `;
  if (recent.length > 0) return { price: best.price, alerted: false, error: null };

  await sql`
    insert into price_alerts (id, user_id, item_id, product_name, price, shop, url, reason)
    values (
      ${crypto.randomUUID()},
      ${row.user_id},
      ${row.id},
      ${row.name},
      ${best.price},
      ${best.shop},
      ${best.url},
      ${reason}
    )
  `;
  return { price: best.price, alerted: true, error: null };
}

async function loadRows(where: string, params: unknown[]): Promise<ItemRow[]> {
  const sql = await getSql();
  const rows = await sql.query<ItemRow>(
    `select id, user_id, name, target_hkd, last_price from wishlist_items ${where}`,
    params,
  );
  return rows.map((row) => ({
    ...row,
    target_hkd: asInt(row.target_hkd),
    last_price: asInt(row.last_price),
  }));
}

export async function checkUserItems(userId: string, force: boolean) {
  const rows = await loadRows(
    force
      ? "where user_id = $1 and monitor = true order by created_at asc limit 8"
      : "where user_id = $1 and monitor = true and (last_checked_at is null or last_checked_at < now() - interval '6 hours') order by last_checked_at asc nulls first limit 8",
    [userId],
  );
  let checked = 0;
  let alerted = 0;
  const errors: string[] = [];
  for (const row of rows) {
    const result = await checkItem(row);
    checked += 1;
    if (result.alerted) alerted += 1;
    if (result.error) errors.push(`${row.name}：${result.error}`);
    if (rows.length > 1) await new Promise((resolve) => setTimeout(resolve, 350));
  }
  return { checked, alerted, errors };
}

export async function sweepDueItems() {
  const rows = await loadRows(
    "where monitor = true and (last_checked_at is null or last_checked_at < now() - interval '12 hours') order by last_checked_at asc nulls first limit 12",
    [],
  );
  let checked = 0;
  let alerted = 0;
  for (const row of rows) {
    const result = await checkItem(row);
    checked += 1;
    if (result.alerted) alerted += 1;
    if (rows.length > 1) await new Promise((resolve) => setTimeout(resolve, 400));
  }
  return { checked, alerted };
}
