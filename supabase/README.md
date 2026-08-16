# Connecting the shop to a real database

Until this is done the store runs on **localStorage**: everything you type is
saved in your own browser and nothing else. Customers see the bundled demo
products, their orders never reach you, and accounts and balances are a
single-browser simulation.

Admin → **Diagnostics** checks every step below against the live database and
tells you which one is missing. Use it whenever something "doesn't work".

---

## 1. Make the project

[supabase.com](https://supabase.com) → New project. Choose the region closest to
Lebanon (Frankfurt) and keep the database password somewhere safe.

## 2. Run the SQL, in this order

Supabase → **SQL Editor** → New query. Paste each file, run it, then move to the
next. Order matters — later files depend on earlier ones.

| # | File | What it makes |
|---|------|---------------|
| 1 | `schema.sql` | products, settings, orders, `place_order()` |
| 2 | `payments.sql` | Whish payment columns, webhook idempotency |
| 3 | `accounts.sql` | admins, customers, wallet, top-ups; replaces `place_order()` |
| 4 | `receipts.sql` | private `receipts` bucket; moves top-up photos out of the database |
| 5 | `notify.sql` | trigger that pushes a new order to your phone |

All five are safe to run again. If you are unsure whether one worked, just run
it a second time.

`receipts.sql` and `notify.sql` each need a little setup after the SQL — the
storage bucket works immediately, but the order alerts need a Telegram bot
token. The steps are in a comment block at the bottom of `notify.sql`. Until
that is done everything else still works; you just keep finding orders by
opening the admin rather than being told about them.

The admin's **Diagnostics** tab checks all of this and names whatever is
missing, so run it once when you are done here.

## 3. Make yourself the owner

Authentication → **Users** → Add user. Use a real email and a password you will
remember, and tick *Auto Confirm User*.

Then, in the SQL Editor, with **your own email**:

```sql
insert into public.admins (user_id)
select id from auth.users where email = 'you@example.com'
on conflict do nothing;
```

Skip this and the admin panel will let you sign in and then refuse to save
anything — every write is checked against the `admins` table.

## 4. Give the site its keys

Settings → **API**. Copy the *Project URL* and the *anon public* key. These two
are safe in a browser; the `service_role` key is not — never put it in the site.

Create `.env.local` next to `package.json`:

```
VITE_SUPABASE_URL=https://xxxx.supabase.co
VITE_SUPABASE_ANON_KEY=eyJhbGci...
```

Restart the dev server. For the live site, add the same two under
Netlify → Site settings → **Environment variables**, then redeploy.

## 5. Upload your catalogue

Sign in to the admin, go to **Settings** → *Push this catalogue to the database*.
Until you do, the products table is empty and customers see the demo catalogue.

## 6. Deploy the functions

Needed for creating customer logins and for online payment. Install the
[Supabase CLI](https://supabase.com/docs/guides/cli), then:

```
supabase login
supabase link --project-ref <your-project-ref>
supabase functions deploy admin-create-customer
supabase functions deploy whish-create-payment
supabase functions deploy whish-callback
```

Set the payment secrets (these live on the server and never reach a browser):

```
supabase secrets set WHISH_API_URL=... WHISH_CHANNEL=... WHISH_SECRET=...
supabase secrets set WHISH_CALLBACK_SECRET=... PUBLIC_SITE_URL=https://your-site
```

`admin-create-customer` needs no secrets — Supabase provides what it uses.

---

## Still to finish

`whish-create-payment` and `whish-callback` each have one function left blank —
`createWhishCheckout()` and `callbackIsAuthentic()`. They need Whish's API
documentation, which arrives with your merchant approval. Until then the
callback **fails closed**: it refuses everything rather than trusting an
unsigned request, so nobody can mark an order paid by guessing the URL.

Online card payment is the only thing that needs them. Cash on delivery, manual
Whish and OMT transfers, and paying from balance all work without them.
