-- ===========================================================================
-- Order alerts, without an Edge Function.
--
-- notify.sql routes new orders through the notify-order Edge Function, which is
-- the tidier architecture but costs a Supabase CLI install, a deploy, and three
-- secrets to keep in sync. For one shop owner who wants a message on his phone,
-- that is a lot of moving parts to maintain.
--
-- This does the same job from inside Postgres: the trigger posts straight to
-- Telegram's API with pg_net. Run it INSTEAD of the SETUP block in notify.sql.
-- The Edge Function can stay deployed and unused, or be ignored entirely.
--
-- Trade-off worth knowing: the bot token lives in the database rather than in
-- Supabase secrets. notify_config has row-level security enabled with no
-- policies at all, so the anon key cannot read it — only the service role and
-- security-definer functions can. For a bot whose only power is sending
-- messages to one chat, that is a fair trade for losing the whole deploy step.
--
-- Run AFTER notify.sql.
-- ===========================================================================

create extension if not exists pg_net with schema extensions;

alter table public.notify_config add column if not exists telegram_token   text not null default '';
alter table public.notify_config add column if not exists telegram_chat_id text not null default '';

-- --------------------------------------------------------------- the message
-- Plain text, not HTML. A customer controls their own name and order note, and
-- an unescaped '<' in either would break Telegram's HTML parser or let them
-- inject markup into Ali's chat. Plain text has no such hole.
create or replace function public.order_alert_text(o public.orders)
returns text
language plpgsql
stable
set search_path = public
as $$
declare
  v_lines   text;
  v_payment text;
begin
  select string_agg(
           '• ' || coalesce(i ->> 'name', '?') ||
           ' — ' || coalesce(i ->> 'label', '') ||
           ' x' || coalesce(i ->> 'qty', '1'),
           E'\n')
    into v_lines
    from jsonb_array_elements(coalesce(o.items, '[]'::jsonb)) i;

  v_payment := case o.customer ->> 'payment'
                 when 'balance' then 'Paid from balance'
                 when 'online'  then 'Online'
                 else                'Cash on delivery'
               end;

  return
    '🛒 New order ' || o.code || E'\n\n' ||
    coalesce(v_lines, '(no items)') || E'\n\n' ||
    'Total: $' || to_char(o.total, 'FM999999990.00') || E'\n' ||
    'Payment: ' || v_payment || E'\n\n' ||
    'Name: '  || coalesce(o.customer ->> 'name', '')  || E'\n' ||
    'Phone: ' || coalesce(o.customer ->> 'phone', '') || E'\n' ||
    'Email: ' || coalesce(o.customer ->> 'email', '') ||
    case when coalesce(o.customer ->> 'notes', '') <> ''
         then E'\n\nNote: ' || (o.customer ->> 'notes') else '' end;
end;
$$;

-- ------------------------------------------------------------------- sending
create or replace function public.send_order_alert(o public.orders)
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
                 'text',    public.order_alert_text(o),
                 'disable_web_page_preview', true
               ),
    timeout_milliseconds := 5000
  );
end;
$$;

-- ------------------------------------------------------------------ triggers
-- Replaces the Edge Function versions from notify.sql. An online order is not
-- worth reporting until it is paid; those arrive through the update trigger.
create or replace function public.notify_new_order()
returns trigger
language plpgsql
security definer
set search_path = public, extensions
as $$
begin
  if new.customer ->> 'payment' = 'online' and new.payment_status <> 'paid' then
    return new;
  end if;
  perform public.send_order_alert(new);
  return new;
exception
  -- An alert is never worth losing an order over.
  when others then
    raise warning 'notify_new_order failed for %: %', new.code, sqlerrm;
    return new;
end;
$$;

create or replace function public.notify_order_paid()
returns trigger
language plpgsql
security definer
set search_path = public, extensions
as $$
begin
  if new.payment_status = 'paid' and old.payment_status is distinct from 'paid' then
    perform public.send_order_alert(new);
  end if;
  return new;
exception
  when others then
    raise warning 'notify_order_paid failed for %: %', new.code, sqlerrm;
    return new;
end;
$$;

-- notify_is_configured() is what the admin's Diagnostics tab reads. It checked
-- the Edge Function url/secret; now it must check the Telegram pair instead, or
-- Diagnostics reports a red X on a setup that works perfectly.
create or replace function public.notify_is_configured()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(
    (select enabled and telegram_token <> '' and telegram_chat_id <> ''
       from public.notify_config where id = 1),
    false
  );
$$;

revoke all on function public.notify_is_configured() from public;
grant execute on function public.notify_is_configured() to authenticated;

-- Tells the admin's Diagnostics which alert route is in use, so it stops
-- reporting a missing notify-order function as a fault on a shop that
-- deliberately does not use one.
create or replace function public.notify_uses_edge_function()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(
    (select url <> '' and telegram_token = '' from public.notify_config where id = 1),
    false
  );
$$;

revoke all on function public.notify_uses_edge_function() from public;
grant execute on function public.notify_uses_edge_function() to authenticated;
