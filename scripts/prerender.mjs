/* Build-time prerender for The Asmar Store.
 *
 * Vite emits one dist/index.html. A crawler asking for /p/netflix gets that
 * file through the SPA fallback, reads the homepage's title and description,
 * and indexes every product page in the shop as a duplicate of the storefront.
 * That is the single biggest reason the shop was invisible to search.
 *
 * So: after the build, write a real HTML file per route with that route's own
 * title, description, canonical, link-preview tags and schema.org block. The
 * body is still the same empty #root — React fills it in for a human — but the
 * head is correct before a single line of JavaScript runs, which is all Google
 * and WhatsApp actually read.
 *
 * Content comes from Supabase when the keys are present, so the prerendered
 * pages describe the real shop rather than the bundled demo. Without keys it
 * falls back to the seed catalogue and still produces a valid site.
 *
 * Run automatically by `npm run build`.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { SEED_CATALOG, SEED_SETTINGS } from "../src/seed.js";
import { metaFor, isNoindex, slugify, SITE_URL } from "../src/seo.js";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const DIST = path.join(ROOT, "dist");

/* ------------------------------------------------------------------ content */
async function loadShop() {
  const url = process.env.VITE_SUPABASE_URL;
  const key = process.env.VITE_SUPABASE_ANON_KEY;

  if (!url || !key || url.includes("your-project")) {
    console.log("  · no Supabase keys — prerendering from the seed catalogue");
    return { catalog: SEED_CATALOG, settings: SEED_SETTINGS, reviews: SEED_SETTINGS.reviews || [] };
  }

  /* Plain REST rather than the client library: this runs in Node at build time
     and does not need auth, realtime or any of the rest of the SDK. */
  const get = async (table, query = "") => {
    const res = await fetch(`${url}/rest/v1/${table}?${query}`, {
      headers: { apikey: key, Authorization: `Bearer ${key}` },
    });
    if (!res.ok) throw new Error(`${table}: ${res.status} ${await res.text()}`);
    return res.json();
  };

  try {
    const [products, settingsRows] = await Promise.all([
      get("products", "select=*&order=position"),
      get("settings", "select=*&id=eq.1"),
    ]);

    const row = settingsRows[0];
    const catalog = products.length
      ? products.map((r) => ({
          id: r.id, name: r.name, category: r.category, note: r.note,
          image: r.image || "", active: r.active, featured: !!r.featured,
          description: r.description || "", warrantyDays: r.warranty_days ?? 30,
          variants: r.variants || [],
        }))
      : SEED_CATALOG;

    const settings = row?.initialized
      ? {
          ...SEED_SETTINGS,
          whatsapp: row.whatsapp, categories: row.categories || [],
          categoryImages: row.category_images || {}, categoryNotes: row.category_notes || {},
          heroTitle: row.hero_title || "", heroSub: row.hero_sub || "",
          socials: row.socials || {}, reviews: row.reviews || [],
        }
      : SEED_SETTINGS;

    console.log(`  · loaded ${catalog.length} products from Supabase`);
    return { catalog, settings, reviews: settings.reviews || [] };
  } catch (e) {
    /* A build must not fail because the database was briefly unreachable. */
    console.warn("  ! could not reach Supabase, falling back to the seed catalogue:", e.message);
    return { catalog: SEED_CATALOG, settings: SEED_SETTINGS, reviews: SEED_SETTINGS.reviews || [] };
  }
}

/* -------------------------------------------------------------------- html */
const esc = (s) =>
  String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/* Strips the tags the template already carries so the route's own versions do
   not end up as a second copy — two og:title tags is undefined behaviour and
   WhatsApp picks whichever it likes. */
function stripExisting(head) {
  return head
    .replace(/\s*<title>[\s\S]*?<\/title>/gi, "")
    .replace(/\s*<meta\s+name="description"[^>]*>/gi, "")
    .replace(/\s*<meta\s+property="og:[^"]*"[^>]*>/gi, "")
    .replace(/\s*<meta\s+name="twitter:[^"]*"[^>]*>/gi, "")
    .replace(/\s*<link\s+rel="canonical"[^>]*>/gi, "");
}

function headFor(m, route) {
  const tags = [
    `<title>${esc(m.title)}</title>`,
    `<meta name="description" content="${esc(m.description)}" />`,
    `<link rel="canonical" href="${esc(m.canonical)}" />`,
    m.noindex
      ? `<meta name="robots" content="noindex, nofollow" />`
      : `<meta name="robots" content="index, follow" />`,
    `<meta property="og:type" content="${route.startsWith("/p/") ? "product" : "website"}" />`,
    `<meta property="og:site_name" content="The Asmar Store" />`,
    `<meta property="og:title" content="${esc(m.title)}" />`,
    `<meta property="og:description" content="${esc(m.description)}" />`,
    `<meta property="og:url" content="${esc(m.canonical)}" />`,
    `<meta property="og:image" content="${esc(m.image)}" />`,
    `<meta property="og:locale" content="en_US" />`,
    `<meta property="og:locale:alternate" content="ar_LB" />`,
    `<meta name="twitter:card" content="summary_large_image" />`,
    `<meta name="twitter:title" content="${esc(m.title)}" />`,
    `<meta name="twitter:description" content="${esc(m.description)}" />`,
    `<meta name="twitter:image" content="${esc(m.image)}" />`,
  ];

  if (m.jsonLd?.length) {
    const data = m.jsonLd.length === 1 ? m.jsonLd[0] : m.jsonLd;
    /* </script> inside JSON would close the tag early. */
    const json = JSON.stringify(data).replace(/</g, "\\u003c");
    tags.push(`<script type="application/ld+json">${json}</script>`);
  }

  return tags.map((t) => "    " + t).join("\n");
}

function writePage(template, route, meta) {
  const head = stripExisting(template).replace("</head>", headFor(meta, route) + "\n  </head>");
  const dir = route === "/" ? DIST : path.join(DIST, route);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, "index.html"), head);
}

/* -------------------------------------------------------------------- main */
const shop = await loadShop();
const template = fs.readFileSync(path.join(DIST, "index.html"), "utf8");

const active = shop.catalog.filter((p) => p.active);
const categories = (shop.settings.categories?.length ? shop.settings.categories : [])
  .filter((c) => active.some((p) => p.category === c));

const routes = [
  "/",
  ...categories.map((c) => `/c/${slugify(c)}`),
  ...active.map((p) => `/p/${slugify(p.name)}`),
  "/track",
  "/page/about",
  "/page/terms",
  "/page/refund",
  "/page/privacy",

  /* The private pages get a shell too, purely so the noindex is in the served
     HTML. Without one they fall through to the root index.html, which says
     "index, follow" — robots.txt already disallows them, but a Disallow only
     stops the crawl, it does not stop the URL being indexed from an inbound
     link. The meta tag is what actually keeps them out. */
  "/login",
  "/account",
  "/topup",
];

console.log("prerendering…");
for (const route of routes) {
  writePage(template, route, metaFor(route, shop));
}
console.log(`  · wrote ${routes.length} pages`);

/* A 404 page that is really the app.
 *
 * Netlify has an explicit 200 rewrite in netlify.toml, so it never gets here.
 * Other static hosts — Replit, GitHub Pages, Cloudflare Pages — have no such
 * rule, and a route that was not prerendered would show their own 404 chrome
 * instead of the shop. /order/<code> is the one that matters: order codes are
 * generated at checkout, so that page can never be prerendered.
 *
 * Serving the app as the 404 body means React boots, reads the path, and
 * renders the right page. The status code is still 404, which is wrong in
 * principle — but every route that lands here is noindex anyway, and every
 * indexable route is a real prerendered file returning 200. */
fs.writeFileSync(
  path.join(DIST, "404.html"),
  stripExisting(template).replace(
    "</head>",
    headFor(metaFor("/", shop), "/") + "\n    <meta name=\"robots\" content=\"noindex\" />\n  </head>",
  ),
);
console.log("  · 404.html (SPA fallback for hosts without a rewrite rule)");

/* ------------------------------------------------------------------ robots */
/* The account, login, top-up and order pages are personal or transactional.
   Keeping crawlers out of them protects customers and stops thin pages
   competing with the product pages that should be ranking. */
fs.writeFileSync(
  path.join(DIST, "robots.txt"),
  `User-agent: *
Allow: /
Disallow: /admin
Disallow: /account
Disallow: /login
Disallow: /topup
Disallow: /order/

Sitemap: ${SITE_URL}/sitemap.xml
`,
);

/* ----------------------------------------------------------------- sitemap */
const today = new Date().toISOString().slice(0, 10);
const indexable = routes.filter((r) => !isNoindex(r));

const urls = indexable
  .map((route) => {
    /* Product pages are the ones meant to rank, the homepage is the entry
       point, policy pages are there for completeness and for the payment
       providers who check them. */
    const priority = route === "/" ? "1.0" : route.startsWith("/p/") ? "0.8"
      : route.startsWith("/c/") ? "0.6" : "0.3";
    const freq = route.startsWith("/page/") ? "yearly" : "weekly";
    return `  <url>
    <loc>${SITE_URL}${route === "/" ? "/" : route}</loc>
    <lastmod>${today}</lastmod>
    <changefreq>${freq}</changefreq>
    <priority>${priority}</priority>
  </url>`;
  })
  .join("\n");

fs.writeFileSync(
  path.join(DIST, "sitemap.xml"),
  `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urls}
</urlset>
`,
);

console.log(`  · sitemap.xml with ${indexable.length} urls`);
console.log(`  · robots.txt`);
console.log(`  · site url: ${SITE_URL}`);
