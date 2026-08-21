-- ===========================================================================
-- Why did no Telegram message arrive?
--
-- The alert path has four links and every one of them fails silently by
-- design — an order must never be lost because a notification could not be
-- sent. That is right for the shop and useless for debugging, so this reports
-- each link separately instead of guessing.
--
--   1. the order      — was a row actually written? A broken checkout writes
--                       nothing, and then there is nothing to notify about.
--   2. the triggers   — orders_notify / orders_notify_paid on public.orders.
--                       notify-direct.sql only replaces the functions; the
--                       triggers themselves come from notify.sql, so running
--                       one without the other leaves working code nobody calls.
--   3. the config     — notify_config.enabled, plus a token and a chat id.
--                       send_order_alert() returns quietly if any is missing.
--   4. the delivery   — what Telegram answered. pg_net posts asynchronously
--                       and its reply lands in net._http_response, never in
--                       front of anyone.
--
-- Supabase dashboard -> SQL Editor -> paste -> Run. Reads only; changes nothing.
-- ===========================================================================

-- 1 ------------------------------------------------------------- the order --
select '1. orders' as check,
       count(*)                        as orders_total,
       count(*) filter (where created_at > now() - interval '24 hours') as last_24h,
       max(created_at)                 as most_recent
  from public.orders;

-- The five most recent, to confirm the one you placed is really there.
select '1b. recent orders' as check,
       code, total, payment_status, created_at,
       customer ->> 'payment' as payment_method
  from public.orders
 order by created_at desc
 limit 5;

-- 2 ----------------------------------------------------------- the triggers --
-- Expect two rows: orders_notify (INSERT) and orders_notify_paid (UPDATE).
-- No rows means notify.sql was never run against this project.
select '2. triggers' as check,
       t.tgname      as trigger_name,
       p.proname     as calls_function,
       t.tgenabled   as enabled_flag   -- 'O' = enabled, 'D' = disabled
  from pg_trigger t
  join pg_proc p on p.oid = t.tgfoid
 where t.tgrelid = 'public.orders'::regclass
   and not t.tgisinternal;

-- 3 ------------------------------------------------------------- the config --
-- The token and chat id are shown only as lengths: this output is easy to
-- paste into a chat window, and the token is the one secret worth protecting.
select '3. config' as check,
       enabled,
       length(telegram_token)    as token_len,     -- ~46 for a real bot token
       telegram_chat_id,
       length(telegram_chat_id)  as chat_len,
       public.notify_is_configured() as reports_configured
  from public.notify_config
 where id = 1;

-- 4 ------------------------------------------------------------ the delivery --
-- What Telegram actually said. status_code 200 means it was delivered and the
-- problem is which chat you are looking at, not the shop.
--   401  -> the bot token is wrong
--   400  -> usually "chat not found": the chat id is wrong, or you never
--           pressed Start in the bot, so it is not allowed to message you
--   null + error_msg -> the request never completed
select '4. delivery' as check,
       r.id, r.status_code, r.timed_out, r.error_msg, r.created,
       left(r.content, 300) as telegram_said
  from net._http_response r
 order by r.created desc
 limit 10;

-- 5 ------------------------------------------------- checkout still working --
-- Not part of the alert path, but the most common reason link 1 is empty:
-- place_order() calls gen_random_bytes(), which lives in the `extensions`
-- schema. Both rows must show {public,extensions} in proconfig, or checkout
-- fails and no order is ever written. Fix by running fix-pgcrypto.sql.
select '5. checkout' as check,
       p.proname,
       p.proconfig,
       exists (select 1 from pg_extension where extname = 'pgcrypto') as pgcrypto_installed
  from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
 where n.nspname = 'public'
   and p.proname in ('place_order', 'submit_topup');
