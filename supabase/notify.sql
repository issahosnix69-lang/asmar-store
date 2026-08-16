-- ===========================================================================
-- Order notifications for The Asmar Store.
--
-- Fires the notify-order Edge Function whenever an order is created, so a new
-- order reaches Ali's phone without the customer having to tap "send on
-- WhatsApp" on the receipt screen.
--
-- Run AFTER schema.sql, payments.sql and accounts.sql.
--
-- Before running, set the two settings at the bottom of this file — the
-- function URL and the shared secret — or the trigger has nowhere to post to.
-- ===========================================================================

-- pg_net sends the HTTP request without blocking the transaction that created
-- the order. A synchronous call here would mean a slow chat API turns into a
-- slow checkout, and a failing one into a failed order.
create extension if not exists pg_net with schema extensions;

-- Config lives in a table rather than in the function body so the secret is not
-- readable in the routine definition, and so rotating it is an update rather
-- than a redeploy.
create table if not exists public.notify_config (
  id     integer primary key default 1 check (id = 1),
  url    text not null default '',
  secret text not null default '',
  enabled boolean not null default true
);

alter table public.notify_config enable row level security;
-- No policies at all: only the service role and security-definer functions read
-- this. The secret must never be reachable with the anon key.

insert into public.notify_config (id) values (1) on conflict do nothing;

-- ---------------------------------------------------------------- the trigger
create or replace function public.notify_new_order()
returns trigger
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_cfg public.notify_config%rowtype;
begin
  select * into v_cfg from public.notify_config where id = 1;

  if v_cfg is null or not v_cfg.enabled or v_cfg.url = '' or v_cfg.secret = '' then
    return new;                                   -- not configured yet, no-op
  end if;

  -- An order placed online is not worth telling him about until it is paid;
  -- those arrive through the payment callback instead. Everything else — cash
  -- on delivery, paid from balance — needs him now.
  if new.customer ->> 'payment' = 'online' and new.payment_status <> 'paid' then
    return new;
  end if;

  perform net.http_post(
    url     := v_cfg.url,
    headers := jsonb_build_object(
                 'Content-Type',     'application/json',
                 'x-notify-secret',  v_cfg.secret
               ),
    body    := jsonb_build_object('order', to_jsonb(new)),
    timeout_milliseconds := 5000
  );

  return new;
exception
  -- A notification is never worth losing an order over. If pg_net is missing,
  -- the URL is unreachable, or anything else goes wrong, the order still
  -- commits and the failure is logged.
  when others then
    raise warning 'notify_new_order failed for %: %', new.code, sqlerrm;
    return new;
end;
$$;

drop trigger if exists orders_notify on public.orders;
create trigger orders_notify
  after insert on public.orders
  for each row execute function public.notify_new_order();

-- Also tell him when an online payment finally lands, since that insert was
-- skipped above.
create or replace function public.notify_order_paid()
returns trigger
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_cfg public.notify_config%rowtype;
begin
  if new.payment_status <> 'paid' or old.payment_status = 'paid' then
    return new;
  end if;

  select * into v_cfg from public.notify_config where id = 1;
  if v_cfg is null or not v_cfg.enabled or v_cfg.url = '' or v_cfg.secret = '' then
    return new;
  end if;

  perform net.http_post(
    url     := v_cfg.url,
    headers := jsonb_build_object(
                 'Content-Type',    'application/json',
                 'x-notify-secret', v_cfg.secret
               ),
    body    := jsonb_build_object('order', to_jsonb(new)),
    timeout_milliseconds := 5000
  );
  return new;
exception
  when others then
    raise warning 'notify_order_paid failed for %: %', new.code, sqlerrm;
    return new;
end;
$$;

drop trigger if exists orders_notify_paid on public.orders;
create trigger orders_notify_paid
  after update of payment_status on public.orders
  for each row execute function public.notify_order_paid();


-- Lets the admin's diagnostics page say whether this is actually wired up,
-- without ever exposing the secret itself.
create or replace function public.notify_is_configured()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(
    (select enabled and url <> '' and secret <> '' from public.notify_config where id = 1),
    false
  );
$$;

revoke all on function public.notify_is_configured() from public;
grant execute on function public.notify_is_configured() to authenticated;


-- ===========================================================================
-- SETUP — edit these two lines and run them.
--
--   1. Deploy the function:
--        supabase functions deploy notify-order --no-verify-jwt
--
--   2. Make a secret and give it to both sides:
--        openssl rand -hex 32
--        supabase secrets set NOTIFY_SECRET=<that value>
--
--   3. Make a Telegram bot: message @BotFather, /newbot, copy the token.
--      Message your new bot once, then open
--        https://api.telegram.org/bot<TOKEN>/getUpdates
--      and copy the "chat":{"id": ...} number.
--        supabase secrets set TELEGRAM_BOT_TOKEN=<token> TELEGRAM_CHAT_ID=<id>
--
--   4. Point the trigger at the function:
-- ===========================================================================

-- update public.notify_config set
--   url    = 'https://<your-project-ref>.functions.supabase.co/notify-order',
--   secret = '<the same NOTIFY_SECRET>'
-- where id = 1;

-- Check it works without placing a real order:
-- select net.http_post(
--   url     := (select url from public.notify_config where id = 1),
--   headers := jsonb_build_object(
--                'Content-Type',    'application/json',
--                'x-notify-secret', (select secret from public.notify_config where id = 1)),
--   body    := jsonb_build_object('order', jsonb_build_object(
--                'code',  'ASM-TEST-001',
--                'total', 9.00,
--                'items', jsonb_build_array(jsonb_build_object(
--                           'name','Netflix','label','1 month','qty',2,'price',4.50)),
--                'customer', jsonb_build_object(
--                           'name','Test','phone','70000000','email','test@example.com',
--                           'payment','cod')))
-- );
