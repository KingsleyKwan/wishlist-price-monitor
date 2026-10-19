import { useEffect, useState, type FormEvent } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { Bell, Plus, RefreshCw, Trash2 } from "lucide-react";
import { copy, type Copy, type Lang } from "@/lib/copy";
import { quoteProducts } from "@/lib/wishlist.functions";
import {
  applyQuote,
  emptyBook,
  loadBook,
  recentSamePrice,
  saveBook,
  underTargetOffers,
  type Book,
  type WishlistItem,
} from "@/lib/wishlist-store";

export const Route = createFileRoute("/")({ component: Home });

function money(value: number) {
  return `HK$${value.toLocaleString("en-HK")}`;
}

function when(iso: string, lang: Lang) {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleString(lang === "zh" ? "zh-HK" : "en-HK", {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function Home() {
  const [ready, setReady] = useState(false);
  const [book, setBook] = useState<Book>(emptyBook);

  useEffect(() => {
    setBook(loadBook());
    setReady(true);
  }, []);

  useEffect(() => {
    if (ready) saveBook(book);
  }, [book, ready]);

  useEffect(() => {
    document.documentElement.lang = book.lang === "en" ? "en" : "zh-HK";
  }, [book.lang]);

  const t = copy[book.lang];

  return (
    <main className="min-h-screen bg-paper text-ink">
      <div className="mx-auto flex w-full max-w-3xl flex-col gap-6 px-4 py-6 sm:px-6">
        <header className="flex items-end justify-between gap-4 border-b border-line pb-4">
          <div>
            <p className="text-xs font-medium tracking-[0.18em] text-muted uppercase">{t.eyebrow}</p>
            <h1 className="font-display text-4xl leading-none font-medium tracking-tight">{t.brand}</h1>
          </div>
          <div className="flex rounded-full border border-line bg-card p-1 text-sm">
            <LangButton active={book.lang === "zh"} onClick={() => setBook({ ...book, lang: "zh" })}>
              繁
            </LangButton>
            <LangButton active={book.lang === "en"} onClick={() => setBook({ ...book, lang: "en" })}>
              EN
            </LangButton>
          </div>
        </header>
        {ready ? <Board book={book} setBook={setBook} t={t} /> : <div className="h-40 animate-pulse rounded-2xl bg-line" />}
      </div>
    </main>
  );
}

function LangButton({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={
        active
          ? "min-h-9 rounded-full bg-ink px-3 text-paper"
          : "min-h-9 rounded-full px-3 text-muted"
      }
    >
      {children}
    </button>
  );
}

function Board({
  book,
  setBook,
  t,
}: {
  book: Book;
  setBook: (book: Book) => void;
  t: Copy;
}) {
  const [name, setName] = useState("");
  const [target, setTarget] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notify, setNotify] = useState<"on" | "off" | "none">("off");

  useEffect(() => {
    if (typeof Notification === "undefined") {
      setNotify("none");
      return;
    }
    setNotify(Notification.permission === "granted" ? "on" : "off");
  }, []);

  useEffect(() => {
    const timer = window.setInterval(() => {
      if (document.visibilityState !== "visible") return;
      if (!book.items.some((item) => item.monitor)) return;
      void runCheck(false);
    }, 20 * 60 * 1000);
    return () => window.clearInterval(timer);
  }, [book]);

  function patch(next: Partial<Book>) {
    setBook({ ...book, ...next });
  }

  function onAdd(event: FormEvent) {
    event.preventDefault();
    setError(null);
    const trimmed = name.trim().slice(0, 120);
    if (trimmed.length < 2) {
      setError(t.nameShort);
      return;
    }
    const targetHkd = target.trim() === "" ? null : Number(target);
    if (target.trim() !== "" && (!Number.isInteger(targetHkd) || (targetHkd ?? 0) <= 0)) {
      setError(t.badTarget);
      return;
    }
    patch({
      items: [
        {
          id: crypto.randomUUID(),
          name: trimmed,
          targetHkd,
          monitor: true,
          lastPrice: null,
          prevPrice: null,
          lastShop: null,
          lastUrl: null,
          offers: [],
          lastCheckedAt: null,
          lastError: null,
        },
        ...book.items,
      ].slice(0, 40),
    });
    setName("");
    setTarget("");
  }

  async function runCheck(manual: boolean) {
    const watching = book.items.filter((item) => item.monitor);
    if (watching.length === 0) {
      if (manual) setError(t.noneWatched);
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const quotes = await quoteProducts({ data: { names: watching.map((item) => item.name) } });
      const byName = new Map(quotes.map((quote) => [quote.name, quote]));
      const alerts = [...book.alerts];
      const items = book.items.map((item) => {
        if (!item.monitor) return item;
        const quote = byName.get(item.name);
        if (!quote) return item;
        const applied = applyQuote(item, quote.offers, quote.error);
        if (applied.alert && !recentSamePrice(alerts, applied.alert)) {
          alerts.unshift(applied.alert);
          if (typeof Notification !== "undefined" && Notification.permission === "granted") {
            const why = applied.alert.reason === "below_target" ? t.belowTarget : t.dropped;
            new Notification(t.notifyTitle, {
              body: `${applied.alert.productName} ${money(applied.alert.price)} · ${why}${applied.alert.shop ? ` · ${applied.alert.shop}` : ""}`,
            });
          }
        }
        return applied.item;
      });
      const problems = items
        .filter((item) => item.lastError)
        .map((item) => `${item.name}：${reasonText(t, item.lastError)}`);
      if (problems.length > 0) setError(problems.join(" "));
      patch({ items, alerts: alerts.slice(0, 30) });
    } catch (err) {
      setError(err instanceof Error ? err.message : t.checkFailed);
    } finally {
      setBusy(false);
    }
  }

  const unread = book.alerts.filter((alert) => !alert.read);
  const notice = notify === "none" ? t.notifyNone : notify === "on" ? t.notifyOn : t.notifyOff;

  return (
    <>
      <p className="max-w-xl text-sm text-muted">{t.lead}</p>
      <form onSubmit={onAdd} className="grid gap-3 rounded-2xl border border-line bg-card p-4 sm:grid-cols-[1fr_9rem_auto]">
        <label className="block text-sm">
          <span className="mb-1 block text-muted">{t.product}</span>
          <input
            value={name}
            onChange={(event) => setName(event.target.value)}
            placeholder="Sony WH-1000XM5"
            className="min-h-11 w-full rounded-xl border border-line bg-paper px-3 outline-none focus:border-ink"
          />
        </label>
        <label className="block text-sm">
          <span className="mb-1 block text-muted">{t.target}</span>
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
          {t.add}
        </button>
      </form>

      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          disabled={busy}
          onClick={() => void runCheck(true)}
          className="inline-flex min-h-11 items-center gap-2 rounded-xl border border-ink bg-ink px-4 text-sm font-medium text-paper disabled:opacity-60"
        >
          <RefreshCw className={busy ? "size-4 animate-spin" : "size-4"} />
          {busy ? t.checking : t.check}
        </button>
        <button
          type="button"
          onClick={() => {
            if (typeof Notification === "undefined") return;
            void Notification.requestPermission().then((permission) => {
              setNotify(permission === "granted" ? "on" : "off");
            });
          }}
          className="inline-flex min-h-11 items-center gap-2 rounded-xl border border-line bg-card px-4 text-sm"
        >
          <Bell className="size-4" />
          {notice}
        </button>
        <span className="text-sm text-muted">{t.savedHere}</span>
        {unread.length > 0 && (
          <button
            type="button"
            onClick={() => patch({ alerts: book.alerts.map((alert) => ({ ...alert, read: true })) })}
            className="min-h-11 rounded-xl px-3 text-sm text-signal"
          >
            {t.markRead(unread.length)}
          </button>
        )}
      </div>
      {error && <p className="text-sm text-signal">{error}</p>}

      {unread.length > 0 && (
        <section className="rounded-2xl border border-signal/30 bg-card p-4">
          <h2 className="font-display text-xl">{t.alerts}</h2>
          <ul className="mt-3 space-y-2">
            {unread.map((alert) => (
              <li key={alert.id} className="text-sm">
                <span className="font-medium">{alert.productName}</span>
                <span className="text-deal"> {money(alert.price)}</span>
                {alert.shop ? <span className="text-muted"> · {alert.shop}</span> : null}
                <span className="text-muted"> · {alert.reason === "below_target" ? t.belowTarget : t.dropped}</span>
              </li>
            ))}
          </ul>
        </section>
      )}

      <section className="space-y-3">
        {book.items.length === 0 ? (
          <p className="rounded-2xl border border-dashed border-line px-4 py-10 text-center text-sm text-muted">{t.empty}</p>
        ) : (
          book.items.map((item) => (
            <ItemCard
              key={item.id}
              item={item}
              lang={book.lang}
              t={t}
              onTarget={(targetHkd) =>
                patch({
                  items: book.items.map((row) => (row.id === item.id ? { ...row, targetHkd } : row)),
                })
              }
              onMonitor={() =>
                patch({
                  items: book.items.map((row) => (row.id === item.id ? { ...row, monitor: !row.monitor } : row)),
                })
              }
              onRemove={() =>
                patch({
                  items: book.items.filter((row) => row.id !== item.id),
                  alerts: book.alerts.filter((alert) => alert.itemId !== item.id),
                })
              }
            />
          ))
        )}
      </section>
    </>
  );
}

function reasonText(t: Copy, error: WishlistItem["lastError"]) {
  if (error === "blocked") return t.blocked;
  if (error === "timeout") return t.timeout;
  if (error === "empty") return t.emptyQuote;
  return t.failed;
}

function ItemCard({
  item,
  lang,
  t,
  onTarget,
  onMonitor,
  onRemove,
}: {
  item: WishlistItem;
  lang: Lang;
  t: Copy;
  onTarget: (targetHkd: number | null) => void;
  onMonitor: () => void;
  onRemove: () => void;
}) {
  const [target, setTarget] = useState(item.targetHkd ? String(item.targetHkd) : "");
  const [note, setNote] = useState<string | null>(null);
  const delta = item.lastPrice != null && item.prevPrice != null ? item.lastPrice - item.prevPrice : null;
  const hit = item.lastPrice != null && item.targetHkd != null && item.lastPrice <= item.targetHkd;
  const parsed = target.trim() === "" ? null : Number(target);
  const dirty = parsed !== item.targetHkd;

  useEffect(() => {
    setTarget(item.targetHkd ? String(item.targetHkd) : "");
  }, [item.targetHkd]);

  return (
    <article className="rounded-2xl border border-line bg-card p-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h3 className="font-display text-2xl leading-tight">{item.name}</h3>
          <p className="mt-1 text-sm text-muted">
            {item.lastCheckedAt ? `${t.last} ${when(item.lastCheckedAt, lang)}` : t.notChecked}
            {item.monitor ? ` · ${t.watching}` : ` · ${t.paused}`}
          </p>
        </div>
        <div className="text-right">
          <p className={hit ? "font-display text-3xl text-deal" : "font-display text-3xl"}>
            {item.lastPrice != null ? money(item.lastPrice) : "—"}
          </p>
          {delta != null && delta !== 0 && (
            <p className={delta < 0 ? "text-sm text-deal" : "text-sm text-signal"}>
              {delta < 0 ? t.fell(money(Math.abs(delta))) : t.rose(money(delta))}
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
          {hit && <span className="ml-2 text-deal">{t.belowTarget}</span>}
          {!hit && item.targetHkd != null && item.lastPrice != null && item.lastPrice > item.targetHkd && (
            <span className="ml-2 text-signal">
              {t.overTarget} {money(item.lastPrice - item.targetHkd)}
            </span>
          )}
        </p>
      )}
      {item.lastError && <p className="mt-2 text-sm text-warn">{reasonText(t, item.lastError)}</p>}
      {underTargetOffers(item.offers, item.targetHkd).length > 0 && (
        <div className="mt-3">
          <p className="text-sm text-deal">{t.underList}</p>
          <ul className="mt-1 space-y-1 text-sm text-muted">
            {underTargetOffers(item.offers, item.targetHkd).map((offer) => (
              <li key={`${offer.url}-${offer.price}`} className="flex justify-between gap-3">
                <a href={offer.url} target="_blank" rel="noreferrer" className="truncate underline-offset-4 hover:underline">
                  {offer.shop}
                </a>
                <span className="shrink-0 text-ink">{money(offer.price)}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
      <div className="mt-4 flex flex-wrap items-center gap-2">
        <label className="text-sm text-muted">
          {t.under}
          <input
            inputMode="numeric"
            value={target}
            onChange={(event) => {
              setNote(null);
              setTarget(event.target.value.replace(/[^\d]/g, ""));
            }}
            className="mx-2 min-h-11 w-28 rounded-xl border border-line bg-paper px-3 text-ink"
          />
        </label>
        <button
          type="button"
          disabled={!dirty}
          onClick={() => {
            if (target.trim() !== "" && (!Number.isInteger(parsed) || (parsed ?? 0) <= 0)) {
              setNote(t.badTarget);
              return;
            }
            setNote(null);
            onTarget(parsed);
          }}
          className="min-h-11 rounded-xl bg-ink px-3 text-sm text-paper disabled:opacity-40"
        >
          {t.change}
        </button>
        <button type="button" onClick={onMonitor} className="min-h-11 rounded-xl border border-line px-3 text-sm">
          {item.monitor ? t.pause : t.resume}
        </button>
        <button
          type="button"
          onClick={onRemove}
          className="inline-flex min-h-11 items-center gap-1 rounded-xl px-3 text-sm text-muted"
        >
          <Trash2 className="size-4" />
          {t.remove}
        </button>
      </div>
      {note && <p className="mt-2 text-sm text-signal">{note}</p>}
    </article>
  );
}
