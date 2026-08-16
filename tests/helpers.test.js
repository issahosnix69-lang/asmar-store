/* The pure functions behind every price on the site.
 *
 * These are small enough to look obviously correct, which is exactly why they
 * are worth pinning: a change to money() or discountPct() is invisible in
 * review and visible on every product card in the shop.
 */
import { describe, it, expect } from "vitest";
import {
  money, emailOk, phoneOk, slugify, lowestPrice, pick,
  discountPct, hasOffer, avgRating,
} from "../src/ui.jsx";

describe("money", () => {
  it("always shows two decimals", () => {
    expect(money(5)).toBe("$5.00");
    expect(money(4.5)).toBe("$4.50");
    expect(money(0)).toBe("$0.00");
  });

  it("rounds to the nearest cent", () => {
    expect(money(4.006)).toBe("$4.01");
    expect(money(4.004)).toBe("$4.00");
    /* 4.005 is not exactly representable in binary — it is stored as
       4.00499999… and so rounds down. Pinned because it is surprising, not
       because it matters: prices here are set in half-dollar steps. */
    expect(money(4.005)).toBe("$4.00");
  });

  it("copes with strings, because variant prices come back from JSON", () => {
    expect(money("12.5")).toBe("$12.50");
  });
});

describe("emailOk", () => {
  it("accepts real addresses", () => {
    expect(emailOk("ali@gmail.com")).toBe(true);
    expect(emailOk("  ali.asmar+shop@sub.domain.co  ")).toBe(true);
  });

  it("rejects the shapes that cost an undeliverable order", () => {
    expect(emailOk("ali@gmail")).toBe(false);      // no TLD
    expect(emailOk("ali gmail.com")).toBe(false);  // no @
    expect(emailOk("@gmail.com")).toBe(false);     // no local part
    expect(emailOk("")).toBe(false);
  });
});

describe("phoneOk", () => {
  it("counts digits and ignores the formatting people actually type", () => {
    expect(phoneOk("+961 70 123 456")).toBe(true);
    expect(phoneOk("70-123-456")).toBe(true);
  });

  it("rejects anything too short to dial", () => {
    expect(phoneOk("70123")).toBe(false);
    expect(phoneOk("")).toBe(false);
  });
});

describe("slugify", () => {
  it("makes a readable url segment", () => {
    expect(slugify("Netflix")).toBe("netflix");
    expect(slugify("Shahid VIP")).toBe("shahid-vip");
    expect(slugify("Disney+")).toBe("disney");
  });

  it("spells out & so two products cannot collide on a stripped character", () => {
    expect(slugify("Film & TV")).toBe("film-and-tv");
  });

  it("never leaves a leading or trailing dash", () => {
    expect(slugify("  ChatGPT Plus  ")).toBe("chatgpt-plus");
    expect(slugify("+++")).toBe("");
  });
});

describe("lowestPrice", () => {
  it("finds the cheapest variant, which is what 'from $x' promises", () => {
    expect(lowestPrice({ variants: [{ price: 12 }, { price: 4.5 }, { price: 22 }] })).toBe(4.5);
  });

  it("does not return Infinity for a product with no variants yet", () => {
    expect(lowestPrice({ variants: [] })).toBe(0);
    expect(lowestPrice({})).toBe(0);
  });
});

describe("discountPct", () => {
  it("reports a genuine markdown", () => {
    expect(discountPct({ price: 8, compareAt: 10 })).toBe(20);
  });

  it("refuses to invent one", () => {
    expect(discountPct({ price: 10, compareAt: 10 })).toBe(0);
    expect(discountPct({ price: 10, compareAt: 8 })).toBe(0);   // "was" below "now"
    expect(discountPct({ price: 10 })).toBe(0);
    expect(discountPct(null)).toBe(0);
  });
});

describe("hasOffer", () => {
  it("is true when any one variant is discounted", () => {
    expect(hasOffer({ variants: [{ price: 10 }, { price: 8, compareAt: 12 }] })).toBe(true);
  });

  it("is false for a product with no markdown anywhere", () => {
    expect(hasOffer({ variants: [{ price: 10 }] })).toBe(false);
    expect(hasOffer({})).toBe(false);
  });
});

describe("pick — bilingual fallback", () => {
  it("prefers Arabic on an Arabic page", () => {
    expect(pick("ar", "Streaming", "بث")).toBe("بث");
  });

  it("falls back to English when the Arabic was never written", () => {
    expect(pick("ar", "Streaming", "")).toBe("Streaming");
    expect(pick("ar", "Streaming", "   ")).toBe("Streaming");
    expect(pick("ar", "Streaming", undefined)).toBe("Streaming");
  });

  it("never shows Arabic on an English page", () => {
    expect(pick("en", "Streaming", "بث")).toBe("Streaming");
  });
});

describe("avgRating", () => {
  it("averages the stars", () => {
    expect(avgRating([{ rating: 5 }, { rating: 4 }])).toBe(4.5);
  });

  it("is 0 for a product nobody has reviewed", () => {
    expect(avgRating([])).toBe(0);
  });
});
