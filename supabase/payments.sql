-- The Asmar Store — payment tracking (run AFTER schema.sql)
--
-- Payment state is deliberately separate from order status. An order can be
-- "Delivered" while payment is "paid", or "New" while payment is "pending".
-- Only the server ever writes these columns.

alter table public.orders
  add column if not exists payment_provider text,
  add column if not exists payment_status   text not null default 'unpaid',
  add column if not exists payment_ref      text,
  add column if not exists payment_amount   numeric(10,2),
  add column if not exists paid_at          timestamptz;

-- payment_ref is how a Whish callback finds the order it belongs to.
create unique index if not exists orders_payment_ref_idx
  on public.orders (payment_ref) where payment_ref is not null;

alter table public.orders
  drop constraint if exists orders_payment_status_check;
alter table public.orders
  add constraint orders_payment_status_check
  check (payment_status in ('unpaid', 'pending', 'paid', 'failed', 'refunded'));

-- ------------------------------------------------------- callback bookkeeping
-- Every callback Whish sends is recorded before it is acted on. A payment
-- provider will retry a webhook it thinks failed, and without this a retry
-- would mark the same order paid twice.
create table if not exists public.payment_events (
  id           bigserial primary key,
  provider     text        not null,
  external_id  text        not null,
  payload      jsonb       not null,
  processed_at timestamptz not null default now(),
  unique (provider, external_id)
);

alter table public.payment_events enable row level security;
-- No policies: only the service role (Edge Functions) touches this table.

-- ------------------------------------------------------------ mark_order_paid
-- Called by the callback Edge Function, never by the browser. Idempotent:
-- a repeated event for the same external id is recorded and ignored.
create or replace function public.mark_order_paid(
  p_code        text,
  p_provider    text,
  p_external_id text,
  p_amount      numeric,
  p_payload     jsonb
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_order public.orders%rowtype;
begin
  -- Record the event first. A duplicate raises unique_violation and we stop.
  begin
    insert into public.payment_events (provider, external_id, payload)
    values (p_provider, p_external_id, p_payload);
  exception when unique_violation then
    return false;   -- already handled
  end;

  select * into v_order from public.orders where code = p_code for update;
  if not found then
    raise exception 'Unknown order %', p_code;
  end if;

  -- Never mark an order paid for less than it costs.
  if p_amount < v_order.total then
    update public.orders
       set payment_status = 'failed', payment_amount = p_amount
     where code = p_code;
    return false;
  end if;

  update public.orders
     set payment_status = 'paid',
         payment_provider = p_provider,
         payment_amount = p_amount,
         paid_at = now(),
         status = case when status = 'Awaiting payment' then 'New' else status end
   where code = p_code;

  return true;
end;
$$;

revoke all on function public.mark_order_paid(text, text, text, numeric, jsonb) from public;
-- Intentionally granted to nobody: Edge Functions call it with the service role.

-- ------------------------------------------------------- order_public_status
-- Lets a customer coming back from Whish see whether their payment landed.
-- Returns status only — no name, phone, email or line items — so knowing an
-- order code never exposes personal data.
create or replace function public.order_public_status(p_code text)
returns table (code text, status text, payment_status text, total numeric)
language sql
security definer
set search_path = public
stable
as $$
  select o.code, o.status, o.payment_status, o.total
  from public.orders o
  where o.code = p_code;
$$;

grant execute on function public.order_public_status(text) to anon, authenticated;
