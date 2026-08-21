-- ===========================================================================
-- Deliver the subscription itself through the shop.
--
-- Until now the account details for a Netflix or Spotify subscription were
-- typed into WhatsApp by hand. That works, but the customer then has to keep a
-- chat message forever, and a password sitting in a chat thread is a password
-- anyone who picks up the phone can read.
--
-- So: the owner types them against the order, and the customer reads them on
-- their own account page. One box per line of the order, because an order can
-- carry a Netflix and a Spotify subscription and they are different logins.
--
-- `delivery` is an array positionally aligned with `items` — element 0 belongs
-- to item 0. An empty object means that line has not been delivered yet.
--
--   [{"email": "...", "password": "...", "note": "...", "sent_at": "..."}, {}]
--
-- Worth being clear about the trade-off: these are stored as plain text,
-- because the customer has to be able to read them back — hashing is for
-- passwords nobody ever needs to see again, which is the opposite of this.
-- What protects them is row-level security, re-asserted below.
--
-- Run once. Safe to run again.
-- ===========================================================================

alter table public.orders
  add column if not exists delivery jsonb not null default '[]'::jsonb;

-- --------------------------------------------------------- who can read this
-- schema.sql's original policies were written before customer accounts existed,
-- when "authenticated" meant Ali and nobody else:
--
--     create policy orders_admin_read on public.orders for select
--       to authenticated using (true);
--
-- accounts.sql replaced them, but policies are permissive and OR together, so
-- if schema.sql is ever re-run afterwards that `using (true)` comes back and
-- every signed-in customer can read every order in the shop. That was already
-- a leak of names and phone numbers; with account passwords in the table it
-- would be very much worse. Re-asserted here so this file is safe to run last.
drop policy if exists orders_admin_read  on public.orders;
drop policy if exists orders_admin_write on public.orders;
drop policy if exists orders_read        on public.orders;
drop policy if exists orders_write       on public.orders;

create policy orders_read on public.orders for select
  to authenticated using (public.is_admin() or customer_id = auth.uid());

-- Only the owner writes delivery details. A customer editing their own order
-- could otherwise award themselves a longer subscription.
create policy orders_write on public.orders for update
  to authenticated using (public.is_admin()) with check (public.is_admin());

-- ------------------------------------------------------- hand it to the page
-- my_account() lists the columns it returns one by one, so a new column is
-- invisible to the account page until it is named here.
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
        select id, ref, amount, method, status, admin_note, created_at, decided_at
        from public.topups where customer_id = v_uid
        order by created_at desc limit 25
      ) t
    ), '[]'::jsonb),
    'orders', coalesce((
      select jsonb_agg(o order by o.created_at desc) from (
        select code, items, total, status, payment_status, created_at, delivery
        from public.orders where customer_id = v_uid
        order by created_at desc limit 25
      ) o
    ), '[]'::jsonb)
  );
end;
$$;

revoke all on function public.my_account() from public;
grant execute on function public.my_account() to authenticated;

-- order_public_status() is deliberately left alone. It is the one order lookup
-- that works without signing in — anyone holding the code can call it — so it
-- must keep returning nothing but the code, the status and the total.

-- ---------------------------------------------------------------- check it
-- Expect: the delivery column present, and exactly two policies on orders,
-- neither of them an unqualified `true`.
select 'column' as check, column_name, data_type
  from information_schema.columns
 where table_schema = 'public' and table_name = 'orders' and column_name = 'delivery';

select 'policy' as check, policyname, cmd, qual
  from pg_policies
 where schemaname = 'public' and tablename = 'orders';
