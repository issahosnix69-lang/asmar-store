/* The money maths behind the Reports tab.
 *
 * Tested apart from the UI because a dashboard fails quietly: a wrong figure
 * still renders, still looks plausible, and gets believed. The cases below are
 * the ones where a plausible wrong answer was available — an uncosted order
 * read as free, a cancelled order read as income, a month boundary read in the
 * wrong timezone.
 */
import { describe, it, expect } from "vitest";
import { summarise, byMonth, byProduct, byCustomer, periodRange, withinPeriod } from "../src/reports.js";

const order = (over = {}) => ({
  code: "ASM-1",
  status: "Delivered",
  total: 20,
  createdAt: "2026-08-10T12:00:00.000Z",
  customer: { name: "Rami", phone: "70123456" },
  items: [{ name: "Netflix", label: "1 month", price: 20, qty: 1 }],
  ...over,
});

describe("summarise", () => {
  it("counts only delivered orders as revenue", () => {
    const s = summarise([
      order({ code: "a", total: 20 }),
      order({ code: "b", total: 50, status: "New" }),
      order({ code: "c", total: 90, status: "Cancelled" }),
    ]);
    expect(s.revenue).toBe(20);
    expect(s.delivered).toBe(1);
    expect(s.orders).toBe(3);
  });

  it("treats an order still owed as a liability, not as income", () => {
    const s = summarise([
      order({ code: "a", total: 20 }),
      order({ code: "b", total: 50, status: "New" }),
      order({ code: "c", total: 90, status: "Cancelled" }),
    ]);
    /* The cancelled one is not owed either. */
    expect(s.unfulfilled).toBe(50);
  });

  it("does not read a missing cost as a cost of zero", () => {
    /* The whole trap of manual cost entry: an uncosted $20 sale looks like $20
       of pure profit unless it is excluded. */
    const s = summarise(
      [order({ code: "a", total: 20 }), order({ code: "b", total: 30 })],
      { a: { cost: 8 } },
    );
    expect(s.revenue).toBe(50);
    expect(s.profit).toBe(12);
    expect(s.missingCost).toBe(1);
  });

  it("takes margin against the revenue it has costs for", () => {
    const s = summarise(
      [order({ code: "a", total: 20 }), order({ code: "b", total: 80 })],
      { a: { cost: 15 } },
    );
    /* 5 profit on the 20 that was costed — 6.25%, not 5/100. */
    expect(s.margin).toBeCloseTo(0.25, 5);
  });

  it("has no margin at all rather than a zero when nothing is costed", () => {
    const s = summarise([order()], {});
    expect(s.margin).toBeNull();
  });

  it("survives an order with a broken date", () => {
    const s = summarise([order({ createdAt: "not a date" })], {}, periodRange("all"));
    expect(s.orders).toBe(1);
  });
});

describe("periods", () => {
  const now = new Date(2026, 7, 21);   // 21 August 2026, local

  it("starts this month on the first, in local time", () => {
    const { from } = periodRange("month", now);
    expect(from.getDate()).toBe(1);
    expect(from.getMonth()).toBe(7);
    /* Midnight local. A UTC-based range puts the 1st into July for anyone
       east of Greenwich, which is where this shop is. */
    expect(from.getHours()).toBe(0);
  });

  it("ends last month on its final day, not on the 1st of this one", () => {
    const { from, to } = periodRange("lastMonth", now);
    expect(from.getMonth()).toBe(6);
    expect(to.getMonth()).toBe(6);
    expect(to.getDate()).toBe(31);
  });

  it("covers 30 days including today", () => {
    const { from } = periodRange("30d", now);
    expect(Math.round((now - from) / 86400000)).toBe(29);
  });

  it("bounds nothing when the period is all time", () => {
    const r = periodRange("all", now);
    expect(r.from).toBeNull();
    expect(r.to).toBeNull();
    expect(withinPeriod(order({ createdAt: "2019-01-01T00:00:00Z" }), r)).toBe(true);
  });
});

describe("byMonth", () => {
  it("returns an unbroken run of months, including empty ones", () => {
    const rows = byMonth([], {}, 6, new Date(2026, 7, 21));
    expect(rows).toHaveLength(6);
    expect(rows[5].key).toBe("2026-08");
    expect(rows[0].key).toBe("2026-03");
    expect(rows.every((r) => r.revenue === 0)).toBe(true);
  });

  it("ignores orders older than the window instead of folding them into the first month", () => {
    const rows = byMonth(
      [order({ createdAt: "2020-01-05T10:00:00Z", total: 999 })],
      {}, 6, new Date(2026, 7, 21),
    );
    expect(rows.reduce((s, r) => s + r.revenue, 0)).toBe(0);
  });
});

describe("byProduct", () => {
  it("splits one order's cost across its lines by their share of the total", () => {
    const rows = byProduct(
      [order({
        code: "a", total: 100,
        items: [
          { name: "Netflix", price: 75, qty: 1 },
          { name: "Spotify", price: 25, qty: 1 },
        ],
      })],
      { a: { cost: 40 } },
    );
    const netflix = rows.find((r) => r.name === "Netflix");
    const spotify = rows.find((r) => r.name === "Spotify");
    expect(netflix.cost).toBeCloseTo(30, 5);
    expect(spotify.cost).toBeCloseTo(10, 5);
    expect(netflix.profit).toBeCloseTo(45, 5);
  });

  it("counts revenue but no profit for a line whose order has no cost", () => {
    const rows = byProduct([order({ code: "a", total: 20 })], {});
    expect(rows[0].revenue).toBe(20);
    expect(rows[0].costed).toBe(0);
    expect(rows[0].profit).toBe(0);
  });

  it("sorts the biggest earner first", () => {
    const rows = byProduct([
      order({ code: "a", total: 10, items: [{ name: "Spotify", price: 10, qty: 1 }] }),
      order({ code: "b", total: 60, items: [{ name: "Netflix", price: 60, qty: 1 }] }),
    ], {});
    expect(rows[0].name).toBe("Netflix");
  });
});

describe("byCustomer", () => {
  it("groups a repeat buyer by phone rather than by name", () => {
    const rows = byCustomer([
      order({ code: "a", total: 20, customer: { name: "Rami", phone: "70123456" } }),
      order({ code: "b", total: 30, customer: { name: "rami h", phone: "70123456" } }),
    ]);
    expect(rows).toHaveLength(1);
    expect(rows[0].orders).toBe(2);
    expect(rows[0].spent).toBe(50);
  });
});
