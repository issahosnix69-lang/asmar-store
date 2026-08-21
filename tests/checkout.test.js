/* The money path, in local mode.
 *
 * Supabase enforces all of this server-side in place_order(), which is where it
 * belongs. These tests cover the localStorage twin, which is what runs before
 * the keys are configured and what every click-through of the shop on this
 * machine actually exercises — so if it disagrees with the server, testing the
 * shop locally quietly teaches you the wrong thing.
 */
import { describe, it, expect, beforeEach } from "vitest";
import { placeOrder, fetchAccount, fetchOrderStatus, auth, oneRow } from "../src/backend.js";

const CUSTOMER = { name: "Rami", phone: "70123456", email: "rami@example.com", payment: "cod", notes: "" };
const ITEMS = [{ key: "p1|1 month", id: "p1", name: "Netflix", label: "1 month", price: 4.5, qty: 2 }];

/* Accounts are admin-created; there is no signup. Seed one directly. */
function seedAccount({ id = "cus-1", email = "rami@example.com", balance = 0 } = {}) {
  localStorage.setItem("asmar:accounts", JSON.stringify([
    { id, email, password: "pw", name: "Rami", phone: "70123456", active: true },
  ]));
  localStorage.setItem("asmar:session", JSON.stringify({
    user: { id, email, name: "Rami", isAdmin: false },
  }));
  if (balance) {
    localStorage.setItem("asmar:wallet", JSON.stringify([
      { id: 1, customerId: id, amount: balance, kind: "topup", ref: "TOP-1", created_at: new Date().toISOString() },
    ]));
  }
  return id;
}

beforeEach(() => localStorage.clear());

describe("placing an order", () => {
  it("refuses without a signed-in account, the way the database does", async () => {
    await expect(placeOrder({ items: ITEMS, customer: CUSTOMER, total: 9 }))
      .rejects.toThrow(/sign in/i);
  });

  it("issues a trackable code and stores the order", async () => {
    seedAccount();
    const order = await placeOrder({ items: ITEMS, customer: CUSTOMER, total: 9 });
    expect(order.code).toMatch(/^ASM-[A-Z0-9]+-[A-Z0-9]+$/);
    expect(order.total).toBe(9);
    expect(order.status).toBe("New");
    expect(order.paymentStatus).toBe("unpaid");
  });

  it("marks an unpaid online order as awaiting payment, not new", async () => {
    seedAccount();
    const order = await placeOrder({
      items: ITEMS, customer: { ...CUSTOMER, payment: "online" }, total: 9,
    });
    expect(order.status).toBe("Awaiting payment");
  });

  it("gives every order a distinct code", async () => {
    seedAccount();
    const codes = new Set();
    for (let i = 0; i < 25; i++) {
      codes.add((await placeOrder({ items: ITEMS, customer: CUSTOMER, total: 9 })).code);
    }
    expect(codes.size).toBe(25);
  });
});

describe("paying from the balance", () => {
  it("debits exactly the order total", async () => {
    seedAccount({ balance: 20 });
    await placeOrder({ items: ITEMS, customer: CUSTOMER, total: 9, useBalance: true });
    const account = await fetchAccount();
    expect(account.balance).toBe(11);
  });

  it("refuses to spend money that is not there, and writes no order", async () => {
    seedAccount({ balance: 5 });
    await expect(
      placeOrder({ items: ITEMS, customer: CUSTOMER, total: 9, useBalance: true }),
    ).rejects.toThrow(/not enough/i);

    const account = await fetchAccount();
    expect(account.balance).toBe(5);
    expect(account.orders).toHaveLength(0);
  });

  it("cannot be drained below zero by repeated orders", async () => {
    seedAccount({ balance: 10 });
    await placeOrder({ items: ITEMS, customer: CUSTOMER, total: 6, useBalance: true });
    await expect(
      placeOrder({ items: ITEMS, customer: CUSTOMER, total: 6, useBalance: true }),
    ).rejects.toThrow(/not enough/i);
    expect((await fetchAccount()).balance).toBe(4);
  });

  it("records the order as paid and ties the ledger entry to it", async () => {
    seedAccount({ balance: 20 });
    const order = await placeOrder({ items: ITEMS, customer: CUSTOMER, total: 9, useBalance: true });
    expect(order.paymentStatus).toBe("paid");

    const account = await fetchAccount();
    const spend = account.entries.find((e) => e.kind === "order");
    expect(spend.amount).toBe(-9);
    expect(spend.ref).toBe(order.code);
  });
});

describe("the account page", () => {
  it("shows a customer only their own orders", async () => {
    /* Two accounts in one browser is exactly the local-mode situation that used
       to leak: fetchAccount returned every order in localStorage regardless of
       who was signed in. */
    seedAccount({ id: "cus-1", email: "rami@example.com" });
    await placeOrder({ items: ITEMS, customer: CUSTOMER, total: 9 });

    seedAccount({ id: "cus-2", email: "lina@example.com" });
    expect((await fetchAccount()).orders).toHaveLength(0);

    await placeOrder({ items: ITEMS, customer: { ...CUSTOMER, email: "lina@example.com" }, total: 4.5 });
    const lina = await fetchAccount();
    expect(lina.orders).toHaveLength(1);
    expect(lina.orders[0].total).toBe(4.5);
  });

  it("never returns the receipt image with a top-up", async () => {
    seedAccount();
    localStorage.setItem("asmar:topups", JSON.stringify([
      { id: "t1", ref: "TOP-1", customerId: "cus-1", amount: 10, method: "whish",
        receipt: "data:image/jpeg;base64,SECRET", status: "pending", created_at: new Date().toISOString() },
    ]));
    const account = await fetchAccount();
    expect(account.topups[0]).not.toHaveProperty("receipt");
  });
});

describe("order tracking", () => {
  it("reports the real payment state rather than always saying unpaid", async () => {
    seedAccount({ balance: 20 });
    const order = await placeOrder({ items: ITEMS, customer: CUSTOMER, total: 9, useBalance: true });
    const status = await fetchOrderStatus(order.code);
    expect(status.paymentStatus).toBe("paid");
    expect(status.total).toBe(9);
  });

  it("returns null for a code nobody recognises", async () => {
    expect(await fetchOrderStatus("ASM-XXXX-YYY")).toBeNull();
  });
});

describe("sign-in", () => {
  it("rejects a wrong password", async () => {
    seedAccount();
    await expect(auth.signIn("rami@example.com", "wrong")).rejects.toThrow(/wrong email or password/i);
  });

  it("rejects a deactivated account", async () => {
    localStorage.setItem("asmar:accounts", JSON.stringify([
      { id: "cus-1", email: "rami@example.com", password: "pw", active: false },
    ]));
    await expect(auth.signIn("rami@example.com", "pw")).rejects.toThrow(/not active/i);
  });

  it("is case-insensitive about the email, because phones capitalise it", async () => {
    seedAccount();
    const session = await auth.signIn("  Rami@Example.com  ", "pw");
    expect(session.user.email).toBe("rami@example.com");
  });
});

/* The one RPC in the shop declared `returns table (...)`.
 *
 * PostgREST picks an RPC's response shape from the signature rather than the
 * row count, so that one answers with an array where every other RPC here
 * answers with an object. Reading the fields straight off it gave undefined
 * for payment_status — and undefined is not "paid", so the status page
 * reported every successful payment as a failure, including real Whish
 * payments that had gone through.
 *
 * These tests are the shapes PostgREST actually returns. The local twin above
 * cannot catch this: it never goes near the RPC. */
describe("reading a set-returning RPC", () => {
  it("takes the row out of the array PostgREST wraps it in", () => {
    const row = oneRow([{ code: "ASM-1", status: "New", payment_status: "paid", total: "9.00" }]);
    expect(row.payment_status).toBe("paid");
    expect(row.code).toBe("ASM-1");
  });

  it("treats the empty array as no such order, not as an order", () => {
    /* [] is truthy, so this was previously an order object whose every field
       was undefined rather than a miss. */
    expect(oneRow([])).toBeNull();
  });

  it("still accepts a bare object, in case the signature is ever changed", () => {
    expect(oneRow({ code: "ASM-2", payment_status: "unpaid" }).code).toBe("ASM-2");
  });

  it("reads null and undefined as no such order", () => {
    expect(oneRow(null)).toBeNull();
    expect(oneRow(undefined)).toBeNull();
  });
});
