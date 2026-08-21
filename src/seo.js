/* Per-route metadata for The Asmar Store.
 *
 * Two callers, one source of truth:
 *   - the browser, through useDocumentMeta(), so a shared link and an in-app
 *     navigation produce the same title and preview card
 *   - scripts/prerender.mjs at build time, so a crawler that never runs any
 *     JavaScript still gets a real <title> and description per page
 *
 * Keep this file free of React and of anything browser-only — the build script
 * imports it under plain Node.
 */

export const SITE_NAME = "The Asmar Store";

/* No trailing slash. Overridden per environment; the live domain is the
   fallback so a build with no env set still emits absolute URLs — and emits
   the right ones, rather than the dead Netlify address this used to name,
   which quietly put a hostname nobody owns into every canonical tag and every
   WhatsApp preview whenever VITE_SITE_URL was missing. */
export const SITE_URL =
  (typeof process !== "undefined" && process.env?.VITE_SITE_URL) ||
  (typeof import.meta !== "undefined" && import.meta.env?.VITE_SITE_URL) ||
  "https://asmarr.store";

const clean = (s, max = 158) => {
  const t = String(s || "").replace(/\s+/g, " ").trim();
  return t.length > max ? t.slice(0, max - 1).trimEnd() + "…" : t;
};

const money = (n) => `$${Number(n).toFixed(2)}`;

export const slugify = (s) =>
  String(s).toLowerCase().trim().replace(/&/g, "and").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");

const lowestPrice = (p) =>
  Math.min(...(p.variants?.length ? p.variants : [{ price: 0 }]).map((v) => v.price));

/* ------------------------------------------------------------------ pages */
/* Titles are written for a search result, not for a browser tab: the product
   name first because that is what was searched for, the city because that is
   what makes this shop rather than any other shop the answer. */
const STATIC_TITLES = {
  "/track": "Track your order",
  "/login": "Sign in",
  "/account": "Your account",
  "/topup": "Add funds",
  "/page/about": "About us",
  "/page/terms": "Terms of service",
  "/page/refund": "Refund & warranty",
  "/page/privacy": "Privacy policy",
};

/* Pages that must never be indexed: they are either personal, transactional, or
   a thin duplicate of something better. */
const NOINDEX = ["/login", "/account", "/topup", "/admin", "/order/"];

export function isNoindex(route) {
  return NOINDEX.some((p) => route === p || route.startsWith(p));
}

/**
 * Everything the <head> needs for one route.
 * @param {string} route     e.g. "/p/netflix"
 * @param {object} data      { catalog, settings, categories, reviews }
 */
export function metaFor(route, data = {}) {
  const { catalog = [], settings = {}, reviews = [] } = data;
  const base = {
    title: `${SITE_NAME} — Subscriptions, delivered in minutes`,
    description:
      "Netflix, Spotify, Shahid VIP, Canva and more — delivered to your WhatsApp in minutes. Tripoli, Lebanon. Cash on delivery or pay online.",
    canonical: SITE_URL + (route === "/" ? "/" : route),
    image: `${SITE_URL}/og.png`,
    noindex: isNoindex(route),
    jsonLd: null,
  };

  /* ---- home ---- */
  if (route === "/") {
    return {
      ...base,
      title: settings.heroTitle?.trim()
        ? `${SITE_NAME} — ${clean(settings.heroTitle, 60)}`
        : base.title,
      description: clean(settings.heroSub) || base.description,
      jsonLd: [storeSchema(settings), websiteSchema()],
    };
  }

  /* ---- product ---- */
  const pm = route.match(/^\/p\/(.+)$/);
  if (pm) {
    const key = decodeURIComponent(pm[1]);
    const p = catalog.find((x) => slugify(x.name) === key) || catalog.find((x) => x.id === key);
    if (!p) return { ...base, title: `Not found — ${SITE_NAME}`, noindex: true };
    const price = lowestPrice(p);
    const mine = reviews.filter((r) => r.productId === p.id);
    return {
      ...base,
      title: `${p.name} subscription in Lebanon — from ${money(price)} | ${SITE_NAME}`,
      description: clean(
        p.description || p.note
          ? `${p.name} — ${p.note || ""}. ${p.description || ""} Delivered to your WhatsApp in minutes, ${p.warrantyDays ?? 30}-day warranty. Tripoli, Lebanon.`
          : base.description,
      ),
      image: p.image?.startsWith("http") ? p.image : base.image,
      jsonLd: [productSchema(p, price, mine, settings)],
    };
  }

  /* ---- category ---- */
  const cm = route.match(/^\/c\/(.+)$/);
  if (cm) {
    const key = decodeURIComponent(cm[1]);
    const cats = settings.categories || [];
    const name = cats.find((c) => slugify(c) === key);
    if (!name) return { ...base, noindex: true };
    const items = catalog.filter((p) => p.active && p.category === name);
    const note = (settings.categoryNotes || {})[name];
    return {
      ...base,
      title: `${name} subscriptions in Tripoli, Lebanon | ${SITE_NAME}`,
      description: clean(
        note ||
          `${items.length} ${name.toLowerCase()} subscription${items.length === 1 ? "" : "s"} — ${items
            .slice(0, 6)
            .map((p) => p.name)
            .join(", ")}. Delivered in minutes, cash on delivery or pay online.`,
      ),
      image: (settings.categoryImages || {})[name]?.startsWith("http")
        ? settings.categoryImages[name]
        : base.image,
      jsonLd: [categorySchema(name, items, route)],
    };
  }

  /* ---- static ---- */
  if (STATIC_TITLES[route]) {
    return { ...base, title: `${STATIC_TITLES[route]} | ${SITE_NAME}` };
  }

  return base;
}

/* ------------------------------------------------------------- schema.org */
/* Rich results are the reason these exist: a product page that declares its
   price and rating can show both directly in Google, which is a much bigger
   click-through difference than any wording change to the title. */
function productSchema(p, price, reviews, settings) {
  const schema = {
    "@context": "https://schema.org",
    "@type": "Product",
    name: p.name,
    description: clean(p.description || p.note, 300),
    category: p.category,
    ...(p.image ? { image: [p.image] } : {}),
    brand: { "@type": "Brand", name: p.name },
    offers: {
      "@type": "AggregateOffer",
      priceCurrency: "USD",
      lowPrice: price.toFixed(2),
      highPrice: Math.max(...(p.variants || [{ price }]).map((v) => v.price)).toFixed(2),
      offerCount: (p.variants || []).length || 1,
      availability: "https://schema.org/InStock",
      url: `${SITE_URL}/p/${slugify(p.name)}`,
      seller: { "@type": "Organization", name: SITE_NAME },
    },
  };

  /* Only claim a rating when real reviews exist. Inventing one is the fastest
     way to get structured data penalised, and these are admin-entered real
     reviews — there is no fake-review source to draw on. */
  if (reviews.length) {
    const avg = reviews.reduce((s, r) => s + Number(r.rating || 0), 0) / reviews.length;
    schema.aggregateRating = {
      "@type": "AggregateRating",
      ratingValue: avg.toFixed(1),
      reviewCount: reviews.length,
      bestRating: 5,
      worstRating: 1,
    };
    schema.review = reviews.slice(0, 5).map((r) => ({
      "@type": "Review",
      author: { "@type": "Person", name: r.name },
      reviewRating: { "@type": "Rating", ratingValue: Number(r.rating), bestRating: 5 },
      reviewBody: r.text,
      ...(r.date ? { datePublished: r.date } : {}),
    }));
  }

  if (p.warrantyDays > 0) {
    schema.hasMerchantReturnPolicy = {
      "@type": "MerchantReturnPolicy",
      applicableCountry: "LB",
      returnPolicyCategory: "https://schema.org/MerchantReturnFiniteReturnWindow",
      merchantReturnDays: p.warrantyDays,
    };
  }

  void settings;
  return schema;
}

function categorySchema(name, items, route) {
  return {
    "@context": "https://schema.org",
    "@type": "CollectionPage",
    name: `${name} subscriptions`,
    url: SITE_URL + route,
    mainEntity: {
      "@type": "ItemList",
      numberOfItems: items.length,
      itemListElement: items.slice(0, 20).map((p, i) => ({
        "@type": "ListItem",
        position: i + 1,
        url: `${SITE_URL}/p/${slugify(p.name)}`,
        name: p.name,
      })),
    },
  };
}

function storeSchema(settings) {
  const s = {
    "@context": "https://schema.org",
    "@type": "OnlineStore",
    name: SITE_NAME,
    url: SITE_URL + "/",
    image: `${SITE_URL}/og.png`,
    address: {
      "@type": "PostalAddress",
      addressLocality: "Tripoli",
      addressCountry: "LB",
    },
    areaServed: { "@type": "Country", name: "Lebanon" },
  };
  if (settings.whatsapp) s.telephone = "+" + settings.whatsapp;
  const socials = Object.values(settings.socials || {}).filter(Boolean);
  if (socials.length) s.sameAs = socials;
  return s;
}

function websiteSchema() {
  return {
    "@context": "https://schema.org",
    "@type": "WebSite",
    name: SITE_NAME,
    url: SITE_URL + "/",
    inLanguage: ["en", "ar"],
  };
}
