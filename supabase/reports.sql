-- ===========================================================================
-- What the shop actually earns.
--
-- The admin could already add up revenue, because the order carries its own
-- total. Profit needs the other half — what Ali paid for the subscription —
-- and the shop has never stored that anywhere.
--
-- It is recorded per order rather than per product because that is how this
-- shop really buys: a Netflix year costs what it costs on the day, from
-- whoever had it. A price list on the products page would be a number nobody
-- keeps current, and a profit figure computed from a stale one is worse than
-- no profit figure at all.
--
-- WHY THIS IS A SEPARATE TABLE, not a column on orders:
--
--   orders_read is `is_admin() or customer_id = auth.uid()`, so a customer can
--   read their own order row — every column of it. A cost column there would
--   be a customer reading, in one request, exactly what the shop makes on
--   them. There is no way to hide a column from a row-level policy, so the
--   number has to live somewhere they cannot select from at all.
--
-- Run once. Safe to run again.
-- ===========================================================================

create table if not exists public.order_costs (
  -- Keyed by code rather than id: it is unique, it is what the admin already
  -- holds for every order, and it is readable in the SQL editor.
  order_code text primary key references public.orders(code) on delete cascade,
  cost       numeric(10,2) not null default 0 check (cost >= 0),
  note       text not null default '',
  updated_at timestamptz not null default now(),
  updated_by uuid
);

alter table public.order_costs enable row level security;

-- Admins only, for every operation. No customer-facing policy exists, so a
-- customer's select returns nothing at all rather than an empty row they can
-- infer from.
drop policy if exists order_costs_admin on public.order_costs;
create policy order_costs_admin on public.order_costs for all
  to authenticated
  using (public.is_admin())
  with check (public.is_admin());

-- ---------------------------------------------------------------- check it
-- Expect one policy, and it must not read `true`.
select policyname, cmd, qual
  from pg_policies
 where schemaname = 'public' and tablename = 'order_costs';

-- And prove a customer cannot see it. Run this signed in as a customer: it
-- must return 0 rows, not an error.
--   select count(*) from public.order_costs;
