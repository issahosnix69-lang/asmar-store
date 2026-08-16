-- ===========================================================================
-- Fix: "function gen_random_bytes(integer) does not exist"
--
-- Two mistakes compounding.
--
-- 1. gen_random_bytes() belongs to the pgcrypto extension, which none of the
--    earlier scripts ever created. gen_random_uuid() looks like it comes from
--    the same place and does not — it is built into Postgres 13+ — so table
--    defaults worked and the functions did not, which made the gap easy to
--    miss.
--
-- 2. Supabase installs extensions into the `extensions` schema, not `public`.
--    Every one of these functions is declared `set search_path = public`,
--    which is correct and deliberate — a security-definer function must not
--    inherit the caller's search_path — but it also means `extensions` is not
--    searched, so the function stays invisible even once pgcrypto exists.
--
-- What broke, in order of how much it matters:
--   place_order()  — every order. No customer could check out at all.
--   submit_topup() — every top-up request.
--
-- Run this once. Safe to run again.
-- ===========================================================================

create extension if not exists pgcrypto with schema extensions;

-- Widening the search_path rather than rewriting the functions: the bodies are
-- correct, they simply could not see the schema. `extensions` is added after
-- `public`, so public still wins any name collision.
alter function public.place_order(jsonb, jsonb, boolean)
  set search_path = public, extensions;

alter function public.submit_topup(numeric, text, text)
  set search_path = public, extensions;

-- ---------------------------------------------------------------- check it
-- Should return two rows, each listing {public,extensions}.
select p.proname,
       p.proconfig
  from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
 where n.nspname = 'public'
   and p.proname in ('place_order', 'submit_topup');

-- And this should return a code like 4f2a-91c rather than an error:
select upper(substr(encode(extensions.gen_random_bytes(6), 'hex'), 1, 4))
       || '-' ||
       upper(substr(encode(extensions.gen_random_bytes(6), 'hex'), 1, 3)) as sample_code;
