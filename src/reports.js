/* The numbers behind the Reports tab.
 *
 * Pure functions over the orders the admin already holds, kept out of the
 * component so they can be tested without rendering anything — money is the
 * one place in this shop where a quietly wrong number is worse than a visible
 * crash, because nobody double-checks a figure that looks plausible.
 *
 * Two rules run through all of it.
 *
 * Revenue counts a *delivered* order and nothing else. A cancelled order is
 * not income, and an order still sitting in New is a promise — counting either
 * one produces a figure that goes down later, which is the fastest way to stop
 * trusting a dashboard.
 *
 * Profit is only ever reported for orders whose cost was actually recorded.
 * Costs are typed in by hand here, so a missing one is normal, and treating it
 * as zero would silently inflate profit by the whole sale price. Those orders
 * are excluded and counted separately instead, so the gap is visible rather
 * than baked into the total.
 */

export const DELIVERED = "Delivered";

/* Local dates, not UTC. "This month" has to mean the month it is in Tripoli,
   not the month it is in Greenwich — otherwise the first and last day of every
   month land in the wrong bucket for part of the day. */
const startOfDay = (d) => new Date(d.getFullYear(), d.getMonth(), d.getDate());
const monthKey = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;

/** The windows offered in the period switcher. `from`/`to` are inclusive. */
export function periodRange(period, now = new Date()) {
  const today = startOfDay(now);
  switch (period) {
    case "month":
      return { from: new Date(today.getFullYear(), today.getMonth(), 1), to: null };
    case "lastMonth": {
      const from = new Date(today.getFullYear(), today.getMonth() - 1, 1);
      /* Day 0 of this month is the last day of the previous one. */
      const to = new Date(today.getFullYear(), today.getMonth(), 0, 23, 59, 59, 999);
      return { from, to };
    }
    case "30d": {
      const from = new Date(today);
      from.setDate(from.getDate() - 29);
      return { from, to: null };
    }
    default:
      return { from: null, to: null };
  }
}

export function withinPeriod(order, { from, to }) {
  const at = new Date(order.createdAt);
  if (Number.isNaN(at.getTime())) {
    /* A date that will not parse cannot be placed inside a bounded window, so
       it is left out of one. But dropping it from "all time" as well would
       quietly remove a real sale from the total the shop is judged by, and a
       total that is silently short is worse than one carrying an oddity. */
    return !from && !to;
  }
  if (from && at < from) return false;
  if (to && at > to) return false;
  return true;
}

const costOf = (costs, code) => costs?.[code]?.cost;

/**
 * The headline figures.
 *
 * `missingCost` is not a footnote — with costs entered by hand it is the
 * number that says how much of the profit figure to believe.
 */
export function summarise(orders, costs = {}, range = { from: null, to: null }) {
  const inRange = orders.filter((o) => withinPeriod(o, range));
  const delivered = inRange.filter((o) => o.status === DELIVERED);

  const revenue = delivered.reduce((s, o) => s + Number(o.total || 0), 0);

  const withCost = delivered.filter((o) => costOf(costs, o.code) !== undefined);
  const costed = withCost.reduce((s, o) => s + Number(o.total || 0), 0);
  const cost = withCost.reduce((s, o) => s + costOf(costs, o.code), 0);
  const profit = costed - cost;

  return {
    orders: inRange.length,
    delivered: delivered.length,
    revenue,
    /* Revenue of the delivered orders that have a cost, so margin divides two
       figures drawn from the same set of orders rather than comparing profit
       against revenue it was never part of. */
    costedRevenue: costed,
    cost,
    profit,
    margin: costed > 0 ? profit / costed : null,
    missingCost: delivered.length - withCost.length,
    averageOrder: delivered.length ? revenue / delivered.length : 0,
    /* Money already taken that has not been delivered against — a real
       liability, and the reason revenue alone is a flattering number. */
    unfulfilled: inRange
      .filter((o) => o.status !== DELIVERED && o.status !== "Cancelled")
      .reduce((s, o) => s + Number(o.total || 0), 0),
  };
}

/** Revenue and profit per calendar month, oldest first, for the chart. */
export function byMonth(orders, costs = {}, months = 6, now = new Date()) {
  const buckets = new Map();
  for (let i = months - 1; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    buckets.set(monthKey(d), { key: monthKey(d), date: d, revenue: 0, profit: 0, orders: 0 });
  }

  for (const o of orders) {
    if (o.status !== DELIVERED) continue;
    const at = new Date(o.createdAt);
    if (Number.isNaN(at.getTime())) continue;
    const bucket = buckets.get(monthKey(at));
    if (!bucket) continue;                      // older than the window
    bucket.revenue += Number(o.total || 0);
    bucket.orders += 1;
    const c = costOf(costs, o.code);
    if (c !== undefined) bucket.profit += Number(o.total || 0) - c;
  }

  return [...buckets.values()];
}

/**
 * Per product, so the question "what is worth stocking" has an answer.
 *
 * An order's cost is recorded for the whole order, not per line, so it is
 * apportioned across the lines by their share of the order total. That is an
 * estimate and is labelled as one in the UI — but a five-line order whose cost
 * all landed on line one would be worse than an estimate, it would be wrong.
 */
export function byProduct(orders, costs = {}, range = { from: null, to: null }) {
  const rows = new Map();

  for (const o of orders) {
    if (o.status !== DELIVERED || !withinPeriod(o, range)) continue;

    const total = Number(o.total || 0);
    const orderCost = costOf(costs, o.code);
    const items = o.items || [];

    for (const i of items) {
      const key = i.name || "—";
      const line = Number(i.price || 0) * Number(i.qty || 1);
      const row = rows.get(key) || { name: key, qty: 0, revenue: 0, cost: 0, costed: 0 };
      row.qty += Number(i.qty || 1);
      row.revenue += line;
      if (orderCost !== undefined && total > 0) {
        row.cost += orderCost * (line / total);
        row.costed += line;
      }
      rows.set(key, row);
    }
  }

  return [...rows.values()]
    .map((r) => ({ ...r, profit: r.costed - r.cost }))
    .sort((a, b) => b.revenue - a.revenue);
}

/** Who buys, so a regular can be recognised as one. */
export function byCustomer(orders, range = { from: null, to: null }) {
  const rows = new Map();

  for (const o of orders) {
    if (o.status !== DELIVERED || !withinPeriod(o, range)) continue;
    /* Phone over email: it is the number Ali actually messages, and it is the
       one field a customer cannot mistype twice and still receive an order. */
    const key = o.customer?.phone || o.customer?.email || "—";
    const row = rows.get(key) || {
      key, name: o.customer?.name || "—", phone: o.customer?.phone || "", orders: 0, spent: 0,
    };
    row.orders += 1;
    row.spent += Number(o.total || 0);
    rows.set(key, row);
  }

  return [...rows.values()].sort((a, b) => b.spent - a.spent);
}
