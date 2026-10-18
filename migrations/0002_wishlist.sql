create table if not exists wishlist_items (
  id text primary key,
  user_id text not null,
  name text not null,
  target_hkd integer,
  monitor boolean not null default true,
  last_price integer,
  prev_price integer,
  last_shop text,
  last_url text,
  last_title text,
  offers_json text not null default '[]',
  last_checked_at timestamptz,
  last_error text,
  created_at timestamptz not null default now()
);

create index if not exists wishlist_items_user_idx on wishlist_items (user_id);
create index if not exists wishlist_items_due_idx on wishlist_items (monitor, last_checked_at);

create table if not exists price_alerts (
  id text primary key,
  user_id text not null,
  item_id text not null,
  product_name text not null,
  price integer not null,
  shop text,
  url text,
  reason text not null,
  read boolean not null default false,
  created_at timestamptz not null default now()
);

create index if not exists price_alerts_user_idx on price_alerts (user_id, created_at desc);
