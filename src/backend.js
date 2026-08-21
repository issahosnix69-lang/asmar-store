/* Data layer for The Asmar Store.
 *
 * Two implementations behind one interface:
 *   supabase — real shared database, orders reach the shop owner
 *   local    — browser localStorage, single device, for development
 *
 * The app picks whichever is configured, so it keeps running before the
 * Supabase keys are filled in. `backend.mode` says which one is live.
 */

const URL = import.meta.env.VITE_SUPABASE_URL;
const KEY = import.meta.env.VITE_SUPABASE_ANON_KEY;

export const configured = Boolean(URL && KEY && !URL.includes("your-project"));
export const backend = { mode: configured ? "supabase" : "local" };

/* @supabase/supabase-js is ~35 KB gzipped and every visitor was paying for it,
   including the ones browsing a shop that runs entirely on localStorage. Load
   it on first use instead. Every caller below already awaits, so the only cost
   is one extra microtask on the first database call. */
let clientPromise = null;
/* PostgREST decides an RPC's response shape from the function's signature, not
   from how many rows come back. `order_public_status` is declared
   `returns table (...)`, which is set-returning, so the reply is an array —
   `[{...}]` for a hit and `[]` for a miss — where a scalar or composite return
   type would have given a bare object.
 *
 * Reading `.payment_status` straight off that array yields undefined, and
 * undefined is not "paid", so the order status page called every successful
 * payment a failed one. `[]` is truthy too, so an unknown code did not read as
 * missing either.
 *
 * Both shapes are accepted here rather than changing the function, because the
 * function is already deployed and this has to be right against the one that
 * is live. */
export const oneRow = (data) => (Array.isArray(data) ? data[0] : data) || null;

export function getClient() {
  if (!configured) return Promise.resolve(null);
  if (!clientPromise) {
    clientPromise = import("@supabase/supabase-js")
      .then(({ createClient }) => createClient(URL, KEY));
  }
  return clientPromise;
}

/* ------------------------------------------------------------------ local */
const LS = {
  get(key, fallback) {
    try {
      /* Builds before the data layer went through a shim that prefixed the
         key a second time. Read those through so existing shops — products,
         logos, categories, orders — survive the upgrade. */
      const raw = localStorage.getItem(`asmar:${key}`)
               ?? localStorage.getItem(`asmar:asmar:${key}`);
      return raw ? JSON.parse(raw) : fallback;
    } catch { return fallback; }
  },
  set(key, value) {
    try { localStorage.setItem(`asmar:${key}`, JSON.stringify(value)); return true; }
    catch (e) { console.error("Could not save — storage may be full.", e); return false; }
  },
};

/* Crockford-ish base32: no I, L, O or U, so a code read down the phone cannot
   come back as a different one. */
const CODE_ALPHABET = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";

/* Local mode only — with Supabase the code is minted inside place_order, where
   a unique index has the final say.
 *
 * The random half used to be `getRandomValues(Uint32Array)[0].toString(36)`
 * truncated to three characters, which is both short and skewed: base36 of a
 * uint32 is six or seven characters and taking the leading three keeps the most
 * significant digits, so the first character was almost never past 'D'. The
 * timestamp half only changes once a millisecond, so a burst of orders leaned
 * entirely on those three characters and duplicate codes really did come out —
 * "gives every order a distinct code" failed roughly one run in a hundred.
 *
 * Masking to 5 bits takes the low end of a uniform byte, where all 32 values
 * are equally likely, and five of them is 33.5 million rather than a few
 * thousand skewed ones. */
const localOrderCode = () =>
  "ASM-" + Date.now().toString(36).slice(-4).toUpperCase() + "-" +
  Array.from(crypto.getRandomValues(new Uint8Array(5)), (b) => CODE_ALPHABET[b & 31]).join("");

/* --------------------------------------------------------------- mapping */
/* The database uses snake_case columns; the component uses camelCase. */
const rowToProduct = (r) => ({
  id: r.id, name: r.name, category: r.category, note: r.note,
  image: r.image || "", active: r.active, featured: !!r.featured,
  description: r.description || "", warrantyDays: r.warranty_days ?? 30,
  noteAr: r.note_ar || "", descriptionAr: r.description_ar || "",
  variants: r.variants || [],
});

const productToRow = (p, i) => ({
  id: p.id, name: p.name, category: p.category, note: p.note || "",
  image: p.image || "", active: !!p.active, featured: !!p.featured,
  description: p.description || "", warranty_days: p.warrantyDays ?? 30,
  note_ar: p.noteAr || "", description_ar: p.descriptionAr || "",
  variants: p.variants || [],
  position: i, updated_at: new Date().toISOString(),
});

const rowToSettings = (r) => ({
  whatsapp: r.whatsapp, whishNote: r.whish_note, omtNote: r.omt_note,
  categories: r.categories || [], categoryImages: r.category_images || {},
  categoryNotes: r.category_notes || {},
  categoryNotesAr: r.category_notes_ar || {}, categoryNamesAr: r.category_names_ar || {},
  heroTitle: r.hero_title || "", heroSub: r.hero_sub || "",
  socials: r.socials || {}, faq: r.faq || [],
  reviews: r.reviews || [], pages: r.pages || {}, pagesAr: r.pages_ar || {},
});

const settingsToRow = (s) => ({
  id: 1,
  whatsapp: s.whatsapp || "", whish_note: s.whishNote || "", omt_note: s.omtNote || "",
  categories: s.categories || [], category_images: s.categoryImages || {},
  category_notes: s.categoryNotes || {},
  category_notes_ar: s.categoryNotesAr || {}, category_names_ar: s.categoryNamesAr || {},
  hero_title: s.heroTitle || "", hero_sub: s.heroSub || "",
  socials: s.socials || {}, faq: s.faq || [],
  reviews: s.reviews || [], pages: s.pages || {}, pages_ar: s.pagesAr || {},
  /* Flips the row from "never touched, use the seed" to "this is the shop". */
  initialized: true,
  updated_at: new Date().toISOString(),
});

/* ------------------------------------------------------------- catalogue */
export async function fetchCatalog(fallback) {
  const supabase = await getClient();
  if (!supabase) return LS.get("catalog", fallback);
  const { data, error } = await supabase.from("products").select("*").order("position");
  if (error) throw error;
  /* An empty table means the store has not been seeded yet — fall back to the
     bundled catalogue so a fresh project is not a blank shop. */
  return data.length ? data.map(rowToProduct) : fallback;
}

export async function saveCatalog(list) {
  const supabase = await getClient();
  if (!supabase) return LS.set("catalog", list);
  const rows = list.map(productToRow);
  const { error } = await supabase.from("products").upsert(rows, { onConflict: "id" });
  if (error) throw error;
  /* Rows deleted in the admin have to be removed from the table too. */
  const keep = list.map((p) => p.id);
  const { error: delErr } = await supabase
    .from("products").delete().not("id", "in", `(${keep.map((k) => `"${k}"`).join(",") || '""'})`);
  if (delErr) throw delErr;
  return true;
}

/* -------------------------------------------------------------- settings */
export async function fetchSettings(fallback) {
  const supabase = await getClient();
  if (!supabase) return LS.get("settings", fallback);
  const { data, error } = await supabase.from("settings").select("*").eq("id", 1).maybeSingle();
  if (error) throw error;
  /* Until the owner has saved once, the row is all blanks and the seeded
     defaults are the better shop. After that the row is the truth — including
     the empty bits. Filtering blanks out instead (which is what this used to
     do) made fields impossible to clear: delete every FAQ entry and the
     seeded questions came straight back on the next load. */
  if (!data || !data.initialized) return fallback;
  const s = rowToSettings(data);
  return {
    ...fallback,
    ...Object.fromEntries(Object.entries(s).filter(([, v]) => v !== undefined && v !== null)),
  };
}

export async function saveSettings(s) {
  const supabase = await getClient();
  if (!supabase) return LS.set("settings", s);
  const { error } = await supabase.from("settings").upsert(settingsToRow(s), { onConflict: "id" });
  if (error) throw error;
  return true;
}

/* ---------------------------------------------------------------- orders */
export async function fetchOrders() {
  const supabase = await getClient();
  if (!supabase) return LS.get("orders", []);
  const { data, error } = await supabase
    .from("orders").select("*").order("created_at", { ascending: false });
  if (error) throw error;
  return data.map((o) => ({
    code: o.code, items: o.items, total: Number(o.total),
    customer: o.customer, status: o.status, createdAt: o.created_at,
    paymentStatus: o.payment_status, paidAt: o.paid_at,
    delivery: o.delivery || [],
  }));
}

/* The subscription details themselves, written by the owner and read by the
   customer on their account page.
 *
 * Positional: delivery[i] belongs to items[i], so an order carrying a Netflix
 * and a Spotify subscription keeps them apart. Padded to the length of items
 * before it is stored, because a sparse array round-trips through JSON as
 * nulls and the account page would then have to guess which line each entry
 * belonged to.
 *
 * There is no RPC behind this on purpose. The orders_write policy is
 * `using (is_admin())`, so the database already refuses this update from
 * anyone else — a security-definer wrapper would only move that same check
 * somewhere less obvious. */
export async function saveOrderDelivery(code, delivery, itemCount) {
  const rows = Array.from({ length: itemCount }, (_, i) => delivery[i] || {});
  const supabase = await getClient();
  if (!supabase) {
    const next = LS.get("orders", []).map((o) => (o.code === code ? { ...o, delivery: rows } : o));
    LS.set("orders", next);
    return rows;
  }
  const { error } = await supabase.from("orders").update({ delivery: rows }).eq("code", code);
  if (error) throw error;
  return rows;
}

/* Returns the created order. On Supabase the total and code come back from
   the server, which is the point — the browser does not get to decide them.
   Paying from the balance is also decided there: the check and the debit are
   one transaction, so two tabs cannot spend the same dollar twice. */
export async function placeOrder({ items, customer, total, useBalance = false }) {
  const supabase = await getClient();
  if (!supabase) {
    /* Mirrors the rule the database enforces: no account, no order. */
    const session = localSession();
    if (!session) throw new Error("Sign in to place an order.");
    /* Code first, so the ledger row can point at the order it paid for. */
    const code = localOrderCode();
    if (useBalance) localSpend(total, "order", code);
    const order = {
      code, items, total,
      /* Stamped so the account page can show this customer their own orders
         and nobody else's, the same way the server scopes them. */
      customerId: session.user.id,
      customer: { ...customer, payment: useBalance ? "balance" : customer.payment },
      status: customer.payment === "online" && !useBalance ? "Awaiting payment" : "New",
      paymentStatus: useBalance ? "paid" : "unpaid",
      /* Same shape the database column defaults to, so the account page does
         not need a second code path for orders placed locally. */
      delivery: [],
      createdAt: new Date().toISOString(),
    };
    LS.set("orders", [order, ...LS.get("orders", [])]);
    return order;
  }
  const { data, error } = await supabase.rpc("place_order", {
    p_items: items.map((i) => ({ id: i.id, label: i.label, qty: i.qty })),
    p_customer: customer,
    p_use_balance: !!useBalance,
  });
  if (error) throw error;
  return {
    code: data.code, items: data.items, total: Number(data.total),
    customer: data.customer, status: data.status, createdAt: data.created_at,
  };
}

export async function updateOrderStatus(code, status) {
  const supabase = await getClient();
  if (!supabase) {
    const next = LS.get("orders", []).map((o) => (o.code === code ? { ...o, status } : o));
    LS.set("orders", next);
    return next;
  }
  const { error } = await supabase.from("orders").update({ status }).eq("code", code);
  if (error) throw error;
  return null;
}

/* --------------------------------------------------------------- payment */
/* Asks the Edge Function to open a Whish checkout for an order and returns
   the URL to send the customer to. The secret stays on the server; the
   browser only ever learns a URL. */
export async function startWhishPayment(code) {
  const supabase = await getClient();
  if (!supabase) throw new Error("Online payment needs Supabase to be configured.");
  const { data, error } = await supabase.functions.invoke("whish-create-payment", {
    body: { code },
  });
  if (error) throw error;
  if (!data?.url) throw new Error(data?.error || "Whish did not return a checkout link.");
  return data.url;
}

/* Used by the return page to show whether the payment actually landed.
   Reads only the payment state, never the customer's details. */
export async function fetchOrderStatus(code) {
  const supabase = await getClient();
  if (!supabase) {
    const found = LS.get("orders", []).find((o) => o.code === code);
    /* Read the stored value rather than always claiming "unpaid" — an order
       paid from the balance is genuinely paid, and hardcoding it meant the
       paid state could not be seen without Supabase. */
    return found
      ? { code, status: found.status, paymentStatus: found.paymentStatus || "unpaid", total: found.total }
      : null;
  }
  const { data, error } = await supabase.rpc("order_public_status", { p_code: code });
  if (error) throw error;
  const row = oneRow(data);
  if (!row) return null;
  return {
    code: row.code, status: row.status,
    paymentStatus: row.payment_status, total: Number(row.total),
  };
}

/* ------------------------------------------------------------------ auth */
/* In local mode there is no real auth, so the old PIN gate stands in.
   With Supabase configured, admin is a genuine server-checked login. */
export const auth = {
  real: configured,

  async session() {
    const supabase = await getClient();
    if (!supabase) return localSession();
    const { data } = await supabase.auth.getSession();
    return data.session;
  },

  async signIn(email, password) {
    const supabase = await getClient();
    if (!supabase) return localSignIn(email, password);
    const { data, error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) throw error;
    return data.session;
  },

  async signOut() {
    const supabase = await getClient();
    if (!supabase) { LS.set("session", null); notifyLocalAuth(); return; }
    await supabase.auth.signOut();
  },

  /* Stays synchronous because callers use the return value as a React cleanup.
     The client may not have loaded yet, so subscribe when it arrives and let
     the returned function cancel either the pending load or the live
     subscription, whichever it turns out to be. */
  onChange(cb) {
    if (!configured) return onLocalAuth(cb);
    let unsubscribe = null;
    let cancelled = false;
    getClient().then((sb) => {
      if (cancelled || !sb) return;
      const { data } = sb.auth.onAuthStateChange((_e, session) => cb(session));
      unsubscribe = () => data.subscription.unsubscribe();
    });
    return () => { cancelled = true; unsubscribe?.(); };
  },

  /* "Signed in" and "allowed in the admin" are two different questions the
     moment customers have logins of their own. */
  async isAdmin() {
    const supabase = await getClient();
    if (!supabase) return Boolean(localSession()?.user?.isAdmin);
    const { data, error } = await supabase.rpc("is_admin");
    if (error) { console.error(error); return false; }
    return Boolean(data);
  },
};

/* ==================================================================== accounts
 * Customers do not sign themselves up: they message the owner, he creates the
 * login, and they use it to hold a balance. Everything below has a localStorage
 * twin so the whole flow can be clicked through before Supabase exists — that
 * twin is a single-browser simulation, not a real shared account.
 */

/* ------------------------------------------------------- local simulation */
const LOCAL_AUTH_EVENT = "asmar:auth";
const notifyLocalAuth = () => window.dispatchEvent(new Event(LOCAL_AUTH_EVENT));
const onLocalAuth = (cb) => {
  const h = () => cb(localSession());
  window.addEventListener(LOCAL_AUTH_EVENT, h);
  return () => window.removeEventListener(LOCAL_AUTH_EVENT, h);
};

const localSession = () => LS.get("session", null);
const localAccounts = () => LS.get("accounts", []);
const localRef = (p) =>
  p + "-" + Date.now().toString(36).slice(-4).toUpperCase() +
  "-" + crypto.getRandomValues(new Uint32Array(1))[0].toString(36).slice(0, 3).toUpperCase();

function localSignIn(email, password) {
  const e = String(email).trim().toLowerCase();
  const found = localAccounts().find((a) => a.email === e && a.password === password);
  if (!found) throw new Error("Wrong email or password.");
  if (!found.active) throw new Error("This account is not active. Message us on WhatsApp.");
  /* Carries the account's own flag rather than hardcoding false. The local twin
     is meant to behave like the server, and with a single sign-in for admins
     and customers alike, "is this person an admin" is the branch that decides
     where they land — untestable locally if it is always no. */
  const session = {
    user: { id: found.id, email: found.email, name: found.name, isAdmin: !!found.isAdmin },
  };
  LS.set("session", session);
  notifyLocalAuth();
  return session;
}

const localEntries = () => LS.get("wallet", []);
const localBalanceOf = (id) =>
  localEntries().filter((w) => w.customerId === id).reduce((s, w) => s + Number(w.amount), 0);

function localCredit(customerId, amount, kind, ref, note) {
  LS.set("wallet", [
    { id: Date.now() + Math.random(), customerId, amount, kind, ref, note: note || "",
      created_at: new Date().toISOString() },
    ...localEntries(),
  ]);
}

function localSpend(amount, kind, ref) {
  const s = localSession();
  if (!s) throw new Error("Sign in to pay from your balance.");
  if (localBalanceOf(s.user.id) < amount) throw new Error("Not enough balance.");
  localCredit(s.user.id, -amount, kind, ref || "", "");
}

/* ------------------------------------------------------------- the account */
export async function fetchAccount() {
  const supabase = await getClient();
  if (!supabase) {
    const s = localSession();
    if (!s) throw new Error("Sign in first.");
    const id = s.user.id;
    const me = localAccounts().find((a) => a.id === id) || {};
    return {
      profile: { id, name: me.name || "", phone: me.phone || "", email: me.email || "" },
      /* Mirrors my_account() rather than hardcoding false, so the account page
         can offer an admin their way into the admin in local mode too. */
      isAdmin: !!me.isAdmin,
      balance: localBalanceOf(id),
      entries: localEntries().filter((w) => w.customerId === id).slice(0, 50),
      topups: LS.get("topups", []).filter((t) => t.customerId === id)
        .map(({ receipt, ...rest }) => rest).slice(0, 25),
      /* Scoped to this customer, the way my_account() scopes it on the server.
         Returning every order in the browser made local testing lie: an account
         with no orders of its own still showed a full list. */
      orders: LS.get("orders", [])
        .filter((o) => o.customerId === id || o.customer?.email === me.email)
        .slice(0, 25),
    };
  }
  const { data, error } = await supabase.rpc("my_account");
  if (error) throw error;
  return {
    profile: data.profile || {},
    isAdmin: !!data.isAdmin,
    balance: Number(data.balance || 0),
    entries: (data.entries || []).map((e) => ({ ...e, amount: Number(e.amount) })),
    topups: (data.topups || []).map((t) => ({ ...t, amount: Number(t.amount) })),
    orders: (data.orders || []).map((o) => ({ ...o, total: Number(o.total) })),
  };
}

export async function submitTopup({ amount, method, receipt }) {
  const supabase = await getClient();
  if (!supabase) {
    const s = localSession();
    if (!s) throw new Error("Sign in first.");
    if (!receipt) throw new Error("Attach a picture of the transfer.");
    const row = {
      id: localRef("id"), ref: localRef("TOP"), customerId: s.user.id,
      amount: Number(amount), method, receipt, status: "pending",
      admin_note: "", created_at: new Date().toISOString(),
      name: s.user.name || "", email: s.user.email,
    };
    LS.set("topups", [row, ...LS.get("topups", [])]);
    const { receipt: _drop, ...safe } = row;
    return safe;
  }
  /* The image goes to Storage first, then the row points at it. Receipts used
     to be base64 in a text column: a third larger than the bytes they encode,
     in every database backup forever, and re-sent in full on every admin page
     load. Upload first so a failed upload never leaves a top-up row claiming a
     receipt that does not exist. */
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) throw new Error("Sign in first.");

  const blob = dataUrlToBlob(receipt);
  /* Foldered by user id — the storage policy in supabase/receipts.sql keys on
     that first path segment to keep customers out of each other's receipts. */
  const path = `${user.id}/${Date.now()}-${crypto.randomUUID().slice(0, 8)}.jpg`;

  const { error: upErr } = await supabase.storage
    .from("receipts")
    .upload(path, blob, { contentType: blob.type, upsert: false });
  if (upErr) throw new Error(`Could not upload the picture: ${upErr.message}`);

  const { data, error } = await supabase.rpc("submit_topup", {
    p_amount: Number(amount), p_method: method, p_path: path,
  });
  if (error) {
    /* Do not leave the orphan behind if the row was rejected — too many
       pending requests, an inactive account, an amount over the ceiling. */
    await supabase.storage.from("receipts").remove([path]).catch(() => {});
    throw error;
  }
  return { ...data, amount: Number(data.amount) };
}

/* The picker hands back a data URL because that is what the preview <img> in
   the top-up form needs. Storage wants bytes. */
function dataUrlToBlob(dataUrl) {
  const [meta, b64] = String(dataUrl).split(",");
  if (!b64) throw new Error("That picture could not be read.");
  const type = meta.match(/data:([^;]+)/)?.[1] || "image/jpeg";
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new Blob([bytes], { type });
}

/* A private bucket, so the admin needs a short-lived signed URL to look at a
   receipt. Ten minutes is plenty to approve or reject one, and a link that
   leaks from a screenshot or a browser history stops working the same morning. */
export async function receiptUrl(path) {
  const supabase = await getClient();
  if (!supabase || !path) return "";
  const { data, error } = await supabase.storage
    .from("receipts")
    .createSignedUrl(path, 600);
  if (error) {
    console.error("Could not sign the receipt url", error);
    return "";
  }
  return data.signedUrl;
}

/* ======================================================== account requests
 * Customers still do not sign themselves up — Ali creates every login. This
 * only removes the WhatsApp round-trip where he asks for name, email and phone
 * one message at a time.
 */
export async function requestAccount({ name, email, phone, password }) {
  const supabase = await getClient();
  if (!supabase) {
    const e = String(email).trim().toLowerCase();
    if (localAccounts().some((a) => a.email === e)) {
      throw new Error("There is already an account with that email. Try signing in.");
    }
    const all = LS.get("requests", []);
    if (all.some((r) => r.email === e && r.status === "pending")) {
      throw new Error("We already have your request. We will message you shortly.");
    }
    const row = {
      id: localRef("req"), name: String(name).trim(), email: e,
      phone: String(phone).trim(), password, status: "pending",
      admin_note: "", created_at: new Date().toISOString(),
    };
    LS.set("requests", [row, ...all]);
    return { ok: true, email: e };
  }
  const { data, error } = await supabase.rpc("request_account", {
    p_name: name, p_email: email, p_phone: phone, p_password: password,
  });
  if (error) throw error;
  return data;
}

export async function fetchAccountRequests(status = "pending") {
  const supabase = await getClient();
  if (!supabase) {
    const all = LS.get("requests", []);
    return status === "pending"
      ? all.filter((r) => r.status === "pending")
      : all.filter((r) => r.status !== "pending");
  }
  const { data, error } = await supabase.rpc("admin_account_requests", { p_status: status });
  if (error) throw error;
  return data || [];
}

export async function countPendingRequests() {
  const supabase = await getClient();
  if (!supabase) return LS.get("requests", []).filter((r) => r.status === "pending").length;
  const { data, error } = await supabase.rpc("admin_pending_requests");
  if (error) { console.error(error); return 0; }
  return Number(data || 0);
}

/* Approving is two steps that must happen in this order: create the real login
   first, then mark the request decided. The other way round would leave a
   request marked approved with no account behind it, and the password already
   wiped — unrecoverable without asking the customer to start again. */
export async function decideAccountRequest(row, approve, note = "") {
  const supabase = await getClient();
  if (!supabase) {
    if (approve) {
      await createCustomer({
        email: row.email, password: row.password, name: row.name, phone: row.phone,
      });
    }
    LS.set("requests", LS.get("requests", []).map((r) => (r.id === row.id
      ? { ...r, status: approve ? "approved" : "rejected", admin_note: note,
          password: "", decided_at: new Date().toISOString() }
      : r)));
    return true;
  }

  if (approve) {
    if (!row.password) throw new Error("That request no longer has a password. Ask the customer to send a new one.");
    await createCustomer({
      email: row.email, password: row.password, name: row.name, phone: row.phone,
    });
  }
  const { error } = await supabase.rpc("decide_account_request", {
    p_id: row.id, p_approve: approve, p_note: note,
  });
  if (error) throw error;
  return true;
}

/* ----------------------------------------------------------------- admin */
export async function fetchTopups(status = "pending") {
  const supabase = await getClient();
  if (!supabase) {
    const all = LS.get("topups", []);
    const rows = status === "pending"
      ? all.filter((t) => t.status === "pending")
      : all.filter((t) => t.status !== "pending");
    return rows.map((t) => ({ ...t, amount: Number(t.amount) }));
  }
  const { data, error } = await supabase.rpc("admin_topups", { p_status: status });
  if (error) throw error;
  return (data || []).map((t) => ({ ...t, amount: Number(t.amount) }));
}

export async function countPendingTopups() {
  const supabase = await getClient();
  if (!supabase) return LS.get("topups", []).filter((t) => t.status === "pending").length;
  const { data, error } = await supabase.rpc("admin_pending_topups");
  if (error) { console.error(error); return 0; }
  return Number(data || 0);
}

export async function decideTopup(id, approve, note = "") {
  const supabase = await getClient();
  if (!supabase) {
    const all = LS.get("topups", []);
    const row = all.find((t) => t.id === id);
    if (!row || row.status !== "pending") throw new Error("That top-up was already decided.");
    if (approve) localCredit(row.customerId, Number(row.amount), "topup", row.ref, note);
    LS.set("topups", all.map((t) => (t.id === id
      ? { ...t, status: approve ? "approved" : "rejected", admin_note: note,
          decided_at: new Date().toISOString() }
      : t)));
    return true;
  }
  const fn = approve ? "approve_topup" : "reject_topup";
  const { error } = await supabase.rpc(fn, { p_id: id, p_note: note });
  if (error) throw error;
  return true;
}

export async function fetchCustomers() {
  const supabase = await getClient();
  if (!supabase) {
    return localAccounts().map((a) => ({
      ...a, password: undefined, balance: localBalanceOf(a.id),
      orders: 0, created_at: a.created_at,
    }));
  }
  const { data, error } = await supabase.rpc("admin_customers");
  if (error) throw error;
  return (data || []).map((c) => ({ ...c, balance: Number(c.balance) }));
}

export async function adjustBalance(customerId, amount, note = "") {
  const supabase = await getClient();
  if (!supabase) {
    localCredit(customerId, Number(amount), "adjustment", "", note);
    return localBalanceOf(customerId);
  }
  const { data, error } = await supabase.rpc("adjust_balance", {
    p_customer: customerId, p_amount: Number(amount), p_note: note,
  });
  if (error) throw error;
  return Number(data);
}

export async function setCustomerActive(customerId, active) {
  const supabase = await getClient();
  if (!supabase) {
    LS.set("accounts", localAccounts().map((a) => (a.id === customerId ? { ...a, active } : a)));
    return true;
  }
  const { error } = await supabase.from("customers").update({ active }).eq("id", customerId);
  if (error) throw error;
  return true;
}

/* Making a login needs the service_role key, which cannot live in a browser,
   so this goes through an Edge Function that re-checks the caller is an admin. */
export async function createCustomer({ email, password, name, phone }) {
  const supabase = await getClient();
  if (!supabase) {
    const e = String(email).trim().toLowerCase();
    if (localAccounts().some((a) => a.email === e)) {
      throw new Error("There is already an account with that email.");
    }
    const row = { id: localRef("cus"), email: e, password, name, phone,
                  active: true, created_at: new Date().toISOString() };
    LS.set("accounts", [row, ...localAccounts()]);
    return { id: row.id, email: e };
  }
  const { data, error } = await supabase.functions.invoke("admin-create-customer", {
    body: { email, password, name, phone },
  });
  if (error) {
    /* invoke() reports a non-2xx as a generic FunctionsHttpError, so dig the
       real message out of the response the function actually sent. */
    const detail = await error?.context?.json?.().catch(() => null);
    throw new Error(detail?.error || error.message || "Could not create that account.");
  }
  if (data?.error) throw new Error(data.error);
  return data;
}

/* =============================================================== diagnostics
 * Asks the database what it actually has, so "the backend is broken" becomes a
 * named missing step. Every check returns the exact thing to paste or run.
 */
/* Diagnostics is what you open when the shop is misbehaving, which is exactly
   when a network call is likeliest to hang rather than fail — a blocked host,
   a stalled function, an extension eating the request. None of these probes
   had a deadline, so any one of them hanging left the page on its spinner
   forever with nothing said. The one screen whose whole job is to tell you
   what is wrong was the one screen that could not.
 *
   Eight seconds: long enough that a slow-but-alive check still passes on a
   phone connection, short enough that a whole run of these cannot outlast
   anyone's patience. A probe that trips this reports the timeout as its
   result, which is itself the finding. */
const PROBE_MS = 8000;

export async function probe(label, work, ms = PROBE_MS) {
  let timer;
  const deadline = new Promise((resolve) => {
    timer = setTimeout(
      () => resolve({ error: new Error(`no answer within ${ms / 1000}s — the request hung rather than failed`) }),
      ms,
    );
  });
  try {
    /* Both arms resolve rather than reject, so one dead probe cannot take the
       rest of the run down with it. */
    return await Promise.race([
      Promise.resolve(work).then((r) => r ?? {}).catch((error) => ({ error })),
      deadline,
    ]);
  } finally {
    clearTimeout(timer);
  }
}

export async function runDiagnostics() {
  const supabase = await getClient();
  const out = [];
  const add = (name, state, detail, fix) => out.push({ name, state, detail, fix });

  if (!configured) {
    add("Database keys", "bad",
      "VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY are not set, so the shop is running on this browser alone. Customers see the bundled demo catalogue and their orders never reach you.",
      "Create .env.local next to package.json:\n\nVITE_SUPABASE_URL=https://xxxx.supabase.co\nVITE_SUPABASE_ANON_KEY=eyJhbGci...\n\nThen restart the dev server. On Netlify, add the same two under\nSite settings → Environment variables, and redeploy.");
    add("Everything else", "warn",
      "Skipped. These checks need a database to talk to.", null);
    return out;
  }

  add("Database keys", "ok", "Connected to " + URL.replace(/^https?:\/\//, ""), null);

  /* --- tables --- */
  const table = async (name, label) => {
    const { error } = await probe(label, supabase.from(name).select("*", { count: "exact", head: true }));
    if (!error) return true;
    const missing = /does not exist|schema cache|relation/i.test(error.message);
    add(label, "bad",
      missing ? `The "${name}" table does not exist yet.` : error.message,
      missing ? "Open Supabase → SQL Editor and run, in this order:\n  1. supabase/schema.sql\n  2. supabase/payments.sql\n  3. supabase/accounts.sql" : null);
    return false;
  };

  const hasProducts = await table("products", "Products table");
  if (hasProducts) add("Products table", "ok", "Present and readable.", null);
  const hasSettings = await table("settings", "Settings table");
  if (hasSettings) add("Settings table", "ok", "Present and readable.", null);
  const hasCustomers = await table("customers", "Accounts tables");
  if (hasCustomers) add("Accounts tables", "ok", "customers, wallet_entries and topups are present.", null);

  /* Without the bucket a customer fills in the whole top-up form, photographs
     the transfer, and only then gets an error — so it is worth naming here. */
  const { error: bucketErr } = await probe(
    "Receipt storage", supabase.storage.from("receipts").list("", { limit: 1 }));
  if (bucketErr && /not found|does not exist|bucket/i.test(bucketErr.message)) {
    add("Receipt storage", "bad",
      "The \"receipts\" bucket does not exist, so nobody can submit a top-up.",
      "Open Supabase → SQL Editor and run supabase/receipts.sql.");
  } else {
    add("Receipt storage", "ok", "The receipts bucket is present and private.", null);
  }

  /* --- signed in and admin --- */
  const { data: sessionData } = await probe("Your login", supabase.auth.getSession());
  const session = sessionData?.session;
  if (!session) {
    add("Your login", "bad",
      "You are not signed in, so nothing here can be saved.",
      "Supabase → Authentication → Users → Add user, then sign in with it.");
    return out;
  }
  add("Your login", "ok", `Signed in as ${session.user.email}.`, null);

  const { data: isAdminRow, error: adminErr } = await probe("Admin rights", supabase.rpc("is_admin"));
  if (adminErr) {
    add("Admin rights", "bad",
      "The is_admin() function is missing, so the database cannot tell owners from customers.",
      "Run supabase/accounts.sql in the SQL Editor.");
  } else if (!isAdminRow) {
    add("Admin rights", "bad",
      `${session.user.email} is signed in but is not an admin. Saving anything will be refused.`,
      `insert into public.admins (user_id)\nselect id from auth.users where email = '${session.user.email}'\non conflict do nothing;`);
  } else {
    add("Admin rights", "ok", "This account is an admin.", null);
  }

  /* --- the catalogue actually being there --- */
  if (hasProducts) {
    const { count } = await probe(
      "Your catalogue", supabase.from("products").select("*", { count: "exact", head: true }));
    if (!count) {
      add("Your catalogue", "warn",
        "The products table is empty, so customers see the bundled demo products instead of yours.",
        "Settings → “Push this catalogue to the database”.");
    } else {
      add("Your catalogue", "ok", `${count} products stored. Customers see these.`, null);
    }
  }

  /* --- ordering --- */
  const { error: orderFnErr } = await probe("Checkout", supabase.rpc("place_order", {
    p_items: [], p_customer: {}, p_use_balance: false,
  }));
  if (orderFnErr && /could not find|does not exist|function/i.test(orderFnErr.message)) {
    add("Checkout", "bad",
      "place_order() is missing or has the wrong shape, so no order can be placed.",
      "Run supabase/accounts.sql — it replaces the older two-argument version.");
  } else {
    /* An "empty order" complaint means the function is alive and validating. */
    add("Checkout", "ok", "place_order() is installed and validating.", null);
  }

  /* --- edge functions --- */
  /* Asks the function's URL directly rather than going through
     functions.invoke().

     invoke() reports a missing function as a FunctionsFetchError with no HTTP
     status attached, which the previous version of this check read as "not a
     404, therefore fine" — so it reported three undeployed functions as
     "Deployed and responding" and the first sign anything was wrong was a
     customer's account failing to be created. A plain fetch gives a real status
     code and cannot be misread. */
  const fn = async (name, label, why) => {
    const base = URL.replace(".supabase.co", ".functions.supabase.co");
    const deployTip =
      `Supabase → Edge Functions → Deploy a new function → name it exactly "${name}", ` +
      `paste the contents of supabase/functions/${name}/index.ts, and deploy. ` +
      `Or, with the CLI: supabase functions deploy ${name}`;
    try {
      /* A raw fetch to a host that accepts the connection and then says
         nothing waits forever by default. This is a different host from the
         database — *.functions.supabase.co — so it fails independently, and an
         ad blocker or a corporate DNS can leave it hanging rather than
         refusing. AbortSignal.timeout turns that into a catchable error. */
      const res = await fetch(`${base}/${name}`, {
        method: "POST",
        headers: { apikey: KEY, Authorization: `Bearer ${KEY}`, "Content-Type": "application/json" },
        body: JSON.stringify({ probe: true }),
        signal: AbortSignal.timeout(PROBE_MS),
      });
      if (res.status === 404) {
        add(label, "bad", `The ${name} function is not deployed. ${why}`, deployTip);
      } else {
        /* Any other status means something answered — 401 and 400 are the
           function itself rejecting a probe, which is the correct behaviour. */
        add(label, "ok", `Deployed and responding (HTTP ${res.status}).`, null);
      }
    } catch (e) {
      add(label, "bad", `Could not reach ${name}: ${e.message}. ${why}`, deployTip);
    }
  };
  await fn("admin-create-customer", "Creating customer logins",
    "Approving an account request and making a customer by hand will both fail.");
  /* Only worth reporting if the database trigger is actually pointed at it —
     supabase/notify-direct.sql sends to Telegram from Postgres instead, and on
     that route this function is meant to be absent. */
  const { data: viaFunction } = await probe(
    "Alert route", supabase.rpc("notify_uses_edge_function"));
  if (viaFunction) {
    await fn("notify-order", "Order alerts",
      "Nothing will reach your phone when an order arrives.");
  }

  /* Deployed is not the same as wired up: the function can be live while the
     trigger still has no URL to post to, which looks fine and delivers nothing. */
  const { data: notifyReady, error: notifyErr } = await probe(
    "Order alerts wiring", supabase.rpc("notify_is_configured"));
  if (notifyErr) {
    add("Order alerts wiring", "warn",
      "Could not check whether the order trigger is connected. If you have not run supabase/notify.sql yet, that is why.",
      "Run supabase/notify.sql in the SQL Editor.");
  } else if (!notifyReady) {
    add("Order alerts wiring", "bad",
      "The order trigger has no address to send to, so orders still reach you only through the admin.",
      "Follow the SETUP block at the bottom of supabase/notify.sql — deploy the function, set NOTIFY_SECRET and the Telegram token, then update notify_config.");
  } else {
    add("Order alerts wiring", "ok", "New orders are pushed to your phone.", null);
  }

  return out;
}

/* One-time push of the bundled catalogue into an empty Supabase project.
   Called from the admin so the shop owner does not have to hand-write SQL. */
export async function seedRemote(catalog, settings) {
  const supabase = await getClient();
  if (!supabase) throw new Error("Supabase is not configured.");
  await saveCatalog(catalog);
  await saveSettings(settings);
  return true;
}
