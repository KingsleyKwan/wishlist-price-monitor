# Wishlist price monitor

Web app that stores a private wishlist, checks public Hong Kong prices, and alerts you when a price hits your target or drops.

## What it does

- Sign in, then add products with an optional target price in HKD.
- Each check searches public results for `HK$` prices and keeps the cheapest relevant offer.
- An alert is written when the best price is at or under the target, or when it falls by at least HK$50 and 8%.
- The same price is not alerted again within 20 hours.
- A daily job hits `GET /api/cron/prices` and sweeps items not checked in the last 12 hours.

## Layout

```
src/routes/index.tsx            wishlist board
src/routes/login.tsx            sign in
src/lib/wishlist.functions.ts   add, list, check, dismiss
src/lib/prices.server.ts        search and parse prices
src/lib/monitor.server.ts       save the best offer and write alerts
src/routes/api/cron/prices.ts   scheduled sweep
migrations/0002_wishlist.sql    wishlist and alert tables
```

## Run

```bash
npm install
npm run dev
```

The dev server listens on port 8080. Price checks need outbound network access. Deployed builds use Neon for the database; local runs can use the bundled PGlite fallback.
