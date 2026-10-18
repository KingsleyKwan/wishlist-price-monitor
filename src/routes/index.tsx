import { useEffect, useRef, useState, type FormEvent } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { Bell, Plus, RefreshCw, Trash2 } from "lucide-react";
import { UserButton } from "@/lib/auth/gates";
import { useCurrentUserState } from "@/lib/auth/use-current-user";
import { EmailAuthForm } from "@/components/email-auth-form";
import { GROK_PROVIDERS, signIn } from "@/lib/auth/client";
import {
  addItem,
  checkDue,
  checkNow,
  listAlerts,
  listItems,
  markAlertsRead,
  removeItem,
  updateItem,
  type PriceAlert,
  type WishlistItem,
} from "@/lib/wishlist.functions";

export const Route = createFileRoute("/")({ component: Home });

function money(value: number) {
  return `HK$${value.toLocaleString("en-HK")}`;
}

function when(iso: string | null) {
  if (!iso) return "未檢查";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "未檢查";
  return date.toLocaleString("zh-HK", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
}

function Home() {
  const { user, isPending } = useCurrentUserState();
  return (
    <main className="min-h-screen bg-paper text-ink">
      <div className="mx-auto flex w-full max-w-3xl flex-col gap-6 px-4 py-6 sm:px-6">
        <header className="flex items-end justify-between gap-4 border-b border-line pb-4">
          <div>
            <p className="text-xs font-medium tracking-[0.18em] text-muted uppercase">Wish ledger</p>
            <h1 className="font-display text-4xl leading-none font-medium tracking-tight">格價簿</h1>
          </div>
          <div className="min-h-11">
            {isPending ? (
              <div className="h-8 w-24 animate-pulse rounded-full bg-line" />
            ) : (
              <UserButton />
            )}
          </div>
        </header>
        {isPending ? (
          <div className="space-y-3">
            <p className="max-w-xl text-sm text-muted">
              清單存在你個帳號。發布後伺服器每日 09:00（香港時間）自動格價，低過目標就寫入提醒。
            </p>
            <div className="h-40 animate-pulse rounded-2xl bg-line" />
          </div>
        ) : user ? (
          <Board />
        ) : (
          <SignedOut />
        )}
      </div>
    </main>
  );
}

function SignedOut() {
  return (
    <section className="rounded-2xl border border-line bg-card p-6">
      <h2 className="font-display text-2xl">登入先儲存清單</h2>
      <p className="mt-2 max-w-md text-sm text-muted">
        心願產品留喺你個帳號。發布之後，伺服器每日會自動格價，低過目標就寫入提醒。
      </p>
      <div className="mt-5 flex flex-col gap-2">
        <EmailAuthForm />
        <p className="py-1 text-center text-xs tracking-[0.16em] text-muted uppercase">或者</p>
        {GROK_PROVIDERS.map((provider) => (
          <button
            key={provider.providerId}
            type="button"
            onClick={() => signIn(provider.providerId, { callbackURL: "/" })}
            className="min-h-11 rounded-xl border border-line bg-paper px-4 text-sm font-medium hover:border-ink"
          >
            Continue with {provider.label}
          </button>
        ))}
      </div>
    </section>
  );
}

function Board() {
  const { user } = useCurrentUserState();
  const [items, setItems] = useState<WishlistItem[]>([]);
  const [alerts, setAlerts] = useState<PriceAlert[]>([]);
  const [name, setName] = useState("");
  const [target, setTarget] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState("通知未開");
  const seenAlert = useRef<string | null>(null);

  async function refresh() {
    const [nextItems, nextAlerts] = await Promise.all([listItems(), listAlerts()]);
    setItems(nextItems);
    setAlerts(nextAlerts);
    return nextAlerts;
  }

  useEffect(() => {
    if (!user?.id) return;
    let stop = false;
    void refresh().then((next) => {
      if (!stop) seenAlert.current = next.find((alert) => !alert.read)?.id ?? null;
    });
    return () => {
      stop = true;
    };
  }, [user?.id]);

  useEffect(() => {
    if (!user?.id) return;
    const poll = window.setInterval(() => {
      if (document.visibilityState !== "visible") return;
      void listAlerts().then((next) => {
        const fresh = next.find((alert) => !alert.read);
        if (
          fresh &&
          fresh.id !== seenAlert.current &&
          typeof Notification !== "undefined" &&
          Notification.permission === "granted"
        ) {
          new Notification("格價簿 · 低價", {
            body: `${fresh.productName} ${money(fresh.price)}${fresh.shop ? ` · ${fresh.shop}` : ""}`,
          });
        }
        if (fresh) seenAlert.current = fresh.id;
        setAlerts(next);
      });
    }, 90_000);
    const sweep = window.setInterval(() => {
      if (document.visibilityState !== "visible") return;
      void checkDue()
        .then(() => refresh())
        .catch(() => undefined);
    }, 20 * 60 * 1000);
    return () => {
      window.clearInterval(poll);
      window.clearInterval(sweep);
    };
  }, [user?.id]);

  useEffect(() => {
    if (typeof Notification === "undefined") {
      setNotice("呢個瀏覽器冇通知");
      return;
    }
    setNotice(Notification.permission === "granted" ? "瀏覽器通知已開" : "通知未開");
  }, []);

  async function onAdd(event: FormEvent) {
    event.preventDefault();
    setError(null);
    const targetHkd = target.trim() === "" ? null : Number(target);
    const result = await addItem({ data: { name, targetHkd } });
    if (!result.ok) {
      setError(result.error);
      return;
    }
    setName("");
    setTarget("");
    await refresh();
  }

  async function onCheck() {
    setBusy(true);
    setError(null);
    try {
      const result = await checkNow();
      await refresh();
      if (result.checked === 0) setError("清單入面冇開住監察嘅產品");
    } catch (err) {
      setError(err instanceof Error ? err.message : "格價失敗");
    } finally {
      setBusy(false);
    }
  }

  const unread = alerts.filter((alert) => !alert.read);

  return (
    <>
      <p className="max-w-xl text-sm text-muted">
        清單存在你個帳號。開住呢頁會定時再查；發布後伺服器每日 09:00（香港時間）再掃一次。低過目標價，或者比上次平至少 8%，就入提醒。
      </p>

      <form onSubmit={onAdd} className="grid gap-3 rounded-2xl border border-line bg-card p-4 sm:grid-cols-[1fr_9rem_auto]">
        <label className="block text-sm">
          <span className="mb-1 block text-muted">產品</span>
          <input
            value={name}
            onChange={(event) => setName(event.target.value)}
            placeholder="Sony WH-1000XM5"
            className="min-h-11 w-full rounded-xl border border-line bg-paper px-3 outline-none focus:border-ink"
          />
        </label>
        <label className="block text-sm">
          <span className="mb-1 block text-muted">目標價</span>
          <input
            inputMode="numeric"
            value={target}
            onChange={(event) => setTarget(event.target.value.replace(/[^\d]/g, ""))}
            placeholder="2000"
            className="min-h-11 w-full rounded-xl border border-line bg-paper px-3 outline-none focus:border-ink"
          />
        </label>
        <button
          type="submit"
          className="mt-auto inline-flex min-h-11 items-center justify-center gap-2 rounded-xl bg-signal px-4 text-sm font-medium text-card"
        >
          <Plus className="size-4" />
          加入
        </button>
      </form>

      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          disabled={busy}
          onClick={() => void onCheck()}
          className="inline-flex min-h-11 items-center gap-2 rounded-xl border border-ink bg-ink px-4 text-sm font-medium text-paper disabled:opacity-60"
        >
          <RefreshCw className={busy ? "size-4 animate-spin" : "size-4"} />
          {busy ? "格緊…" : "而家格價"}
        </button>
        <button
          type="button"
          onClick={() => {
            if (typeof Notification === "undefined") return;
            void Notification.requestPermission().then((permission) => {
              setNotice(permission === "granted" ? "瀏覽器通知已開" : "通知未開");
            });
          }}
          className="inline-flex min-h-11 items-center gap-2 rounded-xl border border-line bg-card px-4 text-sm"
        >
          <Bell className="size-4" />
          {notice}
        </button>
        {unread.length > 0 && (
          <button
            type="button"
            onClick={() => void markAlertsRead().then(refresh)}
            className="min-h-11 rounded-xl px-3 text-sm text-signal"
          >
            標示 {unread.length} 個已讀
          </button>
        )}
      </div>
      {error && <p className="text-sm text-signal">{error}</p>}

      {unread.length > 0 && (
        <section className="rounded-2xl border border-signal/30 bg-card p-4">
          <h2 className="font-display text-xl">低價提醒</h2>
          <ul className="mt-3 space-y-2">
            {unread.map((alert) => (
              <li key={alert.id} className="text-sm">
                <span className="font-medium">{alert.productName}</span>
                <span className="text-deal"> {money(alert.price)}</span>
                {alert.shop ? <span className="text-muted"> · {alert.shop}</span> : null}
                <span className="text-muted">
                  {" "}
                  · {alert.reason === "below_target" ? "低過目標" : "明顯回落"}
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}

      <section className="space-y-3">
        {items.length === 0 ? (
          <p className="rounded-2xl border border-dashed border-line px-4 py-10 text-center text-sm text-muted">
            未有產品。加一件，再撳「而家格價」。
          </p>
        ) : (
          items.map((item) => <ItemCard key={item.id} item={item} onChange={refresh} />)
        )}
      </section>
    </>
  );
}

function ItemCard({ item, onChange }: { item: WishlistItem; onChange: () => Promise<unknown> }) {
  const [target, setTarget] = useState(item.targetHkd ? String(item.targetHkd) : "");
  const delta =
    item.lastPrice != null && item.prevPrice != null ? item.lastPrice - item.prevPrice : null;
  const hit = item.lastPrice != null && item.targetHkd != null && item.lastPrice <= item.targetHkd;

  return (
    <article className="rounded-2xl border border-line bg-card p-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h3 className="font-display text-2xl leading-tight">{item.name}</h3>
          <p className="mt-1 text-sm text-muted">
            {item.lastCheckedAt ? `上次 ${when(item.lastCheckedAt)}` : "未檢查"}
            {item.monitor ? " · 監察中" : " · 已暫停"}
          </p>
        </div>
        <div className="text-right">
          <p className={hit ? "font-display text-3xl text-deal" : "font-display text-3xl"}>
            {item.lastPrice != null ? money(item.lastPrice) : "—"}
          </p>
          {delta != null && delta !== 0 && (
            <p className={delta < 0 ? "text-sm text-deal" : "text-sm text-signal"}>
              {delta < 0 ? `跌 ${money(Math.abs(delta))}` : `升 ${money(delta)}`}
            </p>
          )}
        </div>
      </div>
      {item.lastShop && (
        <p className="mt-2 text-sm">
          {item.lastUrl ? (
            <a href={item.lastUrl} target="_blank" rel="noreferrer" className="underline decoration-line underline-offset-4">
              {item.lastShop}
            </a>
          ) : (
            item.lastShop
          )}
          {hit && <span className="ml-2 text-deal">低過目標</span>}
        </p>
      )}
      {item.lastError && <p className="mt-2 text-sm text-warn">{item.lastError}</p>}
      {item.offers.length > 1 && (
        <ul className="mt-3 space-y-1 text-sm text-muted">
          {item.offers.slice(0, 4).map((offer) => (
            <li key={`${offer.url}-${offer.price}`} className="flex justify-between gap-3">
              <a href={offer.url} target="_blank" rel="noreferrer" className="truncate underline-offset-4 hover:underline">
                {offer.shop}
              </a>
              <span className="shrink-0 text-ink">{money(offer.price)}</span>
            </li>
          ))}
        </ul>
      )}
      <div className="mt-4 flex flex-wrap items-center gap-2">
        <label className="text-sm text-muted">
          低過
          <input
            inputMode="numeric"
            value={target}
            onChange={(event) => setTarget(event.target.value.replace(/[^\d]/g, ""))}
            onBlur={() => {
              const targetHkd = target === "" ? null : Number(target);
              void updateItem({
                data: { id: item.id, targetHkd, monitor: item.monitor },
              }).then(onChange);
            }}
            className="mx-2 min-h-11 w-28 rounded-xl border border-line bg-paper px-3 text-ink"
          />
        </label>
        <button
          type="button"
          onClick={() =>
            void updateItem({
              data: {
                id: item.id,
                targetHkd: target === "" ? null : Number(target),
                monitor: !item.monitor,
              },
            }).then(onChange)
          }
          className="min-h-11 rounded-xl border border-line px-3 text-sm"
        >
          {item.monitor ? "暫停監察" : "恢復監察"}
        </button>
        <button
          type="button"
          onClick={() => void removeItem({ data: item.id }).then(onChange)}
          className="inline-flex min-h-11 items-center gap-1 rounded-xl px-3 text-sm text-muted"
        >
          <Trash2 className="size-4" />
          刪除
        </button>
      </div>
    </article>
  );
}
