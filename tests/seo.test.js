/* The head tags are the whole reason the prerender step exists, and they are
 * generated rather than written, so they need pinning: a wrong canonical or a
 * missing noindex is invisible in the browser and expensive in the index.
 */
import { describe, it, expect } from "vitest";
import { metaFor, isNoindex, SITE_URL } from "../src/seo.js";

const catalog = [
  {
    id: "p1", name: "Netflix", category: "Streaming", note: "Private profile, 4K",
    description: "A private Netflix profile.", active: true, warrantyDays: 30,
    image: "https://cdn.example/netflix.png",
    variants: [{ label: "1 month", price: 4.5 }, { label: "6 months", price: 22 }],
  },
  {
    id: "p2", name: "Shahid VIP", category: "Streaming", note: "Arabic library",
    active: true, warrantyDays: 30, variants: [{ label: "1 month", price: 6 }],
  },
];

const settings = {
  categories: ["Streaming", "Gaming"],
  categoryNotes: {},
  categoryImages: {},
  whatsapp: "96170123456",
  socials: { instagram: "https://instagram.com/asmar" },
};

const reviews = [
  { productId: "p1", name: "Rami", rating: 5, text: "Fast.", date: "2026-05-01" },
  { productId: "p1", name: "Lina", rating: 4, text: "Worked well.", date: "2026-05-04" },
];

const data = { catalog, settings, reviews };

describe("product pages", () => {
  const m = metaFor("/p/netflix", data);

  it("leads with the product and the price someone searched for", () => {
    expect(m.title).toContain("Netflix");
    expect(m.title).toContain("$4.50");
    expect(m.title).toContain("Lebanon");
  });

  it("points its canonical at itself, not the homepage", () => {
    expect(m.canonical).toBe(`${SITE_URL}/p/netflix`);
  });

  it("keeps the description within what a search result will show", () => {
    expect(m.description.length).toBeLessThanOrEqual(158);
  });

  it("uses the product image for the WhatsApp preview when there is one", () => {
    expect(m.image).toBe("https://cdn.example/netflix.png");
  });

  it("declares the real price range as structured data", () => {
    const schema = m.jsonLd[0];
    expect(schema["@type"]).toBe("Product");
    expect(schema.offers.lowPrice).toBe("4.50");
    expect(schema.offers.highPrice).toBe("22.00");
    expect(schema.offers.offerCount).toBe(2);
  });

  it("publishes a rating only from reviews that exist", () => {
    const schema = metaFor("/p/netflix", data).jsonLd[0];
    expect(schema.aggregateRating.ratingValue).toBe("4.5");
    expect(schema.aggregateRating.reviewCount).toBe(2);

    /* Shahid has no reviews. Inventing a rating here is the fastest way to get
       structured data penalised, so there must be no aggregateRating at all. */
    const unreviewed = metaFor("/p/shahid-vip", data).jsonLd[0];
    expect(unreviewed.aggregateRating).toBeUndefined();
    expect(unreviewed.review).toBeUndefined();
  });

  it("does not index a product that no longer exists", () => {
    expect(metaFor("/p/nothing-here", data).noindex).toBe(true);
  });
});

describe("category pages", () => {
  const m = metaFor("/c/streaming", data);

  it("names the category and the city", () => {
    expect(m.title).toContain("Streaming");
    expect(m.title).toContain("Tripoli");
  });

  it("lists its products as an ItemList", () => {
    const schema = m.jsonLd[0];
    expect(schema["@type"]).toBe("CollectionPage");
    expect(schema.mainEntity.numberOfItems).toBe(2);
    expect(schema.mainEntity.itemListElement[0].url).toBe(`${SITE_URL}/p/netflix`);
  });

  it("does not index a category that was renamed or deleted", () => {
    expect(metaFor("/c/does-not-exist", data).noindex).toBe(true);
  });
});

describe("the homepage", () => {
  it("describes the store and the site", () => {
    const types = metaFor("/", data).jsonLd.map((s) => s["@type"]);
    expect(types).toContain("OnlineStore");
    expect(types).toContain("WebSite");
  });

  it("has a canonical with a trailing slash and no duplicate", () => {
    expect(metaFor("/", data).canonical).toBe(`${SITE_URL}/`);
  });
});

describe("pages that must stay out of the index", () => {
  it.each(["/account", "/login", "/topup", "/admin", "/order/ASM-4K2-91X"])(
    "%s is noindex",
    (route) => {
      expect(isNoindex(route)).toBe(true);
      expect(metaFor(route, data).noindex).toBe(true);
    },
  );

  it.each(["/", "/p/netflix", "/c/streaming", "/track", "/page/refund"])(
    "%s stays indexable",
    (route) => {
      expect(isNoindex(route)).toBe(false);
    },
  );
});

describe("every route", () => {
  it.each(["/", "/p/netflix", "/c/streaming", "/track", "/page/about", "/page/terms"])(
    "%s has a title and a description",
    (route) => {
      const m = metaFor(route, data);
      expect(m.title.length).toBeGreaterThan(10);
      expect(m.description.length).toBeGreaterThan(20);
      expect(m.canonical.startsWith("https://")).toBe(true);
    },
  );

  it("survives an empty shop without throwing", () => {
    const empty = { catalog: [], settings: {}, reviews: [] };
    expect(() => metaFor("/", empty)).not.toThrow();
    expect(() => metaFor("/p/netflix", empty)).not.toThrow();
    expect(() => metaFor("/c/streaming", empty)).not.toThrow();
  });
});
