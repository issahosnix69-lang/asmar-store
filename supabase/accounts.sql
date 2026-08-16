-- The Asmar Store — customer accounts and balances
-- Run AFTER schema.sql and payments.sql, in the Supabase SQL editor.
--
-- Security model, in one paragraph:
--   * "authenticated" no longer means "admin" — admins are rows in public.admins
--   * a customer can read their own profile, wallet, top-ups and orders, nothing else
--   * NOBODY can write to the wallet directly, not even an admin. Every credit and
--     debit goes through a SECURITY DEFINER function, so the balance can only move
--     in ways this file allows.
--   * balances are a ledger, not a number. wallet_entries is append-only and the
--     balance is its sum, so a wrong balance can always be traced to an entry.

-- gen_random_bytes() below comes from pgcrypto, which Supabase installs into
-- the `extensions` schema. The functions that use it therefore declare
-- `search_path = public, extensions` — without that they raise
-- "function gen_random_bytes(integer) does not exist" at call time, long
-- after this script reported success.
create extension if not exists pgcrypto with schema extensions;

-- ==================================================================== admins
create table if not exists public.admins (
  user_id    uuid primary key references auth.users(id) on delete cascade,
  created_at timestamptz not null default now()
);

alter table public.admins enable row level security;

drop policy if exists admins_self on public.admins;
create policy admins_self on public.admins for select
  to authenticated using (user_id = auth.uid());

-- Definer so it can read admins even though the caller cannot.
create or replace function public.is_admin()
returns boolean
language sql stable security definer set search_path = public
as $$ select exists (select 1 from public.admins a where a.user_id = auth.uid()); $$;

revoke all on function public.is_admin() from public;
grant execute on function public.is_admin() to anon, authenticated;

-- ⚠ BOOTSTRAP: create your admin user in Authentication → Users first, then run
-- this once with your own email. Until you do, nothing is writable in the admin.
--
--   insert into public.admins (user_id)
--   select id from auth.users where email = 'you@example.com'
--   on conflict do nothing;

-- ------------------------------------------- tighten the pre-account policies
-- These used to say "any signed-in user". That was fine when the only account
-- was the owner's; it stops being fine the moment customers can sign in.
drop policy if exists products_write on public.products;
create policy products_write on public.products for all
  to authenticated using (public.is_admin()) with check (public.is_admin());

drop policy if exists settings_write on public.settings;
create policy settings_write on public.settings for all
  to authenticated using (public.is_admin()) with check (public.is_admin());

-- ---------------------------------------------------- orders know their owner
-- Up here rather than beside the order policies below, because my_account()
-- reads these columns and is defined before that section.
alter table public.orders add column if not exists customer_id uuid
  references auth.users(id) on delete set null;
alter table public.orders add column if not exists payment_status text not null default 'unpaid';
alter table public.orders add column if not exists paid_at timestamptz;

create index if not exists orders_customer_idx on public.orders (customer_id, created_at desc);

drop policy if exists orders_admin_read  on public.orders;
drop policy if exists orders_admin_write on public.orders;
drop policy if exists orders_read        on public.orders;
drop policy if exists orders_write       on public.orders;
create policy orders_read on public.orders for select
  to authenticated using (public.is_admin() or customer_id = auth.uid());
create policy orders_write on public.orders for update
  to authenticated using (public.is_admin()) with check (public.is_admin());

-- ================================================================= customers
create table if not exists public.customers (
  id         uuid primary key references auth.users(id) on delete cascade,
  name       text not null default '',
  phone      text not null default '',
  email      text not null default '',
  note       text not null default '',      -- the owner's private note, never shown
  active     boolean not null default true,
  created_at timestamptz not null default now()
);

alter table public.customers enable row level security;

drop policy if exists customers_read  on public.customers;
drop policy if exists customers_self  on public.customers;
drop policy if exists customers_admin on public.customers;
create policy customers_read on public.customers for select
  to authenticated using (id = auth.uid() or public.is_admin());
-- A customer may correct their own name and phone, nothing else on the row.
create policy customers_self on public.customers for update
  to authenticated using (id = auth.uid()) with check (id = auth.uid());
create policy customers_admin on public.customers for all
  to authenticated using (public.is_admin()) with check (public.is_admin());

-- A profile row appears the moment the account is created, whether that was
-- done from the admin panel or by hand in the Supabase dashboard.
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public
as $$
begin
  insert into public.customers (id, email, name, phone)
  values (
    new.id,
    coalesce(new.email, ''),
    coalesce(new.raw_user_meta_data->>'name', ''),
    coalesce(new.raw_user_meta_data->>'phone', '')
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- Backfill for accounts that already existed before this file was run.
insert into public.customers (id, email)
select id, coalesce(email, '') from auth.users
on conflict (id) do nothing;

-- ============================================================ wallet ledger
-- Append-only. Positive is money in, negative is money out.
create table if not exists public.wallet_entries (
  id          bigserial primary key,
  customer_id uuid not null references auth.users(id) on delete cascade,
  amount      numeric(10,2) not null,
  kind        text not null check (kind in ('topup','order','refund','adjustment')),
  ref         text not null default '',     -- order code or top-up reference
  note        text not null default '',
  created_by  uuid,                          -- the admin who caused it, if any
  created_at  timestamptz not null default now()
);

create index if not exists wallet_entries_customer_idx
  on public.wallet_entries (customer_id, created_at desc);

alter table public.wallet_entries enable row level security;

-- Read-only to everyone, including admins. Writes happen inside the functions
-- below and nowhere else — that is the whole point of the table.
drop policy if exists wallet_read on public.wallet_entries;
create policy wallet_read on public.wallet_entries for select
  to authenticated using (customer_id = auth.uid() or public.is_admin());

-- ================================================================== top-ups
create table if not exists public.topups (
  id          uuid primary key default gen_random_uuid(),
  ref         text not null unique,
  customer_id uuid not null references auth.users(id) on delete cascade,
  amount      numeric(10,2) not null check (amount > 0 and amount <= 5000),
  method      text not null default 'whish',
  receipt     text not null default '',      -- downscaled screenshot, data URL
  status      text not null default 'pending' check (status in ('pending','approved','rejected')),
  admin_note  text not null default '',
  created_at  timestamptz not null default now(),
  decided_at  timestamptz,
  decided_by  uuid
);

create index if not exists topups_status_idx  on public.topups (status, created_at desc);
create index if not exists topups_customer_idx on public.topups (customer_id, created_at desc);

alter table public.topups enable row level security;

drop policy if exists topups_read on public.topups;
create policy topups_read on public.topups for select
  to authenticated using (customer_id = auth.uid() or public.is_admin());
-- No insert or update policy on purpose: submit_topup() and the decide
-- functions are the only ways in, so an amount can never be edited after the
-- fact and a customer can never approve their own request.

-- =============================================================== the balance
create or replace function public.wallet_balance(p_customer uuid default null)
returns numeric
language plpgsql stable security definer set search_path = public
as $$
declare
  v_target uuid := coalesce(p_customer, auth.uid());
begin
  if v_target is null then return 0; end if;
  if v_target <> auth.uid() and not public.is_admin() then
    raise exception 'Not allowed.';
  end if;
  return coalesce((select sum(amount) from public.wallet_entries where customer_id = v_target), 0);
end;
$$;

revoke all on function public.wallet_balance(uuid) from public;
grant execute on function public.wallet_balance(uuid) to authenticated;

-- Everything the account page needs, in one round trip.
create or replace function public.my_account()
returns jsonb
language plpgsql stable security definer set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
begin
  if v_uid is null then raise exception 'Sign in first.'; end if;

  return jsonb_build_object(
    'profile', (
      select to_jsonb(c) - 'note' from public.customers c where c.id = v_uid
    ),
    'isAdmin', public.is_admin(),
    'balance', coalesce((select sum(amount) from public.wallet_entries where customer_id = v_uid), 0),
    'entries', coalesce((
      select jsonb_agg(e order by e.created_at desc) from (
        select id, amount, kind, ref, note, created_at
        from public.wallet_entries where customer_id = v_uid
        order by created_at desc limit 50
      ) e
    ), '[]'::jsonb),
    'topups', coalesce((
      select jsonb_agg(t order by t.created_at desc) from (
        -- the receipt itself is deliberately left out: the customer already
        -- has the picture, and it is the heaviest column in the database
        select id, ref, amount, method, status, admin_note, created_at, decided_at
        from public.topups where customer_id = v_uid
        order by created_at desc limit 25
      ) t
    ), '[]'::jsonb),
    'orders', coalesce((
      select jsonb_agg(o order by o.created_at desc) from (
        select code, items, total, status, payment_status, created_at
        from public.orders where customer_id = v_uid
        order by created_at desc limit 25
      ) o
    ), '[]'::jsonb)
  );
end;
$$;

revoke all on function public.my_account() from public;
grant execute on function public.my_account() to authenticated;

-- ========================================================== submit a top-up
create or replace function public.submit_topup(
  p_amount  numeric,
  p_method  text,
  p_receipt text
)
returns public.topups
language plpgsql security definer set search_path = public, extensions
as $$
declare
  v_uid     uuid := auth.uid();
  v_pending integer;
  v_row     public.topups%rowtype;
begin
  if v_uid is null then raise exception 'Sign in first.'; end if;
  if not exists (select 1 from public.customers where id = v_uid and active) then
    raise exception 'This account is not active. Message us on WhatsApp.';
  end if;

  if p_amount is null or p_amount <= 0 then
    raise exception 'Enter the amount you transferred.';
  end if;
  if p_amount > 5000 then
    raise exception 'That amount is too large to submit online — message us instead.';
  end if;

  -- A screenshot is the only evidence the owner has, so it is required.
  if coalesce(p_receipt, '') = '' then
    raise exception 'Attach a picture of the transfer.';
  end if;
  -- Roughly 700 KB of base64. The client downscales long before this; the check
  -- is here so a crafted request cannot fill the table.
  if length(p_receipt) > 700000 then
    raise exception 'That picture is too large.';
  end if;

  -- Somebody spamming requests would bury the real ones in the admin.
  select count(*) into v_pending
    from public.topups where customer_id = v_uid and status = 'pending';
  if v_pending >= 5 then
    raise exception 'You already have 5 top-ups waiting. Please wait for those first.';
  end if;

  insert into public.topups (ref, customer_id, amount, method, receipt)
  values (
    'TOP-' || upper(substr(encode(gen_random_bytes(6), 'hex'), 1, 4))
           || '-' || upper(substr(encode(gen_random_bytes(6), 'hex'), 1, 3)),
    v_uid,
    round(p_amount, 2),
    coalesce(nullif(trim(p_method), ''), 'whish'),
    p_receipt
  )
  returning * into v_row;

  -- Never echo the receipt back; the caller just uploaded it.
  v_row.receipt := '';
  return v_row;
end;
$$;

revoke all on function public.submit_topup(numeric, text, text) from public;
grant execute on function public.submit_topup(numeric, text, text) to authenticated;

-- ======================================================= decide on a top-up
-- Idempotent: a double-click cannot credit the same transfer twice, because
-- the status check and the ledger insert happen in one transaction.
create or replace function public.approve_topup(p_id uuid, p_note text default '')
returns public.topups
language plpgsql security definer set search_path = public
as $$
declare v_row public.topups%rowtype;
begin
  if not public.is_admin() then raise exception 'Not allowed.'; end if;

  select * into v_row from public.topups where id = p_id for update;
  if not found then raise exception 'That top-up does not exist.'; end if;
  if v_row.status <> 'pending' then
    raise exception 'That top-up was already %.', v_row.status;
  end if;

  insert into public.wallet_entries (customer_id, amount, kind, ref, note, created_by)
  values (v_row.customer_id, v_row.amount, 'topup', v_row.ref,
          left(coalesce(p_note, ''), 300), auth.uid());

  update public.topups
     set status = 'approved', admin_note = left(coalesce(p_note, ''), 300),
         decided_at = now(), decided_by = auth.uid()
   where id = p_id
  returning * into v_row;

  v_row.receipt := '';
  return v_row;
end;
$$;

create or replace function public.reject_topup(p_id uuid, p_note text default '')
returns public.topups
language plpgsql security definer set search_path = public
as $$
declare v_row public.topups%rowtype;
begin
  if not public.is_admin() then raise exception 'Not allowed.'; end if;

  select * into v_row from public.topups where id = p_id for update;
  if not found then raise exception 'That top-up does not exist.'; end if;
  if v_row.status <> 'pending' then
    raise exception 'That top-up was already %.', v_row.status;
  end if;

  update public.topups
     set status = 'rejected', admin_note = left(coalesce(p_note, ''), 300),
         decided_at = now(), decided_by = auth.uid()
   where id = p_id
  returning * into v_row;

  v_row.receipt := '';
  return v_row;
end;
$$;

revoke all on function public.approve_topup(uuid, text) from public;
revoke all on function public.reject_topup(uuid, text) from public;
grant execute on function public.approve_topup(uuid, text) to authenticated;
grant execute on function public.reject_topup(uuid, text) to authenticated;

-- ================================================= manual balance adjustment
-- For refunds, goodwill, and correcting a mistake. Signed: negative takes money
-- back out. Always leaves a ledger row with the admin's name on it.
create or replace function public.adjust_balance(
  p_customer uuid, p_amount numeric, p_note text default ''
)
returns numeric
language plpgsql security definer set search_path = public
as $$
begin
  if not public.is_admin() then raise exception 'Not allowed.'; end if;
  if p_amount is null or p_amount = 0 then raise exception 'Enter an amount.'; end if;
  if abs(p_amount) > 5000 then raise exception 'That adjustment is too large.'; end if;
  if not exists (select 1 from public.customers where id = p_customer) then
    raise exception 'No such customer.';
  end if;

  insert into public.wallet_entries (customer_id, amount, kind, ref, note, created_by)
  values (p_customer, round(p_amount, 2), 'adjustment', '',
          left(coalesce(p_note, ''), 300), auth.uid());

  return coalesce((select sum(amount) from public.wallet_entries where customer_id = p_customer), 0);
end;
$$;

revoke all on function public.adjust_balance(uuid, numeric, text) from public;
grant execute on function public.adjust_balance(uuid, numeric, text) to authenticated;

-- ================================================ admin lists (one round trip)
create or replace function public.admin_customers()
returns jsonb
language plpgsql stable security definer set search_path = public
as $$
begin
  if not public.is_admin() then raise exception 'Not allowed.'; end if;
  return coalesce((
    select jsonb_agg(x order by x.created_at desc) from (
      select c.id, c.name, c.phone, c.email, c.note, c.active, c.created_at,
             coalesce((select sum(amount) from public.wallet_entries w
                        where w.customer_id = c.id), 0) as balance,
             coalesce((select count(*) from public.orders o
                        where o.customer_id = c.id), 0)  as orders
        from public.customers c
    ) x
  ), '[]'::jsonb);
end;
$$;

-- Pending requests carry their screenshot; decided ones do not, because the
-- history list would otherwise pull every image ever uploaded.
create or replace function public.admin_topups(p_status text default 'pending')
returns jsonb
language plpgsql stable security definer set search_path = public
as $$
begin
  if not public.is_admin() then raise exception 'Not allowed.'; end if;

  if p_status = 'pending' then
    return coalesce((
      select jsonb_agg(x order by x.created_at asc) from (
        select t.id, t.ref, t.amount, t.method, t.receipt, t.status, t.created_at,
               c.name, c.phone, c.email
          from public.topups t join public.customers c on c.id = t.customer_id
         where t.status = 'pending'
      ) x
    ), '[]'::jsonb);
  end if;

  return coalesce((
    select jsonb_agg(x order by x.created_at desc) from (
      select t.id, t.ref, t.amount, t.method, t.status, t.admin_note,
             t.created_at, t.decided_at, c.name, c.phone, c.email
        from public.topups t join public.customers c on c.id = t.customer_id
       where t.status <> 'pending'
       order by t.created_at desc limit 100
    ) x
  ), '[]'::jsonb);
end;
$$;

create or replace function public.admin_pending_topups()
returns integer
language sql stable security definer set search_path = public
as $$ select case when public.is_admin()
                  then (select count(*)::integer from public.topups where status = 'pending')
                  else 0 end; $$;

revoke all on function public.admin_customers() from public;
revoke all on function public.admin_topups(text) from public;
revoke all on function public.admin_pending_topups() from public;
grant execute on function public.admin_customers() to authenticated;
grant execute on function public.admin_topups(text) to authenticated;
grant execute on function public.admin_pending_topups() to authenticated;

-- ======================================================= place_order, redone
-- Supersedes the two-argument version in schema.sql. Same price-recomputation
-- guarantee, plus: it records who placed the order, and it can pay from the
-- wallet atomically — the balance check and the debit are in one transaction,
-- so two tabs cannot spend the same dollar twice.
drop function if exists public.place_order(jsonb, jsonb);

create or replace function public.place_order(
  p_items        jsonb,
  p_customer     jsonb,
  p_use_balance  boolean default false
)
returns public.orders
language plpgsql security definer set search_path = public, extensions
as $$
declare
  v_item     jsonb;
  v_product  public.products%rowtype;
  v_variant  jsonb;
  v_price    numeric(10,2);
  v_qty      integer;
  v_lines    jsonb := '[]'::jsonb;
  v_total    numeric(10,2) := 0;
  v_code     text;
  v_order    public.orders%rowtype;
  v_uid      uuid := auth.uid();
  v_balance  numeric(10,2);
  v_payment  text := coalesce(p_customer->>'payment', 'cod');
  v_status   text;
begin
  -- Ordering needs an account. Enforced here rather than only in the checkout
  -- screen, because a hidden button is not a rule — anyone can call the RPC.
  if v_uid is null then
    raise exception 'Sign in to place an order.';
  end if;
  if not exists (select 1 from public.customers where id = v_uid and active) then
    raise exception 'This account is not active. Message us on WhatsApp.';
  end if;

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

  if p_use_balance then
    if v_uid is null then
      raise exception 'Sign in to pay from your balance.';
    end if;
    -- Lock the customer row first. Two orders placed at the same moment then
    -- queue behind each other instead of both reading the same balance.
    perform 1 from public.customers where id = v_uid for update;
    select coalesce(sum(amount), 0) into v_balance
      from public.wallet_entries where customer_id = v_uid;
    if v_balance < v_total then
      raise exception 'Not enough balance. You have % and this order is %.', v_balance, v_total;
    end if;
    v_payment := 'balance';
  end if;

  v_code := 'ASM-' || upper(substr(encode(gen_random_bytes(6), 'hex'), 1, 4))
                   || '-' || upper(substr(encode(gen_random_bytes(6), 'hex'), 1, 3));

  v_status := case
    when p_use_balance then 'New'
    when v_payment = 'online' then 'Awaiting payment'
    else 'New' end;

  insert into public.orders (code, items, total, customer, status, customer_id,
                             payment_status, paid_at)
  values (
    v_code, v_lines, v_total,
    jsonb_build_object(
      'name',    left(trim(p_customer->>'name'), 120),
      'phone',   left(trim(p_customer->>'phone'), 40),
      'email',   left(trim(p_customer->>'email'), 160),
      'payment', v_payment,
      'notes',   left(coalesce(p_customer->>'notes', ''), 500)
    ),
    v_status,
    v_uid,
    case when p_use_balance then 'paid' else 'unpaid' end,
    case when p_use_balance then now() else null end
  )
  returning * into v_order;

  if p_use_balance then
    insert into public.wallet_entries (customer_id, amount, kind, ref, note)
    values (v_uid, -v_total, 'order', v_code, '');
  end if;

  return v_order;
end;
$$;

-- Note the missing "anon": a signed-out visitor cannot even reach the function.
revoke all on function public.place_order(jsonb, jsonb, boolean) from public;
grant execute on function public.place_order(jsonb, jsonb, boolean) to authenticated;
