/* Account requests.
 *
 * A stranger can call this — it is the one write path open to someone with no
 * account — so the validation and the duplicate handling are the whole point.
 * The password rules matter most: it is held in plain text until the account is
 * created, so anything that leaves one lying around is a real problem.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import {
  requestAccount, fetchAccountRequests, decideAccountRequest,
  countPendingRequests, auth,
} from "../src/backend.js";

const GOOD = {
  name: "Rami Asmar",
  email: "rami@example.com",
  phone: "+961 70 123 456",
  password: "hunter22",
};

beforeEach(() => localStorage.clear());

describe("making a request", () => {
  it("stores it as pending", async () => {
    const res = await requestAccount(GOOD);
    expect(res.ok).toBe(true);

    const rows = await fetchAccountRequests("pending");
    expect(rows).toHaveLength(1);
    expect(rows[0].name).toBe("Rami Asmar");
    expect(rows[0].phone).toBe("+961 70 123 456");
    expect(rows[0].status).toBe("pending");
  });

  it("lower-cases the email, because phones capitalise it", async () => {
    await requestAccount({ ...GOOD, email: "  Rami@Example.COM  " });
    expect((await fetchAccountRequests("pending"))[0].email).toBe("rami@example.com");
  });

  it("refuses a second request from the same email", async () => {
    await requestAccount(GOOD);
    await expect(requestAccount(GOOD)).rejects.toThrow(/already have your request/i);
    expect(await countPendingRequests()).toBe(1);
  });

  it("refuses if that email is already a customer", async () => {
    localStorage.setItem("asmar:accounts", JSON.stringify([
      { id: "cus-1", email: "rami@example.com", password: "pw", active: true },
    ]));
    await expect(requestAccount(GOOD)).rejects.toThrow(/already an account/i);
  });

  it("counts what is waiting", async () => {
    expect(await countPendingRequests()).toBe(0);
    await requestAccount(GOOD);
    await requestAccount({ ...GOOD, email: "lina@example.com" });
    expect(await countPendingRequests()).toBe(2);
  });
});

describe("approving", () => {
  it("creates a real login the customer can sign in with", async () => {
    await requestAccount(GOOD);
    const [row] = await fetchAccountRequests("pending");

    await decideAccountRequest(row, true);

    const session = await auth.signIn("rami@example.com", "hunter22");
    expect(session.user.email).toBe("rami@example.com");
    expect(session.user.name).toBe("Rami Asmar");
  });

  it("wipes the stored password once the account exists", async () => {
    await requestAccount(GOOD);
    const [row] = await fetchAccountRequests("pending");
    await decideAccountRequest(row, true);

    /* The whole reason the password is accepted at all is to create the
       account. Leaving it in the table afterwards would be a plain-text
       password sitting in a database for no remaining purpose. */
    const decided = await fetchAccountRequests("decided");
    expect(decided[0].status).toBe("approved");
    expect(decided[0].password).toBe("");
  });

  it("moves it out of the waiting list", async () => {
    await requestAccount(GOOD);
    const [row] = await fetchAccountRequests("pending");
    await decideAccountRequest(row, true);

    expect(await fetchAccountRequests("pending")).toHaveLength(0);
    expect(await countPendingRequests()).toBe(0);
  });
});

describe("rejecting", () => {
  it("keeps the note, creates no account, and wipes the password", async () => {
    await requestAccount(GOOD);
    const [row] = await fetchAccountRequests("pending");
    await decideAccountRequest(row, false, "Could not reach them.");

    const decided = await fetchAccountRequests("decided");
    expect(decided[0].status).toBe("rejected");
    expect(decided[0].admin_note).toBe("Could not reach them.");
    expect(decided[0].password).toBe("");

    /* A rejected request must not leave a usable login behind. */
    await expect(auth.signIn("rami@example.com", "hunter22")).rejects.toThrow();
  });

  it("frees the email so they can try again", async () => {
    await requestAccount(GOOD);
    const [row] = await fetchAccountRequests("pending");
    await decideAccountRequest(row, false, "typo in the email");

    await expect(requestAccount(GOOD)).resolves.toMatchObject({ ok: true });
  });
});

describe("the password", () => {
  it("is never handed back by the request call", async () => {
    const res = await requestAccount(GOOD);
    expect(JSON.stringify(res)).not.toContain("hunter22");
  });

  it("is not exposed once the request is decided", async () => {
    await requestAccount(GOOD);
    const [row] = await fetchAccountRequests("pending");
    await decideAccountRequest(row, true);
    expect(JSON.stringify(await fetchAccountRequests("decided"))).not.toContain("hunter22");
  });
});
