-- ===========================================================================
-- Everything that should reach Ali's phone.
--
-- Three things need him: an order, someone asking for an account, and someone
-- saying they have sent a transfer. Only the first two had a trigger, and a
-- top-up is the one that costs money to ignore — the customer has already
-- paid and is waiting on a balance that only Ali can credit. Silence there
-- reads as a shop that took the money and stopped answering.
--
-- The pg_net call was also written out three separate times, once per trigger.
-- Copies drift: the account-request one was already the only place a config
-- check could go stale without anyone noticing. One send_telegram() now, and
-- each trigger only decides what to say.
--
-- Run once, after notify-direct.sql. Safe to run again.
-- ===========================================================================

-- ------------------------------------------------------------- the one sender
-- Security definer because notify_config has row-level security with no
-- policies at all — the bot token is unreadable with the anon key, and stays
-- that way. Callers pass text and never see the token.
create or replace function public.send_telegram(p_text text)
returns void
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_cfg public.notify_config%rowtype;
begin
  select * into v_cfg from public.notify_config where id = 1;

  if v_cfg is null or not v_cfg.enabled
     or v_cfg.telegram_token = '' or v_cfg.telegram_chat_id = '' then
    return;                                        -- not configured yet, no-op
  end if;

  perform net.http_post(
    url     := 'https://api.telegram.org/bot' || v_cfg.telegram_token || '/sendMessage',
    headers := jsonb_build_object('Content-Type', 'application/json'),
    body    := jsonb_build_object(
                 'chat_id', v_cfg.telegram_chat_id,
                 'text',    p_text,
                 'disable_web_page_preview', true
               ),
    timeout_milliseconds := 5000
  );
end;
$$;

-- Callable from the SQL editor to test the whole path without placing a real
-- order. Not granted to anon or authenticated: nothing in the browser has any
-- business making the shop send messages.
revoke all on function public.send_telegram(text) from public, anon, authenticated;

-- ------------------------------------------------------------------- orders
-- Same message as before; only the sending is now shared. Plain text, not
-- HTML — a customer controls their own name and order note, and an unescaped
-- '<' would either break Telegram's parser or put markup in Ali's chat.
create or replace function public.send_order_alert(o public.orders)
returns void
language plpgsql
security definer
set search_path = public, extensions
as $$
begin
  perform public.send_telegram(public.order_alert_text(o));
end;
$$;

-- --------------------------------------------------------- account requests
create or replace function public.notify_account_request()
returns trigger
language plpgsql
security definer
set search_path = public, extensions
as $$
begin
  perform public.send_telegram(
    '👤 New account request' || E'\n\n' ||
    'Name: '  || coalesce(new.name, '')  || E'\n' ||
    'Phone: ' || coalesce(new.phone, '') || E'\n' ||
    'Email: ' || coalesce(new.email, '') || E'\n\n' ||
    'Admin → Customers → Requests to approve.'
  );
  return new;
exception
  -- Never lose the request over a failed notification.
  when others then
    raise warning 'notify_account_request failed for %: %', new.email, sqlerrm;
    return new;
end;
$$;

drop trigger if exists account_requests_notify on public.account_requests;
create trigger account_requests_notify
  after insert on public.account_requests
  for each row execute function public.notify_account_request();

-- ------------------------------------------------------------------ top-ups
-- The new one. Fires when the customer submits the transfer, not when it is
-- approved — approving it is the thing this is asking Ali to go and do.
--
-- The receipt column is never touched: it is a downscaled screenshot held as a
-- data URL, hundreds of kilobytes, and Telegram's message limit is 4096
-- characters. Sending it would fail the whole message, not truncate it.
create or replace function public.notify_topup_request()
returns trigger
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_name  text;
  v_phone text;
begin
  -- topups only carries customer_id; the name and number Ali needs to chase
  -- the transfer live on customers.
  select c.name, c.phone into v_name, v_phone
    from public.customers c
   where c.id = new.customer_id;

  perform public.send_telegram(
    '💵 New top-up request' || E'\n\n' ||
    'Amount: $' || to_char(new.amount, 'FM999999990.00') || E'\n' ||
    'Method: '  || coalesce(new.method, '') || E'\n' ||
    'Ref: '     || coalesce(new.ref, '')    || E'\n\n' ||
    'Name: '    || coalesce(v_name, '')     || E'\n' ||
    'Phone: '   || coalesce(v_phone, '')    || E'\n\n' ||
    'Admin → Top-ups to see the receipt and approve.'
  );
  return new;
exception
  when others then
    raise warning 'notify_topup_request failed for %: %', new.ref, sqlerrm;
    return new;
end;
$$;

drop trigger if exists topups_notify on public.topups;
create trigger topups_notify
  after insert on public.topups
  for each row execute function public.notify_topup_request();

-- ---------------------------------------------------------------- check it
-- Expect four rows: orders_notify, orders_notify_paid, account_requests_notify
-- and topups_notify. Anything missing here is a message that will never arrive.
select c.relname as on_table, t.tgname as trigger_name, p.proname as calls
  from pg_trigger t
  join pg_class c on c.oid = t.tgrelid
  join pg_proc  p on p.oid = t.tgfoid
 where not t.tgisinternal
   and c.relname in ('orders', 'account_requests', 'topups')
 order by c.relname, t.tgname;
