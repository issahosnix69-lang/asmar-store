-- The Asmar Store — database schema
-- Run this once in the Supabase dashboard: SQL Editor -> New query -> Run.
--
-- Security model:
--   * anyone (anon) may READ products and settings, and PLACE an order
--   * only a signed-in admin may read orders, or change products/settings
--   * order totals are computed on the server, never trusted from the browser

-- ---------------------------------------------------------------- products
create table if not exists public.products (
  id          text primary key,
  name        text        not null,
  category    text        not null default '',
  note        text        not null default '',
  description text        not null default '',
  warranty_days integer   not null default 30,
  image       text        not null default '',
  active      boolean     not null default false,
  featured    boolean     not null default false,
  variants    jsonb       not null default '[]'::jsonb,
  position    integer     not null default 0,
  updated_at  timestamptz not null default now()
);

-- Safe to re-run on a database created before these columns existed.
alter table public.products add column if not exists featured      boolean not null default false;
alter table public.products add column if not exists description   text    not null default '';
alter table public.products add column if not exists warranty_days integer not null default 30;
-- Arabic versions of the owner-written copy. Blank means "fall back to English".
alter table public.products add column if not exists note_ar        text not null default '';
alter table public.products add column if not exists description_ar text not null default '';

-- ---------------------------------------------------------------- settings
-- Single row, id is pinned to 1 so there can only ever be one.
create table if not exists public.settings (
  id              integer primary key default 1 check (id = 1),
  whatsapp        text  not null default '',
  whish_note      text  not null default '',
  omt_note        text  not null default '',
  categories      jsonb not null default '[]'::jsonb,
  category_images jsonb not null default '{}'::jsonb,
  category_notes  jsonb not null default '{}'::jsonb,
  hero_title      text  not null default '',
  hero_sub        text  not null default '',
  socials         jsonb not null default '{}'::jsonb,
  faq             jsonb not null default '[]'::jsonb,
  reviews         jsonb not null default '[]'::jsonb,
  pages           jsonb not null default '{}'::jsonb,
  -- False until the owner saves for the first time. While false the app shows
  -- the bundled defaults; after it, the row is the truth even where it is empty,
  -- so a field the owner clears on purpose stays cleared.
  initialized     boolean not null default false,
  updated_at      timestamptz not null default now()
);

-- Safe to re-run on a database created before these columns existed.
alter table public.settings add column if not exists category_notes jsonb not null default '{}'::jsonb;
alter table public.settings add column if not exists hero_title     text  not null default '';
alter table public.settings add column if not exists hero_sub       text  not null default '';
alter table public.settings add column if not exists socials        jsonb not null default '{}'::jsonb;
alter table public.settings add column if not exists faq            jsonb not null default '[]'::jsonb;
alter table public.settings add column if not exists reviews        jsonb not null default '[]'::jsonb;
alter table public.settings add column if not exists pages          jsonb not null default '{}'::jsonb;
-- Arabic versions of the owner-written copy. Blank means "fall back to English".
alter table public.settings add column if not exists pages_ar          jsonb not null default '{}'::jsonb;
alter table public.settings add column if not exists category_notes_ar jsonb not null default '{}'::jsonb;
alter table public.settings add column if not exists category_names_ar jsonb not null default '{}'::jsonb;
-- Existing shops have already been saved, so they count as initialized.
alter table public.settings add column if not exists initialized boolean not null default false;
update public.settings set initialized = true where id = 1 and jsonb_array_length(categories) > 0;

insert into public.settings (id) values (1) on conflict (id) do nothing;

-- ------------------------------------------------------------------ orders
create table if not exists public.orders (
  id         uuid        primary key default gen_random_uuid(),
  code       text        not null unique,
  items      jsonb       not null,
  total      numeric(10,2) not null,
  customer   jsonb       not null,
  status     text        not null default 'New',
  created_at timestamptz not null default now()
);

create index if not exists orders_created_at_idx on public.orders (created_at desc);

-- ------------------------------------------------------------ row security
alter table public.products enable row level security;
alter table public.settings enable row level security;
alter table public.orders   enable row level security;

-- Products: world-readable, admin-writable.
drop policy if exists products_read     on public.products;
drop policy if exists products_write    on public.products;
create policy products_read  on public.products for select using (true);
create policy products_write on public.products for all
  to authenticated using (true) with check (true);

-- Settings: world-readable, admin-writable.
drop policy if exists settings_read  on public.settings;
drop policy if exists settings_write on public.settings;
create policy settings_read  on public.settings for select using (true);
create policy settings_write on public.settings for all
  to authenticated using (true) with check (true);

-- Orders: no direct anon access at all. Customers reach them only through
-- place_order() below, which runs as the definer. This is what stops one
-- customer reading another customer's name, phone and email.
drop policy if exists orders_admin_read  on public.orders;
drop policy if exists orders_admin_write on public.orders;
create policy orders_admin_read  on public.orders for select
  to authenticated using (true);
create policy orders_admin_write on public.orders for update
  to authenticated using (true) with check (true);

-- -------------------------------------------------------------- place_order
-- Recomputes every line total from the products table, so a tampered price
-- in the browser cannot change what the order is worth. Also mints the
-- order code server-side.
create or replace function public.place_order(p_items jsonb, p_customer jsonb)
returns public.orders
language plpgsql
security definer
set search_path = public
as $$
declare
  v_item      jsonb;
  v_product   public.products%rowtype;
  v_variant   jsonb;
  v_price     numeric(10,2);
  v_qty       integer;
  v_lines     jsonb := '[]'::jsonb;
  v_total     numeric(10,2) := 0;
  v_code      text;
  v_order     public.orders%rowtype;
begin
  if jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 then
    raise exception 'Your order is empty.';
  end if;
  if jsonb_array_length(p_items) > 50 then
    raise exception 'Too many items in one order.';
  end if;

  if coalesce(trim(p_customer->>'name'), '')  = ''
     or coalesce(trim(p_customer->>'phone'), '') = ''
     or coalesce(trim(p_customer->>'email'), '') = '' then
    raise exception 'Name, WhatsApp number and email are all required.';
  end if;

  for v_item in select * from jsonb_array_elements(p_items) loop
    select * into v_product from public.products
      where id = (v_item->>'id') and active = true;
    if not found then
      raise exception 'That product is no longer available.';
    end if;

    -- Find the requested plan on the product and take ITS price.
    select value into v_variant
      from jsonb_array_elements(v_product.variants)
      where value->>'label' = (v_item->>'label')
      limit 1;
    if v_variant is null then
      raise exception 'That plan is no longer available.';
    end if;

    v_qty := greatest(1, least(99, coalesce((v_item->>'qty')::integer, 1)));
    v_price := (v_variant->>'price')::numeric;
    v_total := v_total + (v_price * v_qty);

    v_lines := v_lines || jsonb_build_object(
      'key',   v_product.id || '|' || (v_variant->>'label'),
      'id',    v_product.id,
      'name',  v_product.name,
      'label', v_variant->>'label',
      'price', v_price,
      'qty',   v_qty
    );
  end loop;

  v_code := 'ASM-' || upper(substr(encode(gen_random_bytes(6), 'hex'), 1, 4))
                   || '-' || upper(substr(encode(gen_random_bytes(6), 'hex'), 1, 3));

  insert into public.orders (code, items, total, customer, status)
  values (
    v_code, v_lines, v_total,
    jsonb_build_object(
      'name',    left(trim(p_customer->>'name'), 120),
      'phone',   left(trim(p_customer->>'phone'), 40),
      'email',   left(trim(p_customer->>'email'), 160),
      'payment', coalesce(p_customer->>'payment', 'cod'),
      'notes',   left(coalesce(p_customer->>'notes', ''), 500)
    ),
    case when p_customer->>'payment' = 'online' then 'Awaiting payment' else 'New' end
  )
  returning * into v_order;

  return v_order;
end;
$$;

revoke all on function public.place_order(jsonb, jsonb) from public;
grant execute on function public.place_order(jsonb, jsonb) to anon, authenticated;
