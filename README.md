# The Asmar Store

A bilingual (EN/AR, with RTL) storefront for digital subscriptions — Tripoli, Lebanon.
React + Vite, Supabase behind it, deployed as static files.

---

## Running it

```bash
npm install
npm run dev          # http://localhost:5173
```

It works with no configuration at all. Without Supabase keys the whole shop runs
against browser `localStorage` — a real, clickable store with a demo catalogue,
on this browser only. Orders placed in that mode reach nobody.

| Command | What it does |
|---|---|
| `npm run dev` | dev server |
| `npm run build` | production build **and** prerenders every page |
| `npm test` | 97 unit tests (helpers, checkout, SEO, translations, full render) |
| `npm run test:e2e` | 30 browser tests, desktop + mobile |
| `npm run test:all` | both |

---

## Running it on Replit

Import the repo (or upload the zip), then press **Run**. `.replit` and
`vite.config.js` already handle the two things that otherwise break:

- Vite binds `0.0.0.0` instead of `localhost`, or Replit's proxy cannot reach it
  and the webview just spins
- Replit's generated subdomain is added to `allowedHosts`, or every page shows
  *"Blocked request. This host is not allowed."*
- HMR is pointed at port 443, or every edit needs a manual refresh

**Do not upload `node_modules`.** It contains Linux/Windows-specific binaries;
run `npm install` in the Replit shell instead.

Environment variables go in the **Secrets** pane (the padlock), not in a file.
Replit exposes them to the build the same way `.env.local` does locally.

---

## Configuration

Copy `.env.example` to `.env.local` and fill in what you need. Everything is
optional except the Supabase pair.

| Variable | Needed for |
|---|---|
| `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY` | a real shared database; without these, orders go nowhere |
| `VITE_SITE_URL` | canonical URLs, `sitemap.xml`, WhatsApp link previews |
| `VITE_ANALYTICS_DOMAIN` | Plausible/Umami; nothing loads until it is set |
| `VITE_ERROR_WEBHOOK` | where crash reports are POSTed |

> **Anything named `VITE_*` is compiled into the browser bundle and is public.**
> The anon key is designed for that. A bot token, a service-role key, or an API
> secret is not — those belong in `supabase secrets`, read server-side by the
> Edge Functions.

---

## Database

Run the SQL in `supabase/`, in order — see `supabase/README.md`. Then open
**Diagnostics** in the admin, which checks every piece and names whatever is
missing rather than leaving you guessing.

Order alerts need one extra step: `node scripts/setup-telegram.mjs <bot-token>`
finds your chat id, sends a test message, and prints the commands that finish
the wiring.

---

## How it fits together

```
asmar-store.jsx          the storefront — routing, pages, cart, checkout
src/admin.jsx            the admin, lazy-loaded so customers never download it
src/backend.js           one interface, two implementations: Supabase or localStorage
src/ui.jsx               design system, i18n provider, shared primitives
src/i18n.js              every customer-facing string, in both languages
src/seo.js               per-route metadata — used by the app and the prerender
scripts/prerender.mjs    writes a real HTML file per page after the build
supabase/*.sql           schema, row-level security, and the money logic
```

A few decisions worth knowing before changing things:

- **Prices are computed server-side.** `place_order()` recalculates the total
  from the database; the browser does not get to decide what anything costs.
- **Paths, not hash routes.** Every product page is a document a crawler can
  index and a link someone can paste into WhatsApp. Old `#/` links still resolve.
- **Reviews are real ones, entered by the owner.** No fake scarcity counters, no
  countdown timers, no invented testimonials — deliberately, even though
  competitors use all three.
- **Arabic falls back to English, never to a blank.** A half-translated shop
  still reads as a complete one.
