/* Bilingual coverage.
 *
 * Being the only shop in this niche that speaks both languages is the whole
 * differentiator, and it degrades silently: translate() falls back to English
 * for a missing Arabic key, so a half-translated page looks fine to whoever
 * added the string and wrong to half the customers.
 *
 * This reads the tables straight out of the source rather than importing them,
 * because they are module-private on purpose.
 */
import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { translate } from "../src/i18n.js";

const SRC = path.resolve(__dirname, "..");
const i18nSource = fs.readFileSync(path.join(SRC, "src/i18n.js"), "utf8");

const keysBetween = (from, to) => {
  const chunk = i18nSource.slice(i18nSource.indexOf(from), i18nSource.indexOf(to));
  return new Set([...chunk.matchAll(/^\s*"([^"]+)"\s*:/gm)].map((m) => m[1]));
};

const en = keysBetween("const en = {", "const ar = {");
const ar = keysBetween("const ar = {", "const TABLE");

/* Every key the app asks for. Not just t("literal") — plurals are chosen with a
   ternary inside the call, e.g.
       t(n === 1 ? "rev.one" : "rev.count", { n })
   so both arms have to be picked up, otherwise the unused-key check below
   reports every plural pair in the shop as dead. Keys reached through the
   lookup maps (walletKindKey, topupStatusKey) and the `page.${key}` template
   are matched separately by their namespace. */
const usedKeys = () => {
  const used = new Set();
  for (const f of ["asmar-store.jsx", "src/ui.jsx", "src/admin.jsx"]) {
    const s = fs.readFileSync(path.join(SRC, f), "utf8");
    /* the whole argument list of each t(...) call, one nesting level deep */
    for (const call of s.matchAll(/\bt\(([^()]*(?:\([^()]*\)[^()]*)*)\)/g)) {
      for (const lit of call[1].matchAll(/"([a-zA-Z]+\.[A-Za-z0-9_]+)"/g)) used.add(lit[1]);
    }
    for (const m of s.matchAll(/"((?:wal|page)\.[A-Za-z0-9_]+)"/g)) used.add(m[1]);
  }
  return used;
};

describe("translation tables", () => {
  it("has the same keys in both languages", () => {
    const missingAr = [...en].filter((k) => !ar.has(k));
    const missingEn = [...ar].filter((k) => !en.has(k));
    expect(missingAr, "keys with no Arabic — these silently show English").toEqual([]);
    expect(missingEn, "Arabic keys with no English — these are dead").toEqual([]);
  });

  it("is not empty, i.e. the parser above still matches the file", () => {
    expect(en.size).toBeGreaterThan(150);
    expect(ar.size).toBe(en.size);
  });

  it("has no blank strings in either language", () => {
    const blanks = [...i18nSource.matchAll(/^\s*"([^"]+)"\s*:\s*""\s*,?\s*$/gm)].map((m) => m[1]);
    expect(blanks).toEqual([]);
  });
});

describe("keys the app actually asks for", () => {
  it("all exist, so nothing renders as a raw key", () => {
    const missing = [...usedKeys()].filter((k) => !en.has(k));
    expect(missing).toEqual([]);
  });

  it("has no strings left defined but unreferenced", () => {
    const used = usedKeys();
    const unused = [...en].filter((k) => !used.has(k) && !k.startsWith("lang."));
    expect(unused).toEqual([]);
  });
});

describe("translate()", () => {
  it("substitutes every occurrence of a placeholder", () => {
    expect(translate("en", "cat.matches", { n: 3, q: "net" })).toContain("3");
    expect(translate("en", "cat.matches", { n: 3, q: "net" })).toContain("net");
  });

  it("falls back to English rather than showing a raw key", () => {
    expect(translate("ar", "definitely.not.a.key")).toBe("definitely.not.a.key");
    expect(translate("fr", "nav.cart")).toBe(translate("en", "nav.cart"));
  });

  it("returns Arabic when Arabic exists", () => {
    expect(translate("ar", "nav.cart")).not.toBe(translate("en", "nav.cart"));
  });
});
