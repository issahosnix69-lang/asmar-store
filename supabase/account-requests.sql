-- ===========================================================================
-- Account requests.
--
-- Customers still cannot sign themselves up — Ali creates every login. This
-- only removes the WhatsApp round-trip: instead of messaging him and waiting
-- for him to ask for their details one at a time, they fill in a form and he
-- gets the whole thing at once, in the admin and on his phone.
--
-- Approving a request creates the real account through the existing
-- admin-create-customer Edge Function, because making an auth user needs the
-- service_role key and that cannot happen from SQL.
--
-- Run AFTER accounts.sql and notify-direct.sql.
-- ===========================================================================

create table if not exists public.account_requests (
  id          uuid primary key default gen_random_uuid(),
  name        text not null,
  email       text not null,
  phone       text not null,
  -- The password the customer chose. Held only until the account is created,
  -- then wiped by decide_account_request(). It is never sent to Telegram and
  -- never leaves the server except to create the auth user.
  password    text not null default '',
  status      text not null default 'pending'
                check (status in ('pending', 'approved', 'rejected')),
  admin_note  text not null default '',
  created_at  timestamptz not null default now(),
  decided_at  timestamptz
);

create index if not exists account_requests_status_idx
  on public.account_requests (status, created_at desc);

-- One pending request per email, so a customer pressing submit twice does not
-- produce two accounts.
create unique index if not exists account_requests_pending_email_idx
  on public.account_requests (lower(email)) where status = 'pending';

alter table public.account_requests enable row level security;

-- No policies at all. Everything goes through the security-definer functions
-- below, so a request cannot be read, edited or approved with the anon key.

-- ------------------------------------------------------------- make a request
-- Callable by anonymous visitors: that is the whole point, they have no account
-- yet. Everything a stranger can reach has to validate hard.
create or replace function public.request_account(
  p_name     text,
  p_email    text,
  p_phone    text,
  p_password text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_email  text := lower(trim(p_email));
  v_name   text := trim(p_name);
  v_phone  text := trim(p_phone);
  v_recent integer;
begin
  if v_name = '' or length(v_name) > 80 then
    raise exception 'Please enter your name.';
  end if;
  if v_email !~ '^[^\s@]+@[^\s@]+\.[^\s@]{2,}$' or length(v_email) > 160 then
    raise exception 'Please enter a valid email address.';
  end if;
  -- Digits only, so "+961 70 123 456" and "70-123-456" both count.
  if length(regexp_replace(v_phone, '\D', '', 'g')) < 7 or length(v_phone) > 40 then
    raise exception 'Please enter a valid phone number.';
  end if;
  if length(coalesce(p_password, '')) < 6 or length(p_password) > 72 then
    raise exception 'Choose a password of at least 6 characters.';
  end if;

  if exists (select 1 from public.customers where lower(email) = v_email) then
    raise exception 'There is already an account with that email. Try signing in.';
  end if;

  if exists (select 1 from public.account_requests
              where lower(email) = v_email and status = 'pending') then
    raise exception 'We already have your request. We will message you shortly.';
  end if;

  -- Crude flood control. Without it this endpoint is an open invitation to fill
  -- the table and Ali's phone; there is no captcha and no login to hide behind.
  select count(*) into v_recent
    from public.account_requests
   where created_at > now() - interval '1 hour';
  if v_recent >= 30 then
    raise exception 'Too many requests right now. Please message us on WhatsApp.';
  end if;

  insert into public.account_requests (name, email, phone, password)
  values (v_name, v_email, v_phone, p_password);

  -- Never echo the password back.
  return jsonb_build_object('ok', true, 'email', v_email);
end;
$$;

revoke all on function public.request_account(text, text, text, text) from public;
grant execute on function public.request_account(text, text, text, text) to anon, authenticated;

-- ----------------------------------------------------------------- the admin
create or replace function public.admin_account_requests(p_status text default 'pending')
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if not public.is_admin() then raise exception 'Not allowed.'; end if;

  return coalesce((
    select jsonb_agg(x order by x.created_at desc) from (
      select r.id, r.name, r.email, r.phone, r.status, r.admin_note,
             r.created_at, r.decided_at,
             -- Only a pending request hands over the password, and only to an
             -- admin, and only so the account can be created with it.
             case when r.status = 'pending' then r.password else '' end as password
        from public.account_requests r
       where (p_status = 'all')
          or (p_status = 'pending' and r.status = 'pending')
          or (p_status = 'decided' and r.status <> 'pending')
       order by r.created_at desc
       limit 200
    ) x
  ), '[]'::jsonb);
end;
$$;

create or replace function public.admin_pending_requests()
returns integer
language sql stable security definer set search_path = public
as $$ select case when public.is_admin()
                  then (select count(*)::integer from public.account_requests
                         where status = 'pending')
                  else 0 end; $$;

-- Marks the request decided and wipes the stored password. The auth user itself
-- is created by the client through admin-create-customer immediately before
-- this is called — that needs the service_role key, which cannot live in SQL.
create or replace function public.decide_account_request(
  p_id      uuid,
  p_approve boolean,
  p_note    text default ''
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_admin() then raise exception 'Not allowed.'; end if;

  update public.account_requests
     set status     = case when p_approve then 'approved' else 'rejected' end,
         admin_note = coalesce(p_note, ''),
         decided_at = now(),
         -- Gone either way. An approved request's password now lives in the
         -- auth system where it belongs; a rejected one should not be kept at
         -- all.
         password   = ''
   where id = p_id and status = 'pending';

  if not found then raise exception 'That request was already decided.'; end if;
  return true;
end;
$$;

revoke all on function public.admin_account_requests(text) from public;
revoke all on function public.admin_pending_requests() from public;
revoke all on function public.decide_account_request(uuid, boolean, text) from public;
grant execute on function public.admin_account_requests(text) to authenticated;
grant execute on function public.admin_pending_requests() to authenticated;
grant execute on function public.decide_account_request(uuid, boolean, text) to authenticated;

-- --------------------------------------------------------------- the alert
-- Deliberately does NOT include the password. Telegram history lives on a phone
-- forever, and people reuse passwords — a leak there follows the customer to
-- their email and their bank. Ali opens the admin to approve; that is one tap
-- and it keeps the secret in one place.
create or replace function public.notify_account_request()
returns trigger
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
    return new;
  end if;

  perform net.http_post(
    url     := 'https://api.telegram.org/bot' || v_cfg.telegram_token || '/sendMessage',
    headers := jsonb_build_object('Content-Type', 'application/json'),
    body    := jsonb_build_object(
                 'chat_id', v_cfg.telegram_chat_id,
                 'text', '👤 New account request' || E'\n\n' ||
                         'Name: '  || new.name  || E'\n' ||
                         'Phone: ' || new.phone || E'\n' ||
                         'Email: ' || new.email || E'\n\n' ||
                         'Open the admin -> Customers -> Requests to approve.',
                 'disable_web_page_preview', true
               ),
    timeout_milliseconds := 5000
  );
  return new;
exception
  when others then
    raise warning 'notify_account_request failed for %: %', new.email, sqlerrm;
    return new;
end;
$$;

drop trigger if exists account_requests_notify on public.account_requests;
create trigger account_requests_notify
  after insert on public.account_requests
  for each row execute function public.notify_account_request();
