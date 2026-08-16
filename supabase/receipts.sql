-- ===========================================================================
-- Move top-up receipts out of the database and into Storage.
--
-- Receipts are photographs of a Whish or OMT transfer. They were stored as
-- base64 data URLs in topups.receipt — a text column — at roughly 150 KB each
-- once the browser had downscaled them. Base64 is a third larger than the bytes
-- it encodes, every one of them sits in the table's TOAST storage, and they are
-- included in every database backup forever. A few hundred top-ups and the
-- database is mostly photographs of receipts.
--
-- Storage is the right home: object storage is cheaper, receipts stop bloating
-- backups, and the admin gets a short-lived signed URL instead of a megabyte of
-- base64 in a JSON response.
--
-- Run AFTER accounts.sql. Existing rows keep working — see the compatibility
-- note on admin_topups below.
-- ===========================================================================

-- ------------------------------------------------------------------ bucket
-- Private. A receipt shows a real transfer between two real people; it must
-- never be readable by URL alone.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('receipts', 'receipts', false, 3145728,
        array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do update
  set public = false,
      file_size_limit = 3145728,
      allowed_mime_types = array['image/jpeg', 'image/png', 'image/webp'];

-- Objects are stored under the customer's own uuid: receipts/<uid>/<ref>.jpg.
-- That prefix is what the policies below key on, so a customer can only ever
-- write into their own folder.
drop policy if exists receipts_insert_own on storage.objects;
create policy receipts_insert_own on storage.objects for insert
  to authenticated
  with check (
    bucket_id = 'receipts'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

drop policy if exists receipts_read_own on storage.objects;
create policy receipts_read_own on storage.objects for select
  to authenticated
  using (
    bucket_id = 'receipts'
    and ((storage.foldername(name))[1] = auth.uid()::text or public.is_admin())
  );

-- Deliberately no update or delete policy for customers. A receipt is evidence
-- of a payment claim; being able to swap it after submitting is exactly the
-- hole that would make the evidence worthless.
drop policy if exists receipts_admin_all on storage.objects;
create policy receipts_admin_all on storage.objects for all
  to authenticated
  using (bucket_id = 'receipts' and public.is_admin())
  with check (bucket_id = 'receipts' and public.is_admin());


-- --------------------------------------------------------------- the column
-- receipt_path holds the object key. The old `receipt` column stays so rows
-- submitted before this migration still display; new rows leave it empty.
alter table public.topups add column if not exists receipt_path text not null default '';


-- ------------------------------------------------------------ submit_topup
-- Now takes the storage path the browser has already uploaded to, rather than
-- the image itself. Everything else — the amount ceiling, the pending-request
-- limit, the active-account check — is unchanged.
--
-- The drop is required, not tidiness. accounts.sql declared this function's
-- third parameter as p_receipt and this one calls it p_path; the signature
-- (numeric, text, text) is identical either way, and Postgres refuses to
-- rename a parameter through CREATE OR REPLACE:
--   ERROR 42P13: cannot change name of input parameter "p_receipt"
-- Dropping first is the documented fix. Safe to run repeatedly.
drop function if exists public.submit_topup(numeric, text, text);

create or replace function public.submit_topup(
  p_amount numeric,
  p_method text,
  p_path   text
)
returns public.topups
language plpgsql security definer set search_path = public
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

  if coalesce(p_path, '') = '' then
    raise exception 'Attach a picture of the transfer.';
  end if;

  -- The path must be inside this customer's own folder. Storage policy already
  -- enforces this on the upload; re-checking here stops a caller pointing a
  -- top-up row at somebody else's receipt.
  if split_part(p_path, '/', 1) <> v_uid::text then
    raise exception 'That receipt does not belong to this account.';
  end if;

  if not exists (
    select 1 from storage.objects
     where bucket_id = 'receipts' and name = p_path
  ) then
    raise exception 'The receipt did not finish uploading. Please try again.';
  end if;

  select count(*) into v_pending
    from public.topups where customer_id = v_uid and status = 'pending';
  if v_pending >= 5 then
    raise exception 'You already have 5 top-ups waiting. Please wait for those first.';
  end if;

  insert into public.topups (ref, customer_id, amount, method, receipt, receipt_path)
  values (
    'TOP-' || upper(substr(encode(gen_random_bytes(6), 'hex'), 1, 4))
           || '-' || upper(substr(encode(gen_random_bytes(6), 'hex'), 1, 3)),
    v_uid,
    round(p_amount, 2),
    coalesce(nullif(trim(p_method), ''), 'whish'),
    '',
    p_path
  )
  returning * into v_row;

  v_row.receipt := '';
  return v_row;
end;
$$;

revoke all on function public.submit_topup(numeric, text, text) from public;
grant execute on function public.submit_topup(numeric, text, text) to authenticated;


-- ------------------------------------------------------------- admin_topups
-- Returns receipt_path alongside the legacy receipt column. The admin creates a
-- signed URL from the path; rows from before the migration still carry their
-- inline data URL and render the old way. Both are handled in src/admin.jsx.
create or replace function public.admin_topups(p_status text default 'pending')
returns jsonb
language plpgsql stable security definer set search_path = public
as $$
begin
  if not public.is_admin() then raise exception 'Not allowed.'; end if;

  if p_status = 'pending' then
    return coalesce((
      select jsonb_agg(x order by x.created_at asc) from (
        select t.id, t.ref, t.amount, t.method, t.receipt, t.receipt_path,
               t.status, t.created_at, c.name, c.phone, c.email
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

revoke all on function public.admin_topups(text) from public;
grant execute on function public.admin_topups(text) to authenticated;


-- ===========================================================================
-- Optional cleanup, once you are happy everything works.
--
-- Frees the space the old inline images take. Decided top-ups no longer show
-- their receipt in the admin anyway, so this loses nothing you can still see.
-- Take a backup first.
-- ===========================================================================

-- update public.topups set receipt = '' where status <> 'pending' and receipt <> '';
-- vacuum full public.topups;
