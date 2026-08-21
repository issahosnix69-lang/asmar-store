/* Store admin.
 *
 * Deliberately English-only: the storefront is bilingual because customers are,
 * but there is exactly one person behind this screen and translating it would
 * double the maintenance for nobody's benefit.
 */
import React, { useEffect, useState } from "react";
import {
  AlertTriangle, ChevronDown, ChevronUp, CloudUpload, FileText, LogOut, Package,
  Pencil, Plus, Receipt, Search, Settings, Star, Tags, Trash2, X, MessageSquareQuote,
  Wallet, Users, Check, Copy, Loader2, LayoutDashboard, Stethoscope, ArrowRight,
} from "lucide-react";
import {
  T, display, script, ui, Btn, Field, EmptyState, LogoPicker, CoverPicker,
  ProductMark, Stars, money, lowestPrice, discountPct,
} from "./ui.jsx";
import {
  auth, fetchOrders, seedRemote,
  fetchTopups, countPendingTopups, decideTopup,
  fetchCustomers, adjustBalance, setCustomerActive, createCustomer,
  runDiagnostics, receiptUrl,
  fetchAccountRequests, decideAccountRequest, countPendingRequests,
} from "./backend.js";
import { SEED_CATEGORIES, SEED_FAQ, SEED_PAGES } from "./seed.js";
import { U } from "./paths.js";

const STATUSES = ["New", "Awaiting payment", "Delivered", "Cancelled"];

const LOCAL_UNLOCK_KEY = "asmar:admin-unlocked";

/* Customer-facing copy is stored twice — English in the plain field, Arabic in
   a matching *Ar field. This switch decides which one the content inputs edit.
   Anything left blank in Arabic falls back to the English on the storefront, so
   translating is optional and can be done a field at a time. */
function LangSwitch({ value, onChange }) {
  const opt = (k, label, hint) => (
    <button key={k} onClick={() => onChange(k)} className="press"
      style={{ padding: "6px 14px", borderRadius: 999, fontSize: 12, letterSpacing: ".06em",
               background: value === k ? T.brand : "transparent",
               color: value === k ? "#fff" : T.inkSoft,
               border: `1px solid ${value === k ? T.brand : T.line}` }}
      title={hint}>
      {label}
    </button>
  );
  return (
    <div className="flex items-center gap-2 mb-4 flex-wrap">
      <span style={{ ...labelStyle, fontSize: 10.5 }}>Editing</span>
      {opt("en", "English", "The version everyone sees by default")}
      {opt("ar", "العربية", "Shown to customers who switch the store to Arabic")}
      {value === "ar" && (
        <span style={{ fontSize: 11.5, color: T.inkSoft }}>
          Blank fields fall back to the English.
        </span>
      )}
    </div>
  );
}

/* Reads and writes either the base field or its Arabic twin. */
const langField = (lang, base) => (lang === "ar" ? `${base}Ar` : base);

const cardStyle = { background: T.surface, border: `1px solid ${T.line}`, borderRadius: 12 };
const inputStyle = {
  fontFamily: ui, fontSize: 14, color: T.ink, background: T.surface2,
  border: `1px solid ${T.line}`, borderRadius: 8,
};
const labelStyle = { fontSize: 11, letterSpacing: ".14em", textTransform: "uppercase", color: T.inkSoft };

/* ===================================================================== login */
function AdminLogin({ settings, onAuthed, exit }) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [pin, setPin] = useState("");
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    setErr("");
    if (!auth.real) {
      /* Local development only — this gate is cosmetic and everybody knows it. */
      return pin === settings.pin ? onAuthed() : setErr("Wrong PIN. Try again.");
    }
    setBusy(true);
    try {
      await auth.signIn(email.trim(), password);
      onAuthed();
    } catch (e) {
      setErr(e?.message || "Could not sign in.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="min-h-screen flex flex-col items-center justify-center px-6"
      style={{ background: T.bg, fontFamily: ui, color: T.ink }}>
      <div style={{ fontFamily: script, fontSize: 36, color: T.brandText, marginBottom: 4 }}>Asmar</div>
      <p style={{ ...labelStyle, letterSpacing: ".22em", marginBottom: 28 }}>Store admin</p>
      <div className="w-full flex flex-col gap-3" style={{ maxWidth: 330 }}>
        {auth.real ? (
          <>
            <Field label="Email" type="email" value={email} autoComplete="username"
              onChange={(e) => { setEmail(e.target.value); setErr(""); }} />
            <Field label="Password" type="password" value={password} autoComplete="current-password"
              onChange={(e) => { setPassword(e.target.value); setErr(""); }}
              onKeyDown={(e) => { if (e.key === "Enter") submit(); }} />
          </>
        ) : (
          <>
            <Field label="PIN" type="password" value={pin} inputMode="numeric"
              onChange={(e) => { setPin(e.target.value); setErr(""); }}
              onKeyDown={(e) => { if (e.key === "Enter") submit(); }} />
            <p className="flex items-start gap-1.5" style={{ fontSize: 11.5, color: T.inkSoft, lineHeight: 1.55 }}>
              <AlertTriangle size={13} className="shrink-0" style={{ marginTop: 2, color: T.rose }} />
              Local mode — this PIN is not real security. Add your Supabase keys to get a proper login.
            </p>
          </>
        )}
        {err && <p style={{ fontSize: 12.5, color: T.brandText }}>{err}</p>}
        <Btn full onClick={submit} style={{ marginTop: 4, opacity: busy ? 0.6 : 1 }}>
          {busy ? "Signing in…" : "Unlock"}
        </Btn>
        <Btn variant="ghost" full onClick={exit}>Back to store</Btn>
      </div>
    </div>
  );
}

/* ====================================================================== shell */
/* The person on this screen is one shop owner, usually on a phone, usually
   with a customer waiting on WhatsApp. So the nav is ordered by urgency rather
   than by data model: what is waiting for him, then the shop, then the words,
   then the plumbing he touches once. */
const NAV = [
  ["Work", [
    ["overview", "Overview", LayoutDashboard],
    ["orders", "Orders", Receipt],
    ["topups", "Top-ups", Wallet],
    ["customers", "Customers", Users],
  ]],
  ["Shop", [
    ["products", "Products", Package],
    ["categories", "Categories", Tags],
  ]],
  ["Words", [
    ["reviews", "Reviews", MessageSquareQuote],
    ["pages", "Pages", FileText],
  ]],
  ["Setup", [
    ["settings", "Settings", Settings],
    ["diagnostics", "Diagnostics", Stethoscope],
  ]],
];

const TAB_TITLE = Object.fromEntries(NAV.flatMap(([, items]) => items.map(([k, label]) => [k, label])));

/* Tells the owner whether what he just typed is safe yet. Nothing shows until
   something has actually been edited. */
function SaveState({ state }) {
  if (state === "idle") return null;
  const map = {
    saving: ["Saving…", T.inkSoft, null],
    saved: ["Saved", T.ok, Check],
    error: ["Not saved", T.brandText, AlertTriangle],
  };
  const [label, colour, Icon] = map[state] || map.saving;
  return (
    <span className="flex items-center gap-1.5" style={{ fontSize: 11.5, color: colour }}>
      {state === "saving"
        ? <Loader2 size={12} className="animate-spin" />
        : Icon ? <Icon size={12} /> : null}
      {label}
    </span>
  );
}

export default function Admin({
  catalog, setCatalog, orders, setOrders, setOrderStatus, setOrderDelivery,
  settings, setSettings, exit, saveError, saveState, onFlush,
}) {
  const categories = settings.categories?.length ? settings.categories : SEED_CATEGORIES;
  /* Local mode has no session to restore, so without this the owner re-types
     the PIN on every reload. sessionStorage, not localStorage: it lasts the
     browsing session and no longer, which is all a cosmetic gate deserves. */
  const [authed, setAuthed] = useState(() => {
    if (auth.real) return false;
    try { return sessionStorage.getItem(LOCAL_UNLOCK_KEY) === "1"; } catch { return false; }
  });
  const [checking, setChecking] = useState(auth.real);
  const [notAdmin, setNotAdmin] = useState(false);
  const [tab, setTab] = useState("overview");
  const [pending, setPending] = useState(0);
  const [pendingReqs, setPendingReqs] = useState(0);
  const openOrders = orders.filter((o) => o.status === "New" || o.status === "Awaiting payment").length;
  /* Which language of the customer-facing copy is being edited. Only content
     fields respond to it — the admin's own labels stay in English. */
  const [contentLang, setContentLang] = useState("en");

  /* With Supabase configured this is a real session. Being signed in is no
     longer enough — customers have logins too — so the session is checked
     against the admins table before anything here is shown. */
  useEffect(() => {
    if (!auth.real) return;
    let alive = true;
    const evaluate = async (s) => {
      if (!s) { if (alive) { setAuthed(false); setNotAdmin(false); setChecking(false); } return; }
      const ok = await auth.isAdmin();
      if (!alive) return;
      setAuthed(ok);
      setNotAdmin(!ok);
      setChecking(false);
    };
    auth.session().then(evaluate);
    const off = auth.onChange((s) => { setChecking(true); evaluate(s); });
    return () => { alive = false; off?.(); };
  }, []);

  useEffect(() => {
    if (!authed) return;
    fetchOrders().then(setOrders).catch((e) => console.error("Could not load orders", e));
  }, [authed]);

  /* The badge is the in-app half of the notification. The other half is the
     WhatsApp message the customer sends from the top-up screen, which is what
     actually reaches the owner when the admin tab is closed. */
  useEffect(() => {
    if (!authed) return;
    let alive = true;
    const tick = () => {
      countPendingTopups().then((n) => { if (alive) setPending(n); }).catch(() => {});
      countPendingRequests().then((n) => { if (alive) setPendingReqs(n); }).catch(() => {});
    };
    tick();
    const id = setInterval(tick, 30000);
    return () => { alive = false; clearInterval(id); };
  }, [authed]);

  /* Admin is the one screen that must not flip to RTL — it is written in
     English and the storefront's language toggle should not reach it. */
  useEffect(() => {
    const el = document.documentElement;
    const prev = el.getAttribute("dir");
    el.setAttribute("dir", "ltr");
    return () => { if (prev) el.setAttribute("dir", prev); };
  }, []);

  if (checking) {
    return (
      <div className="min-h-screen flex items-center justify-center" style={{ background: T.bg }}>
        <Loader2 className="animate-spin" size={22} style={{ color: T.brandText }} />
      </div>
    );
  }

  /* Signed in, but as a customer. There is one sign-in for the whole shop, so
     landing here is not a mistake to scold — it just means this account is not
     the owner's. Saying so plainly beats a blank admin that silently fails
     every save. */
  if (notAdmin) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center px-6 text-center"
        style={{ background: T.bg, fontFamily: ui, color: T.ink }}>
        <div style={{ fontFamily: script, fontSize: 34, color: T.brandText, marginBottom: 18 }}>Asmar</div>
        <p style={{ fontFamily: display, fontSize: 24, marginBottom: 8 }}>This is a customer account</p>
        <p style={{ fontSize: 14, color: T.inkSoft, maxWidth: 360, lineHeight: 1.7 }}>
          Everything in your account — your balance, your orders — is on the store side.
          Sign out and back in with the owner account to manage the shop.
        </p>
        <div className="flex flex-col gap-2.5 mt-8" style={{ width: "100%", maxWidth: 280 }}>
          <Btn full variant="ghost" onClick={async () => { await auth.signOut(); }}>Sign out</Btn>
          <Btn full variant="quiet" onClick={exit}>Back to store</Btn>
        </div>
      </div>
    );
  }

  if (!authed) {
    return (
      <AdminLogin settings={settings} exit={exit}
        onAuthed={() => {
          if (!auth.real) { try { sessionStorage.setItem(LOCAL_UNLOCK_KEY, "1"); } catch { /* ignore */ } }
          setAuthed(true);
        }} />
    );
  }

  const badgeFor = (k) =>
    k === "topups" ? pending
    : k === "orders" ? openOrders
    : k === "customers" ? pendingReqs
    : 0;

  const navItem = (k, label, Icon, compact) => {
    const on = tab === k;
    const badge = badgeFor(k);
    return (
      <button key={k} onClick={() => { onFlush?.(); setTab(k); }}
        className="flex items-center gap-2.5 press shrink-0 w-full"
        style={{
          padding: compact ? "8px 13px" : "9px 12px",
          borderRadius: 9, fontSize: 13.5, textAlign: "start",
          whiteSpace: "nowrap",
          background: on ? T.tint : "transparent",
          color: on ? T.ink : T.inkSoft,
          border: `1px solid ${on ? T.tintDeep : "transparent"}`,
        }}>
        <Icon size={15} style={{ color: on ? T.brandText : T.inkSoft }} />
        <span className="flex-1" style={{ fontWeight: on ? 500 : 400 }}>{label}</span>
        {badge > 0 && (
          <span className="flex items-center justify-center"
            style={{ minWidth: 19, height: 19, borderRadius: 10, padding: "0 6px", fontSize: 11,
                     fontWeight: 600, background: T.brand, color: "#fff" }}>
            {badge}
          </span>
        )}
      </button>
    );
  };

  return (
    <div className="min-h-screen" style={{ background: T.bg, fontFamily: ui, color: T.ink }}>
      <header className="sticky top-0 z-20 px-4 sm:px-6 py-3 flex items-center gap-4"
        style={{ background: "var(--bg-blur)", backdropFilter: "blur(12px)", borderBottom: `1px solid ${T.line}` }}>
        <div className="shrink-0">
          <div style={{ fontFamily: script, fontSize: 25, color: T.brandText, lineHeight: 1 }}>Asmar</div>
          <div style={{ ...labelStyle, fontSize: 9.5, letterSpacing: ".22em" }}>Admin</div>
        </div>
        <div className="ms-auto flex items-center gap-2">
          <SaveState state={saveState} />
          <button
            onClick={async () => {
              onFlush?.();
              if (auth.real) await auth.signOut();
              else { try { sessionStorage.removeItem(LOCAL_UNLOCK_KEY); } catch { /* ignore */ } }
              setAuthed(false);
            }}
            className="px-3 py-2 press"
            style={{ ...labelStyle, fontSize: 11.5, letterSpacing: ".08em",
                     border: `1px solid ${T.line}`, borderRadius: 8 }}>
            {auth.real ? "Sign out" : "Lock"}
          </button>
          <button onClick={exit} className="flex items-center gap-1.5 px-3 py-2 press"
            style={{ ...labelStyle, fontSize: 11.5, letterSpacing: ".08em",
                     border: `1px solid ${T.line}`, borderRadius: 8 }}>
            <LogOut size={14} /> Store
          </button>
        </div>
      </header>

      {saveError && saveState === "error" && (
        <div className="px-5 py-3 flex items-center gap-2" style={{ background: T.tint, color: T.brandText }}>
          <AlertTriangle size={15} className="shrink-0" />
          <span style={{ fontSize: 13 }}>{saveError} Your change is on screen but is not stored yet.</span>
        </div>
      )}

      <div className="flex" style={{ maxWidth: 1160, margin: "0 auto" }}>
        {/* Desktop: a standing rail, grouped by how often each thing is touched.
            Mobile: the same list laid flat and scrolled, because a drawer would
            be one more tap between him and a waiting order. */}
        <nav className="hidden lg:flex flex-col gap-5 shrink-0 px-4 py-6 sticky self-start"
          style={{ width: 208, top: 61 }}>
          {NAV.map(([group, items]) => (
            <div key={group}>
              <p style={{ ...labelStyle, fontSize: 9.5, letterSpacing: ".18em", marginBottom: 6, paddingInlineStart: 12 }}>
                {group}
              </p>
              <div className="flex flex-col gap-0.5">
                {items.map(([k, label, Icon]) => navItem(k, label, Icon, false))}
              </div>
            </div>
          ))}
        </nav>

        <div className="flex-1 min-w-0">
          <div className="lg:hidden flex gap-1.5 px-4 py-3 overflow-x-auto navscroll"
            style={{ borderBottom: `1px solid ${T.line}` }}>
            {NAV.flatMap(([, items]) => items).map(([k, label, Icon]) => (
              <span key={k} className="shrink-0" style={{ width: "auto" }}>
                {navItem(k, label, Icon, true)}
              </span>
            ))}
          </div>

          <main className="px-4 sm:px-6 py-6 pb-24" style={{ maxWidth: 900 }}>
            <div className="flex items-baseline justify-between gap-4 mb-5">
              <h1 style={{ fontFamily: display, fontSize: "clamp(24px, 5vw, 32px)", lineHeight: 1.2, fontWeight: 400 }}>
                {TAB_TITLE[tab]}
              </h1>
              {["products", "categories", "pages", "settings"].includes(tab) && (
                <LangSwitch value={contentLang} onChange={setContentLang} />
              )}
            </div>

            {tab === "overview" && (
              <AdminOverview orders={orders} pending={pending} catalog={catalog}
                settings={settings} go={setTab} />
            )}
            {tab === "orders" && (
              <AdminOrders orders={orders} setStatus={setOrderStatus} setDelivery={setOrderDelivery} />
            )}
            {tab === "topups" && <AdminTopups onCountChange={setPending} whatsapp={settings.whatsapp} />}
            {tab === "customers" && <AdminCustomers whatsapp={settings.whatsapp} />}
            {tab === "products" && (
              <AdminProducts catalog={catalog} setCatalog={setCatalog} categories={categories} lang={contentLang} />
            )}
            {tab === "categories" && (
              <AdminCategories categories={categories} settings={settings} setSettings={setSettings}
                catalog={catalog} setCatalog={setCatalog} lang={contentLang} />
            )}
            {tab === "reviews" && <AdminReviews settings={settings} setSettings={setSettings} catalog={catalog} />}
            {tab === "pages" && <AdminPages settings={settings} setSettings={setSettings} lang={contentLang} />}
            {tab === "settings" && (
              <AdminSettings settings={settings} setSettings={setSettings} catalog={catalog} lang={contentLang} />
            )}
            {tab === "diagnostics" && <AdminDiagnostics />}
          </main>
        </div>
      </div>
    </div>
  );
}

/* =================================================================== overview */
/* Opens with a sentence, not a grid of KPI cards. The first question the owner
   has when he unlocks this on his phone is "is there anything I have to do",
   and a number in a box does not answer it as fast as a plain line of English
   plus the list of things to go and do. */
function AdminOverview({ orders, pending, catalog, settings, go }) {
  const openOrders = orders.filter((o) => o.status === "New" || o.status === "Awaiting payment");
  const jobs = [];
  if (openOrders.length) {
    jobs.push({
      k: "orders",
      label: openOrders.length === 1 ? "1 order to deliver" : `${openOrders.length} orders to deliver`,
      sub: openOrders.slice(0, 3).map((o) => o.customer.name).join(", "),
      Icon: Receipt,
    });
  }
  if (pending) {
    jobs.push({
      k: "topups",
      label: pending === 1 ? "1 top-up to check" : `${pending} top-ups to check`,
      sub: "Someone sent money and is waiting on their balance",
      Icon: Wallet,
    });
  }

  const live = catalog.filter((p) => p.active).length;
  const delivered = orders.filter((o) => o.status === "Delivered");
  const revenue = delivered.reduce((s, o) => s + o.total, 0);

  const stat = (label, value, hint) => (
    <div key={label} className="px-4 py-4" style={cardStyle}>
      <div style={{ ...labelStyle, fontSize: 9.5, letterSpacing: ".16em" }}>{label}</div>
      <div style={{ fontFamily: display, fontSize: "clamp(22px, 5vw, 30px)", marginTop: 6, lineHeight: 1.1 }}>
        {value}
      </div>
      {hint && <div style={{ fontSize: 11.5, color: T.inkSoft, marginTop: 4 }}>{hint}</div>}
    </div>
  );

  return (
    <>
      <section className="mb-7">
        {jobs.length === 0 ? (
          <div className="px-5 py-6" style={{ ...cardStyle, borderStyle: "dashed" }}>
            <p style={{ fontFamily: display, fontSize: "clamp(19px, 4.4vw, 24px)", lineHeight: 1.35 }}>
              Nothing needs you right now.
            </p>
            <p style={{ fontSize: 13.5, color: T.inkSoft, marginTop: 6, lineHeight: 1.6 }}>
              New orders and top-up requests land here the moment they arrive.
            </p>
          </div>
        ) : (
          <>
            <p style={{ fontFamily: display, fontSize: "clamp(19px, 4.4vw, 24px)", lineHeight: 1.35, marginBottom: 12 }}>
              {jobs.length === 1 ? "One thing needs you." : `${jobs.length} things need you.`}
            </p>
            <div className="flex flex-col gap-2">
              {jobs.map(({ k, label, sub, Icon }) => (
                <button key={k} onClick={() => go(k)} className="row flex items-center gap-3.5 px-4 py-3.5 text-start"
                  style={{ ...cardStyle, borderColor: T.tintDeep }}>
                  <span className="flex items-center justify-center shrink-0"
                    style={{ width: 38, height: 38, borderRadius: 10, background: T.tint, color: T.brandText }}>
                    <Icon size={17} />
                  </span>
                  <span className="flex-1 min-w-0">
                    <span className="block" style={{ fontSize: 14.5, fontWeight: 500 }}>{label}</span>
                    {sub && <span className="block truncate" style={{ fontSize: 12, color: T.inkSoft }}>{sub}</span>}
                  </span>
                  <ArrowRight size={16} style={{ color: T.rose }} className="shrink-0" />
                </button>
              ))}
            </div>
          </>
        )}
      </section>

      <section className="mb-7">
        <p style={{ ...labelStyle, marginBottom: 10 }}>The shop</p>
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-2.5">
          {stat("Live products", live, `${catalog.length - live} hidden`)}
          {stat("Orders", orders.length, `${delivered.length} delivered`)}
          {stat("Earned", money(revenue), "from delivered orders")}
          {stat("Store", auth.real ? "Online" : "Local", auth.real ? "Shared with customers" : "This browser only")}
        </div>
      </section>

      {!auth.real && (
        <div className="flex items-start gap-2.5 px-4 py-3.5" style={{ ...cardStyle, borderColor: T.tintDeep }}>
          <AlertTriangle size={15} className="shrink-0" style={{ color: T.brandText, marginTop: 2 }} />
          <div>
            <p style={{ fontSize: 13.5, lineHeight: 1.6 }}>
              Customers cannot see this shop yet. Everything is saved in this browser only.
            </p>
            <button onClick={() => go("diagnostics")} className="press mt-2"
              style={{ fontSize: 12, letterSpacing: ".06em", textTransform: "uppercase", color: T.brandText }}>
              What is missing →
            </button>
          </div>
        </div>
      )}
    </>
  );
}

/* ===================================================================== orders */
/* The subscription details for one line of an order.
 *
 * Deliberately three plain fields rather than one free-text box: the customer's
 * side renders each with its own copy button, and "tap to copy the password"
 * only works if the shop knows which part is the password. */
function DeliveryEditor({ order, onSave }) {
  const [rows, setRows] = useState(() => order.items.map((_, i) => order.delivery?.[i] || {}));
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState("");

  const filled = (r) => !!(r.email?.trim() || r.password?.trim());
  const complete = rows.every(filled);
  const anything = rows.some(filled);
  /* What is actually on the server, not what is typed but unsaved — telling
     someone their order is ready while the details sit in an unsaved form is
     the one mistake this button could cause. `some`, not `every`: half an
     order is still something worth opening the shop for. */
  const live = order.items.some((_, i) => filled(order.delivery?.[i] || {}));

  const set = (i, key, value) =>
    setRows((prev) => prev.map((r, n) => (n === i ? { ...r, [key]: value } : r)));

  const save = async () => {
    setSaving(true);
    setError("");
    try {
      const stamped = rows.map((r) =>
        filled(r) ? { ...r, sent_at: r.sent_at || new Date().toISOString() } : {});
      await onSave(stamped, complete);
      setSaved(true);
      setTimeout(() => setSaved(false), 2500);
    } catch (e) {
      setError(e?.message || "Could not save.");
    } finally {
      setSaving(false);
    }
  };

  const field = {
    width: "100%", padding: "7px 10px", borderRadius: 7, fontSize: 13,
    background: T.bg, border: `1px solid ${T.line}`, color: T.ink,
  };

  /* Nothing secret in the message. It says the order is ready and where to
     look; the details stay behind the customer's own sign-in. */
  const waHref = `https://wa.me/${String(order.customer.phone).replace(/\D/g, "")}`
    + `?text=${encodeURIComponent(
        `Your order ${order.code} is ready. Open your account on the shop to see the details:`
        + ` ${window.location.origin}${import.meta.env.BASE_URL}account`)}`;

  return (
    <div className="mt-3 pt-3" style={{ borderTop: `1px solid ${T.line}` }}>
      <div style={{ ...labelStyle, fontSize: 10, letterSpacing: ".16em", marginBottom: 8 }}>
        Subscription details
      </div>

      <div className="flex flex-col gap-3">
        {order.items.map((item, i) => (
          <div key={i} className="px-3 py-3" style={{ background: T.bg, borderRadius: 9, border: `1px solid ${T.line}` }}>
            <div className="flex items-center justify-between gap-2 mb-2">
              <span style={{ fontSize: 12.5, fontWeight: 500 }}>{item.name} {item.label}</span>
              {filled(rows[i]) && (
                <Check size={13} style={{ color: T.ok }} />
              )}
            </div>
            <div className="grid sm:grid-cols-2 gap-2">
              <input style={field} placeholder="Account email"
                value={rows[i].email || ""} onChange={(e) => set(i, "email", e.target.value)} />
              <input style={field} placeholder="Password"
                value={rows[i].password || ""} onChange={(e) => set(i, "password", e.target.value)} />
            </div>
            <input style={{ ...field, marginTop: 8 }} placeholder="Note (optional) — e.g. use the third profile"
              value={rows[i].note || ""} onChange={(e) => set(i, "note", e.target.value)} />
          </div>
        ))}
      </div>

      {error && (
        <p className="flex items-start gap-1.5 mt-2" style={{ fontSize: 12, color: T.brandText }}>
          <AlertTriangle size={13} className="shrink-0" style={{ marginTop: 1 }} /> {error}
        </p>
      )}

      <div className="flex flex-wrap items-center gap-2 mt-3">
        <Btn onClick={save} disabled={saving || !anything}>
          {saving ? <Loader2 size={14} className="animate-spin" />
                  : saved ? <Check size={14} />
                  : null}
          {complete ? "Save and mark delivered" : "Save"}
        </Btn>

        {/* Only once the customer has something to look at. */}
        {live && (
          <a href={waHref} target="_blank" rel="noopener noreferrer">
            <Btn variant="ghost">Tell them on WhatsApp</Btn>
          </a>
        )}
      </div>

      {anything && !complete && (
        <p style={{ fontSize: 11.5, color: T.inkSoft, marginTop: 7 }}>
          One line is still empty, so the status stays as it is. Fill them all to mark the order delivered.
        </p>
      )}
    </div>
  );
}

function AdminOrders({ orders, setStatus, setDelivery }) {
  const [filter, setFilter] = useState("All");
  const revenue = orders.filter((o) => o.status === "Delivered").reduce((s, o) => s + o.total, 0);
  const open = orders.filter((o) => o.status === "New" || o.status === "Awaiting payment").length;

  if (orders.length === 0) {
    return <EmptyState title="No orders yet" body="Orders placed in the store show up here." />;
  }

  const list = filter === "All" ? orders : orders.filter((o) => o.status === filter);

  return (
    <>
      <div className="grid grid-cols-3 gap-2.5 mb-6">
        {[["Orders", orders.length], ["Open", open], ["Delivered", money(revenue)]].map(([l, v]) => (
          <div key={l} className="px-4 py-3.5" style={cardStyle}>
            <div style={{ ...labelStyle, fontSize: 10, letterSpacing: ".16em" }}>{l}</div>
            <div style={{ fontFamily: display, fontSize: "clamp(20px, 5vw, 27px)", marginTop: 5 }}>{v}</div>
          </div>
        ))}
      </div>

      <div className="flex gap-2 mb-4 overflow-x-auto navscroll">
        {["All", ...STATUSES].map((s) => (
          <button key={s} onClick={() => setFilter(s)} className="shrink-0 press"
            style={{ padding: "6px 12px", borderRadius: 999, fontSize: 11.5,
                     background: filter === s ? T.tint : "transparent",
                     color: filter === s ? T.brandText : T.inkSoft,
                     border: `1px solid ${filter === s ? T.tintDeep : T.line}` }}>
            {s}
          </button>
        ))}
      </div>

      <div className="flex flex-col gap-2.5">
        {list.map((o) => (
          <div key={o.code} className="px-4 py-4" style={cardStyle}>
            <div className="flex justify-between items-start gap-3 mb-2">
              <div className="min-w-0">
                <div style={{ fontFamily: display, fontSize: 18 }}>{o.customer.name}</div>
                <div className="flex flex-wrap items-center gap-2" style={{ fontSize: 12, color: T.inkSoft }}>
                  <span>{o.code} · {new Date(o.createdAt).toLocaleDateString()} · {o.customer.payment === "online" ? "Online" : "Cash"}</span>
                  {o.paymentStatus && o.paymentStatus !== "unpaid" && (
                    <span style={{ fontSize: 10, letterSpacing: ".1em", textTransform: "uppercase",
                                   padding: "3px 8px", borderRadius: 999,
                                   background: o.paymentStatus === "paid" ? T.ok : T.tint,
                                   color: o.paymentStatus === "paid" ? "#fff" : T.brandText }}>
                      {o.paymentStatus === "paid" ? "Paid" : o.paymentStatus}
                    </span>
                  )}
                </div>
              </div>
              <div style={{ fontFamily: display, fontSize: 21, color: T.brandText }}>{money(o.total)}</div>
            </div>
            <div style={{ fontSize: 13, color: T.inkSoft, lineHeight: 1.6 }}>
              {o.items.map((i) => `${i.name} ${i.label} ×${i.qty}`).join(" · ")}
            </div>
            <div style={{ fontSize: 12.5, color: T.inkSoft, marginTop: 6 }}>
              <a href={`https://wa.me/${String(o.customer.phone).replace(/\D/g, "")}`} target="_blank"
                rel="noopener noreferrer" style={{ color: T.brandText }}>{o.customer.phone}</a>
              {" · "}{o.customer.email}
              {o.customer.notes ? ` · "${o.customer.notes}"` : ""}
            </div>
            <div className="flex flex-wrap gap-1.5 mt-3">
              {STATUSES.map((s) => (
                <button key={s} onClick={() => setStatus(o.code, s)} className="press"
                  style={{ padding: "5px 11px", borderRadius: 7, fontSize: 11.5,
                           background: o.status === s ? (s === "Delivered" ? T.ok : T.brand) : "transparent",
                           color: o.status === s ? "#fff" : T.inkSoft,
                           border: `1px solid ${o.status === s ? "transparent" : T.line}` }}>
                  {s}
                </button>
              ))}
            </div>

            <DeliveryEditor
              order={o}
              onSave={(rows, complete) => setDelivery(o.code, rows, o.items.length, complete)}
            />
          </div>
        ))}
      </div>
    </>
  );
}

/* ==================================================================== top-ups */
/* Receipts live in a private Storage bucket and are fetched through a signed
   URL that expires in ten minutes. Rows created before that migration still
   carry the image inline as a data URL in `receipt`, so both are handled —
   there is no cutover date at which old top-ups stop being viewable. */
function ReceiptImage({ row, onZoom }) {
  const [src, setSrc] = useState(row.receipt || "");
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    if (row.receipt) { setSrc(row.receipt); return; }        // legacy inline
    if (!row.receipt_path) return;
    let alive = true;
    receiptUrl(row.receipt_path)
      .then((url) => { if (alive) { setSrc(url); setFailed(!url); } })
      .catch(() => { if (alive) setFailed(true); });
    return () => { alive = false; };
  }, [row.receipt, row.receipt_path]);

  if (!row.receipt && !row.receipt_path) return null;

  if (failed) {
    return (
      <p className="mt-3" style={{ fontSize: 12.5, color: T.inkSoft }}>
        The receipt could not be loaded. Ask the customer to send it on WhatsApp.
      </p>
    );
  }

  if (!src) {
    return <div className="mt-3" style={{ height: 120, borderRadius: 10, background: T.surface2 }} />;
  }

  return (
    <button onClick={() => onZoom(src)} className="block w-full mt-3 overflow-hidden press"
      style={{ borderRadius: 10, border: `1px solid ${T.line}`, background: T.surface2 }}
      title="Click to enlarge">
      <img src={src} alt="Transfer receipt" onError={() => setFailed(true)}
        style={{ width: "100%", maxHeight: 260, objectFit: "contain", display: "block" }} />
    </button>
  );
}

/* A customer transferred money and sent a picture of it. The owner looks at the
   picture, checks it against his own Whish or OMT history, and credits it — or
   does not. Nothing here is automatic, deliberately: the picture is evidence,
   not proof, and only he can match it to money that actually arrived. */
function AdminTopups({ onCountChange, whatsapp }) {
  const [view, setView] = useState("pending");
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState(null);
  const [notes, setNotes] = useState({});
  const [zoom, setZoom] = useState(null);
  const [err, setErr] = useState("");

  const load = async (which = view) => {
    setLoading(true); setErr("");
    try {
      const list = await fetchTopups(which);
      setRows(list);
      if (which === "pending") onCountChange?.(list.length);
    } catch (e) {
      console.error(e);
      setErr(e?.message || "Could not load top-ups.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(view); /* eslint-disable-next-line */ }, [view]);

  const decide = async (row, approve) => {
    if (busyId) return;
    setBusyId(row.id); setErr("");
    try {
      await decideTopup(row.id, approve, (notes[row.id] || "").trim());
      setRows((list) => list.filter((r) => r.id !== row.id));
      onCountChange?.(Math.max(0, rows.length - 1));
    } catch (e) {
      console.error(e);
      setErr(e?.message || "Could not save that decision.");
      load(view);
    } finally {
      setBusyId(null);
    }
  };

  const when = (s) => new Date(s).toLocaleString();

  return (
    <>
      <div className="flex gap-2 mb-4">
        {[["pending", "Waiting"], ["decided", "History"]].map(([k, label]) => (
          <button key={k} onClick={() => setView(k)} className="press"
            style={{ padding: "6px 14px", borderRadius: 999, fontSize: 12,
                     background: view === k ? T.tint : "transparent",
                     color: view === k ? T.brandText : T.inkSoft,
                     border: `1px solid ${view === k ? T.tintDeep : T.line}` }}>
            {label}
          </button>
        ))}
        <button onClick={() => load(view)} className="press ms-auto"
          style={{ padding: "6px 14px", borderRadius: 999, fontSize: 12, color: T.inkSoft,
                   border: `1px solid ${T.line}` }}>
          Refresh
        </button>
      </div>

      {err && (
        <p className="flex items-start gap-1.5 mb-4" style={{ fontSize: 12.5, color: T.brandText }}>
          <AlertTriangle size={14} className="shrink-0" style={{ marginTop: 1 }} /> {err}
        </p>
      )}

      {loading ? (
        <div className="flex flex-col gap-2">
          {[0, 1].map((i) => <div key={i} className="skeleton" style={{ height: 120 }} />)}
        </div>
      ) : rows.length === 0 ? (
        <EmptyState
          title={view === "pending" ? "Nothing waiting" : "No decided top-ups yet"}
          body={view === "pending"
            ? "Top-up requests appear here the moment a customer sends one."
            : "Approved and rejected requests are kept here."} />
      ) : (
        <div className="flex flex-col gap-2.5">
          {rows.map((r) => (
            <div key={r.id} className="px-4 py-4" style={cardStyle}>
              <div className="flex flex-wrap justify-between items-start gap-3">
                <div className="min-w-0">
                  <div style={{ fontFamily: display, fontSize: 18 }}>{r.name || r.email}</div>
                  <div style={{ fontSize: 12, color: T.inkSoft }}>
                    {r.ref} · {when(r.created_at)} · {String(r.method).toUpperCase()}
                  </div>
                  <div style={{ fontSize: 12.5, color: T.inkSoft, marginTop: 4 }}>
                    {r.phone && (
                      <a href={`https://wa.me/${String(r.phone).replace(/\D/g, "")}`} target="_blank"
                        rel="noopener noreferrer" style={{ color: T.brandText }}>{r.phone}</a>
                    )}
                    {r.phone && r.email ? " · " : ""}{r.email}
                  </div>
                </div>
                <div className="text-end">
                  <div style={{ fontFamily: display, fontSize: 26, color: T.brandText }}>{money(r.amount)}</div>
                  {r.status !== "pending" && (
                    <span style={{ fontSize: 10.5, letterSpacing: ".1em", textTransform: "uppercase",
                                   padding: "3px 9px", borderRadius: 999,
                                   background: r.status === "approved" ? T.ok : "transparent",
                                   color: r.status === "approved" ? "#fff" : T.inkSoft,
                                   border: r.status === "approved" ? "none" : `1px solid ${T.line}` }}>
                      {r.status}
                    </span>
                  )}
                </div>
              </div>

              {r.admin_note && (
                <p style={{ fontSize: 12.5, color: T.inkSoft, marginTop: 8 }}>“{r.admin_note}”</p>
              )}

              <ReceiptImage row={r} onZoom={setZoom} />

              {r.status === "pending" && (
                <div className="mt-3 flex flex-col gap-2">
                  <input value={notes[r.id] || ""} placeholder="Note for the customer (optional)"
                    onChange={(e) => setNotes({ ...notes, [r.id]: e.target.value })}
                    className="w-full px-3 py-2 outline-none input" style={inputStyle} />
                  <div className="flex flex-wrap gap-2">
                    <button onClick={() => decide(r, true)} disabled={busyId === r.id}
                      className="flex items-center gap-1.5 press"
                      style={{ fontSize: 12.5, letterSpacing: ".06em", textTransform: "uppercase", color: "#fff",
                               background: T.ok, borderRadius: 8, padding: "9px 16px",
                               opacity: busyId === r.id ? 0.6 : 1 }}>
                      {busyId === r.id ? <Loader2 size={14} className="animate-spin" /> : <Check size={14} />}
                      Add {money(r.amount)} to balance
                    </button>
                    <button onClick={() => decide(r, false)} disabled={busyId === r.id}
                      className="flex items-center gap-1.5 press"
                      style={{ fontSize: 12.5, letterSpacing: ".06em", textTransform: "uppercase", color: T.rose,
                               border: `1px solid ${T.line}`, borderRadius: 8, padding: "9px 16px" }}>
                      <X size={14} /> Reject
                    </button>
                    {whatsapp && r.phone && (
                      <a href={`https://wa.me/${String(r.phone).replace(/\D/g, "")}?text=${encodeURIComponent(`About your top-up ${r.ref}`)}`}
                        target="_blank" rel="noopener noreferrer"
                        className="flex items-center gap-1.5 press"
                        style={{ fontSize: 12.5, letterSpacing: ".06em", textTransform: "uppercase",
                                 color: T.inkSoft, border: `1px solid ${T.line}`, borderRadius: 8, padding: "9px 16px" }}>
                        Ask them
                      </a>
                    )}
                  </div>
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {zoom && (
        <div className="fade fixed inset-0 z-[80] flex items-center justify-center p-6"
          style={{ background: "rgba(0,0,0,.8)" }} onClick={() => setZoom(null)}>
          <img src={zoom} alt="" style={{ maxWidth: "100%", maxHeight: "100%", objectFit: "contain" }} />
        </div>
      )}
    </>
  );
}

/* ================================================================== customers */
/* Requests waiting for a decision.
 *
 * Approving does two things in a required order: create the real login through
 * the Edge Function, then mark the request decided — which wipes the stored
 * password. The other order would leave a request marked approved, its password
 * already gone, and no account behind it. */
function AccountRequests({ onApproved, whatsapp }) {
  const [rows, setRows] = useState([]);
  const [view, setView] = useState("pending");
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState(null);
  const [notes, setNotes] = useState({});
  const [err, setErr] = useState("");
  const [done, setDone] = useState(null);

  const load = async (which = view) => {
    setLoading(true);
    try { setRows(await fetchAccountRequests(which)); }
    catch (e) { console.error(e); setErr(e?.message || "Could not load requests."); }
    finally { setLoading(false); }
  };
  useEffect(() => { load(view); /* eslint-disable-next-line */ }, [view]);

  const decide = async (row, approve) => {
    if (busyId) return;
    setBusyId(row.id); setErr(""); setDone(null);
    try {
      await decideAccountRequest(row, approve, (notes[row.id] || "").trim());
      /* Shown once, right after approving: this is the only moment the password
         is still in hand, and the customer has to be told it. */
      if (approve) setDone({ email: row.email, password: row.password, name: row.name, phone: row.phone });
      await load(view);
      onApproved?.();
    } catch (e) {
      setErr(e?.message || "Could not action that request.");
    } finally {
      setBusyId(null);
    }
  };

  const when = (s) => new Date(s).toLocaleString();
  if (!loading && view === "pending" && rows.length === 0 && !done) return null;

  return (
    <div className="px-4 py-4 mb-5" style={cardStyle}>
      <div className="flex flex-wrap items-center gap-2 mb-3">
        <p style={{ ...labelStyle, margin: 0 }}>
          Account requests{view === "pending" && rows.length ? ` · ${rows.length} waiting` : ""}
        </p>
        <div className="flex gap-2 ms-auto">
          {[["pending", "Waiting"], ["decided", "History"]].map(([k, label]) => (
            <button key={k} onClick={() => setView(k)} className="press"
              style={{ padding: "5px 12px", borderRadius: 999, fontSize: 11.5,
                       background: view === k ? T.tint : "transparent",
                       color: view === k ? T.brandText : T.inkSoft,
                       border: `1px solid ${view === k ? T.tintDeep : T.line}` }}>
              {label}
            </button>
          ))}
        </div>
      </div>

      {done && (
        <div className="px-3.5 py-3 mb-3" style={{ background: T.tint, borderRadius: 10 }}>
          <p style={{ fontSize: 12.5, color: T.ink, lineHeight: 1.6, marginBottom: 8 }}>
            Account made. Send them this — it is the only time the password is shown.
          </p>
          <p className="mb-2" style={{ fontFamily: "monospace", fontSize: 13, color: T.brandText }}>
            {done.email} · {done.password}
          </p>
          <div className="flex flex-wrap gap-2">
            <button onClick={() => navigator.clipboard?.writeText(
              `Your Asmar Store login\nEmail: ${done.email}\nPassword: ${done.password}`)}
              className="press" style={{ fontSize: 11.5, letterSpacing: ".06em", textTransform: "uppercase",
                       color: T.brandText, border: `1px solid ${T.tintDeep}`, borderRadius: 8, padding: "6px 12px" }}>
              <Copy size={12} /> Copy
            </button>
            {done.phone && (
              <a href={`https://wa.me/${String(done.phone).replace(/\D/g, "")}?text=${encodeURIComponent(
                `Your Asmar Store login\nEmail: ${done.email}\nPassword: ${done.password}`)}`}
                target="_blank" rel="noopener noreferrer" className="press"
                style={{ fontSize: 11.5, letterSpacing: ".06em", textTransform: "uppercase",
                         color: T.brandText, border: `1px solid ${T.tintDeep}`, borderRadius: 8, padding: "6px 12px" }}>
                Send on WhatsApp
              </a>
            )}
            <button onClick={() => setDone(null)} className="press ms-auto"
              style={{ fontSize: 11.5, color: T.inkSoft }}>Dismiss</button>
          </div>
        </div>
      )}

      {err && (
        <p className="flex items-start gap-1.5 mb-3" style={{ fontSize: 12.5, color: T.brandText }}>
          <AlertTriangle size={13} className="shrink-0" style={{ marginTop: 1 }} /> {err}
        </p>
      )}

      {loading ? (
        <p style={{ fontSize: 12.5, color: T.inkSoft }}>Loading…</p>
      ) : rows.length === 0 ? (
        <p style={{ fontSize: 12.5, color: T.inkSoft }}>
          {view === "pending" ? "Nothing waiting." : "No decided requests yet."}
        </p>
      ) : (
        <div className="flex flex-col gap-2">
          {rows.map((r) => (
            <div key={r.id} className="px-3.5 py-3"
              style={{ background: T.surface2, border: `1px solid ${T.line}`, borderRadius: 10 }}>
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div className="min-w-0">
                  <div style={{ fontSize: 14, fontWeight: 500 }}>{r.name}</div>
                  <div style={{ fontSize: 12, color: T.inkSoft }}>{r.email}</div>
                  <div style={{ fontSize: 12, color: T.inkSoft }}>
                    {whatsapp !== undefined && r.phone ? (
                      <a href={`https://wa.me/${String(r.phone).replace(/\D/g, "")}`} target="_blank"
                        rel="noopener noreferrer" style={{ color: T.brandText }}>{r.phone}</a>
                    ) : r.phone}
                    {" · "}{when(r.created_at)}
                  </div>
                  {r.admin_note && (
                    <div style={{ fontSize: 12, color: T.inkSoft, marginTop: 3 }}>“{r.admin_note}”</div>
                  )}
                </div>
                {r.status !== "pending" && (
                  <span style={{ fontSize: 10.5, letterSpacing: ".08em", textTransform: "uppercase",
                                 padding: "3px 9px", borderRadius: 999,
                                 background: r.status === "approved" ? T.ok : "transparent",
                                 color: r.status === "approved" ? "#fff" : T.inkSoft,
                                 border: r.status === "approved" ? "none" : `1px solid ${T.line}` }}>
                    {r.status}
                  </span>
                )}
              </div>

              {r.status === "pending" && (
                <div className="flex flex-wrap items-center gap-2 mt-3">
                  <input value={notes[r.id] || ""} placeholder="Note (optional)"
                    onChange={(e) => setNotes({ ...notes, [r.id]: e.target.value })}
                    className="flex-1 min-w-0 px-3 py-2 outline-none input"
                    style={{ ...inputStyle, fontSize: 12.5 }} />
                  <button onClick={() => decide(r, true)} disabled={busyId === r.id}
                    className="press flex items-center gap-1.5 px-3 py-2"
                    style={{ fontSize: 11.5, letterSpacing: ".06em", textTransform: "uppercase",
                             color: "#fff", background: T.ok, borderRadius: 8,
                             opacity: busyId === r.id ? 0.6 : 1 }}>
                    {busyId === r.id ? <Loader2 size={12} className="animate-spin" /> : <Check size={12} />}
                    Approve
                  </button>
                  <button onClick={() => decide(r, false)} disabled={busyId === r.id}
                    className="press px-3 py-2"
                    style={{ fontSize: 11.5, letterSpacing: ".06em", textTransform: "uppercase",
                             color: T.inkSoft, border: `1px solid ${T.line}`, borderRadius: 8 }}>
                    Reject
                  </button>
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function AdminCustomers({ whatsapp }) {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState("");
  const [find, setFind] = useState("");
  const [openId, setOpenId] = useState(null);
  const [adjust, setAdjust] = useState({});
  const [busy, setBusy] = useState(false);

  const [form, setForm] = useState({ email: "", password: "", name: "", phone: "" });
  const [creating, setCreating] = useState(false);
  const [created, setCreated] = useState(null);
  const [copied, setCopied] = useState(false);

  const load = async () => {
    setLoading(true);
    try { setRows(await fetchCustomers()); }
    catch (e) { console.error(e); setErr(e?.message || "Could not load customers."); }
    finally { setLoading(false); }
  };
  useEffect(() => { load(); }, []);

  /* Generated rather than typed: a password the owner invents on the spot for
     twenty customers ends up being the same password twenty times. */
  const suggest = () => {
    const bytes = crypto.getRandomValues(new Uint8Array(9));
    const pw = btoa(String.fromCharCode(...bytes)).replace(/[+/=]/g, "").slice(0, 10);
    setForm((f) => ({ ...f, password: pw }));
  };

  const create = async () => {
    if (creating) return;
    setCreating(true); setErr(""); setCreated(null);
    try {
      await createCustomer(form);
      setCreated({ ...form });
      setForm({ email: "", password: "", name: "", phone: "" });
      load();
    } catch (e) {
      setErr(e?.message || "Could not create that account.");
    } finally {
      setCreating(false);
    }
  };

  const applyAdjust = async (c) => {
    const raw = adjust[c.id];
    const value = parseFloat(raw?.amount);
    if (!value) return;
    setBusy(true); setErr("");
    try {
      await adjustBalance(c.id, value, (raw?.note || "").trim());
      setAdjust({ ...adjust, [c.id]: { amount: "", note: "" } });
      load();
    } catch (e) {
      setErr(e?.message || "Could not adjust that balance.");
    } finally {
      setBusy(false);
    }
  };

  const term = find.trim().toLowerCase();
  const shown = term
    ? rows.filter((c) => `${c.name} ${c.email} ${c.phone}`.toLowerCase().includes(term))
    : rows;

  const held = rows.reduce((s, c) => s + Math.max(0, Number(c.balance) || 0), 0);

  return (
    <>
      {/* ---- requests waiting ---- */}
      <AccountRequests onApproved={load} whatsapp={whatsapp} />

      {/* ---- create a login ---- */}
      <div className="px-4 py-4 mb-5" style={cardStyle}>
        <p style={{ ...labelStyle, marginBottom: 8 }}>Create a customer login</p>
        <p style={{ fontSize: 12.5, color: T.inkSoft, lineHeight: 1.65, marginBottom: 12 }}>
          Customers cannot sign themselves up. Either approve a request above, or make the
          account here by hand and send them the email and password on WhatsApp.
        </p>
        <div className="grid sm:grid-cols-2 gap-2.5">
          <Field label="Email" type="email" value={form.email}
            onChange={(e) => setForm({ ...form, email: e.target.value })} />
          <div>
            <span className="block mb-1.5" style={labelStyle}>Password</span>
            <div className="flex gap-2">
              <input value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })}
                className="flex-1 min-w-0 px-3.5 py-2.5 outline-none input" style={inputStyle} />
              <button onClick={suggest} className="press shrink-0 px-3"
                style={{ fontSize: 11.5, letterSpacing: ".06em", textTransform: "uppercase",
                         color: T.brandText, border: `1px solid ${T.line}`, borderRadius: 8 }}>
                Generate
              </button>
            </div>
          </div>
          <Field label="Name" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
          <Field label="WhatsApp number" value={form.phone} inputMode="tel"
            onChange={(e) => setForm({ ...form, phone: e.target.value })} />
        </div>
        <Btn onClick={create} style={{ marginTop: 12, opacity: creating ? 0.6 : 1 }}>
          {creating ? "Creating…" : "Create account"}
        </Btn>

        {created && (
          <div className="mt-3 px-3.5 py-3" style={{ background: T.tint, borderRadius: 10 }}>
            <p style={{ fontSize: 12.5, color: T.ink, lineHeight: 1.7 }}>
              Account made. Send them this — it is the only time the password is shown.
            </p>
            <p className="mt-2" style={{ fontFamily: "monospace", fontSize: 13, color: T.ink, wordBreak: "break-all" }}>
              {created.email} · {created.password}
            </p>
            <div className="flex flex-wrap gap-2 mt-3">
              <button onClick={() => {
                navigator.clipboard?.writeText(
                  `Your Asmar Store login\nEmail: ${created.email}\nPassword: ${created.password}`
                );
                setCopied(true); setTimeout(() => setCopied(false), 2000);
              }} className="flex items-center gap-1.5 press"
                style={{ fontSize: 12, letterSpacing: ".06em", textTransform: "uppercase", color: T.brandText,
                         border: `1px solid ${T.tintDeep}`, borderRadius: 8, padding: "7px 12px" }}>
                {copied ? <Check size={13} /> : <Copy size={13} />} {copied ? "Copied" : "Copy"}
              </button>
              {created.phone && (
                <a href={`https://wa.me/${created.phone.replace(/\D/g, "")}?text=${encodeURIComponent(
                  `Your Asmar Store login\nEmail: ${created.email}\nPassword: ${created.password}`)}`}
                  target="_blank" rel="noopener noreferrer" className="flex items-center gap-1.5 press"
                  style={{ fontSize: 12, letterSpacing: ".06em", textTransform: "uppercase", color: T.brandText,
                           border: `1px solid ${T.tintDeep}`, borderRadius: 8, padding: "7px 12px" }}>
                  Send on WhatsApp
                </a>
              )}
            </div>
          </div>
        )}
      </div>

      {err && (
        <p className="flex items-start gap-1.5 mb-4" style={{ fontSize: 12.5, color: T.brandText }}>
          <AlertTriangle size={14} className="shrink-0" style={{ marginTop: 1 }} /> {err}
        </p>
      )}

      {/* ---- the list ---- */}
      <div className="grid grid-cols-2 gap-2.5 mb-4">
        {[["Customers", rows.length], ["Balance you owe", money(held)]].map(([l, v]) => (
          <div key={l} className="px-4 py-3.5" style={cardStyle}>
            <div style={{ ...labelStyle, fontSize: 10, letterSpacing: ".16em" }}>{l}</div>
            <div style={{ fontFamily: display, fontSize: "clamp(20px, 5vw, 27px)", marginTop: 5 }}>{v}</div>
          </div>
        ))}
      </div>

      <div className="flex items-center gap-2 px-3 py-2 mb-3" style={{ ...cardStyle, borderRadius: 8 }}>
        <Search size={15} style={{ color: T.rose }} />
        <input value={find} onChange={(e) => setFind(e.target.value)} placeholder="Find a customer…"
          className="w-full outline-none" style={{ fontFamily: ui, fontSize: 14, background: "transparent", color: T.ink }} />
      </div>

      {loading ? (
        <div className="skeleton" style={{ height: 160 }} />
      ) : shown.length === 0 ? (
        <EmptyState title="No customers yet" body="Create the first login above." />
      ) : (
        <div className="flex flex-col gap-2">
          {shown.map((c) => (
            <div key={c.id} style={cardStyle}>
              <div className="flex items-center gap-3 px-3.5 py-3">
                <span className="flex items-center justify-center shrink-0"
                  style={{ width: 36, height: 36, borderRadius: 18, background: T.tint,
                           color: T.brandText, fontFamily: display, fontSize: 16 }}>
                  {(c.name || c.email || "?").trim().charAt(0).toUpperCase()}
                </span>
                <div className="flex-1 min-w-0">
                  <div className="truncate" style={{ fontSize: 15, lineHeight: 1.4 }}>{c.name || "—"}</div>
                  <div className="truncate" style={{ fontSize: 12, color: T.inkSoft }}>
                    {c.email}{c.phone ? ` · ${c.phone}` : ""}
                  </div>
                </div>
                <div className="text-end shrink-0">
                  <div style={{ fontFamily: display, fontSize: 19,
                                color: Number(c.balance) > 0 ? T.brandText : T.inkSoft }}>
                    {money(c.balance)}
                  </div>
                  {!c.active && <div style={{ fontSize: 10.5, color: T.rose }}>disabled</div>}
                </div>
                <button onClick={() => setOpenId(openId === c.id ? null : c.id)} aria-label="Edit"
                  className="press shrink-0" style={{ color: T.inkSoft }}>
                  <Pencil size={16} />
                </button>
              </div>

              {openId === c.id && (
                <div className="px-3.5 pb-4 pt-3 flex flex-col gap-3"
                  style={{ borderTop: `1px dashed ${T.line}` }}>
                  <div>
                    <span style={labelStyle}>Adjust balance</span>
                    <p style={{ fontSize: 11.5, color: T.inkSoft, marginTop: 4, lineHeight: 1.5 }}>
                      Positive adds, negative takes back. Every adjustment is recorded against your name.
                    </p>
                    <div className="flex flex-wrap gap-2 mt-2">
                      <div className="flex items-center px-2 shrink-0" style={{ ...inputStyle, width: 110 }}>
                        <span style={{ color: T.inkSoft, fontSize: 14 }}>$</span>
                        <input type="number" step="0.5" value={adjust[c.id]?.amount || ""}
                          onChange={(e) => setAdjust({ ...adjust, [c.id]: { ...adjust[c.id], amount: e.target.value } })}
                          className="w-full px-1 py-2 outline-none"
                          style={{ fontFamily: ui, fontSize: 14, color: T.ink, background: "transparent" }} />
                      </div>
                      <input value={adjust[c.id]?.note || ""} placeholder="Reason (shown to the customer)"
                        onChange={(e) => setAdjust({ ...adjust, [c.id]: { ...adjust[c.id], note: e.target.value } })}
                        className="flex-1 min-w-0 px-3 py-2 outline-none input" style={inputStyle} />
                      <button onClick={() => applyAdjust(c)} disabled={busy} className="press shrink-0"
                        style={{ fontSize: 12, letterSpacing: ".06em", textTransform: "uppercase", color: "#fff",
                                 background: T.brand, borderRadius: 8, padding: "9px 16px",
                                 opacity: busy ? 0.6 : 1 }}>
                        Apply
                      </button>
                    </div>
                  </div>

                  <div className="flex flex-wrap gap-2">
                    <button onClick={async () => { await setCustomerActive(c.id, !c.active); load(); }}
                      className="press"
                      style={{ fontSize: 12, letterSpacing: ".06em", textTransform: "uppercase",
                               color: c.active ? T.rose : T.ok, border: `1px solid ${T.line}`,
                               borderRadius: 8, padding: "8px 14px" }}>
                      {c.active ? "Disable login" : "Enable login"}
                    </button>
                    {c.phone && (
                      <a href={`https://wa.me/${String(c.phone).replace(/\D/g, "")}`} target="_blank"
                        rel="noopener noreferrer" className="press"
                        style={{ fontSize: 12, letterSpacing: ".06em", textTransform: "uppercase",
                                 color: T.inkSoft, border: `1px solid ${T.line}`, borderRadius: 8, padding: "8px 14px" }}>
                        WhatsApp
                      </a>
                    )}
                  </div>

                  <p style={{ fontSize: 11.5, color: T.inkSoft, lineHeight: 1.6 }}>
                    To reset a password, use Authentication → Users in the Supabase dashboard.
                  </p>
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </>
  );
}

/* =================================================================== products */
function AdminProducts({ catalog, setCatalog, categories, lang }) {
  const ar = lang === "ar";
  const noteKey = langField(lang, "note");
  const descKey = langField(lang, "description");
  const [openId, setOpenId] = useState(null);
  const [confirmId, setConfirmId] = useState(null);
  const [find, setFind] = useState("");

  const update = (id, patch) => setCatalog(catalog.map((p) => (p.id === id ? { ...p, ...patch } : p)));
  const addProduct = () => {
    const id = "p" + Date.now();
    setCatalog([{ id, name: "New product", category: categories[0], note: "", image: "", description: "",
                  warrantyDays: 30, active: false, featured: false,
                  variants: [{ label: "1 month", price: 0, compareAt: 0 }] }, ...catalog]);
    setOpenId(id);
  };

  const setVariant = (p, i, patch) =>
    update(p.id, { variants: p.variants.map((x, j) => (j === i ? { ...x, ...patch } : x)) });

  const term = find.trim().toLowerCase();
  const shown = term ? catalog.filter((p) => (p.name + " " + p.category).toLowerCase().includes(term)) : catalog;

  return (
    <>
      <div className="flex flex-wrap justify-between items-center gap-2 mb-4">
        <div className="flex items-center gap-2 px-3 py-2 flex-1" style={{ minWidth: 200, ...cardStyle, borderRadius: 8 }}>
          <Search size={15} style={{ color: T.rose }} />
          <input value={find} onChange={(e) => setFind(e.target.value)} placeholder={`Find in ${catalog.length} products…`}
            className="w-full outline-none" style={{ fontFamily: ui, fontSize: 14, background: "transparent", color: T.ink }} />
        </div>
        <Btn onClick={addProduct} style={{ padding: "10px 16px" }}>Add product</Btn>
      </div>

      <div className="flex flex-col gap-2">
        {shown.map((p) => (
          <div key={p.id} style={cardStyle}>
            <div className="flex items-center gap-3 px-3.5 py-3">
              <ProductMark src={p.image} name={p.name || "?"} size={40} />
              <div className="flex-1 min-w-0">
                <div className="truncate" style={{ fontFamily: display, fontSize: 17, lineHeight: 1.4 }}>{p.name}</div>
                <div className="truncate" style={{ fontSize: 12, color: T.inkSoft }}>
                  {p.category} · {p.variants.length} option{p.variants.length !== 1 ? "s" : ""} · from {money(lowestPrice(p))}
                </div>
              </div>
              <button onClick={() => update(p.id, { featured: !p.featured })} aria-label="Toggle featured"
                className="press shrink-0" title="Show in Popular right now, and badge it Best seller"
                style={{ color: p.featured ? T.brandText : T.inkSoft, opacity: p.featured ? 1 : .5 }}>
                <Star size={16} fill={p.featured ? "currentColor" : "none"} />
              </button>
              <button onClick={() => update(p.id, { active: !p.active })} className="press shrink-0"
                style={{ fontSize: 10, letterSpacing: ".1em", textTransform: "uppercase", padding: "5px 10px",
                         borderRadius: 999, background: p.active ? T.tint : "transparent",
                         color: p.active ? T.brandText : T.inkSoft,
                         border: `1px solid ${p.active ? T.tintDeep : T.line}` }}>
                {p.active ? "Live" : "Hidden"}
              </button>
              <button onClick={() => setOpenId(openId === p.id ? null : p.id)} aria-label="Edit"
                className="press shrink-0" style={{ color: T.inkSoft }}>
                <Pencil size={16} />
              </button>
            </div>

            {openId === p.id && (
              <div className="px-3.5 pb-4 flex flex-col gap-3.5" style={{ borderTop: `1px dashed ${T.line}`, paddingTop: 14 }}>
                <LogoPicker product={p} onChange={(image) => update(p.id, { image })} />
                {/* The name is a brand — Netflix is Netflix in both languages —
                    so it is the one field that does not get a translation. */}
                <Field label="Name" value={p.name} onChange={(e) => update(p.id, { name: e.target.value })} />
                <Field label={`Short description, shown on the card${ar ? " — Arabic" : ""}`}
                  dir={ar ? "rtl" : "ltr"} value={p[noteKey] || ""}
                  placeholder={ar ? p.note : ""}
                  onChange={(e) => update(p.id, { [noteKey]: e.target.value })} />
                <Field as="textarea" rows={7} dir={ar ? "rtl" : "ltr"}
                  label={`Full description, product page${ar ? " — Arabic" : ""}`}
                  value={p[descKey] || ""} placeholder={ar ? p.description : ""}
                  onChange={(e) => update(p.id, { [descKey]: e.target.value })}
                  hint={'Blank line = new paragraph. A line starting "- " becomes a ticked bullet. "## " makes a heading.'} />
                <Field label="Warranty in days (0 hides the badge)" type="number" min="0"
                  value={p.warrantyDays ?? 30}
                  onChange={(e) => update(p.id, { warrantyDays: parseInt(e.target.value, 10) || 0 })} />

                <div>
                  <span style={labelStyle}>Category</span>
                  <div className="flex flex-wrap gap-1.5 mt-2">
                    {categories.map((c) => (
                      <button key={c} onClick={() => update(p.id, { category: c })} className="press"
                        style={{ padding: "5px 11px", borderRadius: 7, fontSize: 12,
                                 background: p.category === c ? T.tint : "transparent",
                                 color: p.category === c ? T.brandText : T.inkSoft,
                                 border: `1px solid ${p.category === c ? T.tintDeep : T.line}` }}>{c}</button>
                    ))}
                  </div>
                </div>

                <div>
                  <span style={labelStyle}>Plans, prices & offers</span>
                  <p style={{ fontSize: 11.5, color: T.inkSoft, marginTop: 5, lineHeight: 1.5 }}>
                    “Was” is the crossed-out old price. Leave it at 0 for no offer.
                  </p>
                  <div className="flex flex-col gap-2 mt-2.5">
                    {p.variants.map((v, i) => {
                      const off = discountPct(v);
                      return (
                        <div key={i} className="flex gap-2 items-center flex-wrap">
                          <input value={v.label} onChange={(e) => setVariant(p, i, { label: e.target.value })}
                            className="flex-1 min-w-0 px-3 py-2 outline-none input" style={inputStyle} />
                          <div className="flex items-center px-2 shrink-0"
                            style={{ ...inputStyle, width: 96 }} title="Price">
                            <span style={{ color: T.inkSoft, fontSize: 14 }}>$</span>
                            <input type="number" step="0.5" value={v.price}
                              onChange={(e) => setVariant(p, i, { price: parseFloat(e.target.value) || 0 })}
                              className="w-full px-1 py-2 outline-none"
                              style={{ fontFamily: ui, fontSize: 14, color: T.ink, background: "transparent" }} />
                          </div>
                          <div className="flex items-center px-2 shrink-0"
                            style={{ ...inputStyle, width: 104 }} title="Was (old price)">
                            <span style={{ color: T.inkSoft, fontSize: 11 }}>was $</span>
                            <input type="number" step="0.5" value={v.compareAt ?? 0}
                              onChange={(e) => setVariant(p, i, { compareAt: parseFloat(e.target.value) || 0 })}
                              className="w-full px-1 py-2 outline-none"
                              style={{ fontFamily: ui, fontSize: 14, color: T.ink, background: "transparent" }} />
                          </div>
                          {off > 0 && (
                            <span style={{ fontSize: 11, color: T.ok, whiteSpace: "nowrap" }}>−{off}%</span>
                          )}
                          {p.variants.length > 1 && (
                            <button onClick={() => update(p.id, { variants: p.variants.filter((_, j) => j !== i) })}
                              aria-label="Remove plan" className="press shrink-0" style={{ color: T.rose }}><X size={16} /></button>
                          )}
                        </div>
                      );
                    })}
                    <button onClick={() => update(p.id, { variants: [...p.variants, { label: "New plan", price: 0, compareAt: 0 }] })}
                      className="flex items-center gap-1.5 self-start mt-1 press"
                      style={{ fontSize: 12, color: T.brandText, letterSpacing: ".06em", textTransform: "uppercase" }}>
                      <Plus size={13} /> Add plan
                    </button>
                  </div>
                </div>

                {/* Two-tap delete — a single misclick used to wipe a product outright. */}
                {confirmId === p.id ? (
                  <div className="flex flex-wrap items-center gap-2 self-start mt-2">
                    <button onClick={() => { setCatalog(catalog.filter((x) => x.id !== p.id)); setOpenId(null); setConfirmId(null); }}
                      style={{ fontSize: 12, letterSpacing: ".06em", textTransform: "uppercase", color: "#fff",
                               background: T.brand, border: `1px solid ${T.brand}`, borderRadius: 8, padding: "7px 12px" }}>
                      Delete “{p.name}” for good
                    </button>
                    <button onClick={() => setConfirmId(null)}
                      style={{ fontSize: 12, letterSpacing: ".06em", textTransform: "uppercase", color: T.inkSoft,
                               border: `1px solid ${T.line}`, borderRadius: 8, padding: "7px 12px" }}>
                      Cancel
                    </button>
                  </div>
                ) : (
                  <button onClick={() => setConfirmId(p.id)} className="flex items-center gap-1.5 self-start mt-2 press"
                    style={{ fontSize: 12, color: T.rose, letterSpacing: ".06em", textTransform: "uppercase" }}>
                    <Trash2 size={13} /> Delete product
                  </button>
                )}
              </div>
            )}
          </div>
        ))}
      </div>
    </>
  );
}

/* ================================================================= categories */
/* Categories are stored as plain strings on each product, so renaming or
   deleting one has to rewrite the catalogue too — otherwise products keep
   pointing at a category that no longer exists and vanish from the shop.
   Edits are staged in a draft and applied together on save. */
function AdminCategories({ categories, settings, setSettings, catalog, setCatalog, lang }) {
  const ar = lang === "ar";
  const covers = settings.categoryImages || {};
  const notes = settings.categoryNotes || {};
  const notesAr = settings.categoryNotesAr || {};
  const namesAr = settings.categoryNamesAr || {};
  const [draft, setDraft] = useState(() =>
    categories.map((c) => ({
      id: c, name: c, image: covers[c] || "",
      note: notes[c] || "", nameAr: namesAr[c] || "", noteAr: notesAr[c] || "",
    })));
  const [adding, setAdding] = useState("");
  const [err, setErr] = useState("");
  const [saved, setSaved] = useState(false);

  const touch = (next) => { setDraft(next); setSaved(false); setErr(""); };
  const patch = (i, p) => touch(draft.map((d, j) => (j === i ? { ...d, ...p } : d)));
  const remove = (i) => touch(draft.filter((_, j) => j !== i));
  const move = (i, dir) => {
    const j = i + dir;
    if (j < 0 || j >= draft.length) return;
    const next = [...draft];
    [next[i], next[j]] = [next[j], next[i]];
    touch(next);
  };
  const add = () => {
    const name = adding.trim();
    if (!name) return;
    if (draft.some((d) => d.name.trim().toLowerCase() === name.toLowerCase())) {
      setErr(`“${name}” is already in the list.`);
      return;
    }
    touch([...draft, { id: null, name, image: "", note: "", nameAr: "", noteAr: "" }]);
    setAdding("");
  };

  const countIn = (category) => catalog.filter((p) => p.category === category).length;

  /* Preview of what saving would do, so a destructive edit is never a surprise. */
  const dropped = categories.filter((c) => !draft.some((d) => d.id === c));
  const orphaned = catalog.filter((p) => dropped.includes(p.category)).length;
  const landing = draft.find((d) => d.name.trim())?.name.trim();

  const save = () => {
    const cleaned = [];
    for (const d of draft) {
      const name = d.name.trim();
      if (!name) continue;
      if (cleaned.some((c) => c.name.toLowerCase() === name.toLowerCase())) continue;
      cleaned.push({
        id: d.id, name, image: d.image || "", note: (d.note || "").trim(),
        nameAr: (d.nameAr || "").trim(), noteAr: (d.noteAr || "").trim(),
      });
    }
    if (!cleaned.length) { setErr("Keep at least one category."); return; }

    const names = cleaned.map((c) => c.name);
    const renamed = {};
    cleaned.forEach((c) => { if (c.id && c.id !== c.name) renamed[c.id] = c.name; });
    const gone = categories.filter((c) => !cleaned.some((d) => d.id === c));

    setCatalog(catalog.map((p) => {
      if (renamed[p.category]) return { ...p, category: renamed[p.category] };
      if (gone.includes(p.category)) return { ...p, category: names[0] };
      return p;
    }));
    /* Rebuilt from the final names so a rename carries its cover, blurb and
       translations across, and a deleted category leaves nothing orphaned. */
    const nextImages = {}, nextNotes = {}, nextNotesAr = {}, nextNamesAr = {};
    cleaned.forEach((c) => {
      if (c.image) nextImages[c.name] = c.image;
      if (c.note) nextNotes[c.name] = c.note;
      if (c.noteAr) nextNotesAr[c.name] = c.noteAr;
      if (c.nameAr) nextNamesAr[c.name] = c.nameAr;
    });

    setSettings({
      ...settings, categories: names, categoryImages: nextImages,
      categoryNotes: nextNotes, categoryNotesAr: nextNotesAr, categoryNamesAr: nextNamesAr,
    });
    setDraft(cleaned.map((c) => ({ ...c, id: c.name })));
    setSaved(true);
  };

  return (
    <div style={{ maxWidth: 620 }}>
      <p style={{ fontSize: 13, color: T.inkSoft, marginBottom: 14, lineHeight: 1.65 }}>
        These are the categories customers browse, in this order. Click a thumbnail to set its
        cover image, and add a short line that appears under the name. Renaming one moves its
        products, cover and blurb with it.
      </p>

      <div className="flex flex-col gap-2">
        {draft.map((d, i) => (
          <div key={`${d.id ?? "new"}-${i}`} className="flex items-start gap-3 px-3 py-3" style={cardStyle}>
            <div className="flex flex-col pt-1">
              <button onClick={() => move(i, -1)} disabled={i === 0} aria-label="Move up"
                style={{ color: i === 0 ? T.line : T.inkSoft, lineHeight: 0 }}><ChevronUp size={16} /></button>
              <button onClick={() => move(i, 1)} disabled={i === draft.length - 1} aria-label="Move down"
                style={{ color: i === draft.length - 1 ? T.line : T.inkSoft, lineHeight: 0 }}><ChevronDown size={16} /></button>
            </div>
            <CoverPicker value={d.image} name={d.name} onChange={(img) => patch(i, { image: img })} />
            <div className="flex-1 min-w-0 flex flex-col gap-1.5">
              {ar ? (
                <>
                  {/* The English name stays the key products point at, so the
                      Arabic is a display name only and never re-parents them. */}
                  <input value={d.nameAr} onChange={(e) => patch(i, { nameAr: e.target.value })} dir="rtl"
                    placeholder={`Arabic name for “${d.name}”`}
                    className="w-full px-2.5 py-1.5 outline-none input" style={{ ...inputStyle, fontSize: 15 }} />
                  <input value={d.noteAr} onChange={(e) => patch(i, { noteAr: e.target.value })} dir="rtl"
                    placeholder="السطر التعريفي بالعربية"
                    className="w-full px-2.5 py-1.5 outline-none input"
                    style={{ ...inputStyle, fontSize: 13, color: T.inkSoft }} />
                </>
              ) : (
                <>
                  <input value={d.name} onChange={(e) => patch(i, { name: e.target.value })} placeholder="Category name"
                    className="w-full px-2.5 py-1.5 outline-none input" style={{ ...inputStyle, fontSize: 15 }} />
                  <input value={d.note} onChange={(e) => patch(i, { note: e.target.value })}
                    placeholder="Short line, e.g. Movies, series and live TV"
                    className="w-full px-2.5 py-1.5 outline-none input"
                    style={{ ...inputStyle, fontSize: 13, color: T.inkSoft }} />
                </>
              )}
            </div>
            <div className="flex flex-col items-end gap-2 pt-1">
              <span style={{ fontSize: 11, color: T.inkSoft, whiteSpace: "nowrap" }}>
                {d.id ? `${countIn(d.id)} product${countIn(d.id) === 1 ? "" : "s"}` : "new"}
              </span>
              <button onClick={() => remove(i)} aria-label={`Remove ${d.name}`} className="press" style={{ color: T.rose }}>
                <Trash2 size={15} />
              </button>
            </div>
          </div>
        ))}
      </div>

      <div className="flex gap-2 items-center mt-3">
        <input value={adding} onChange={(e) => { setAdding(e.target.value); setErr(""); }}
          onKeyDown={(e) => { if (e.key === "Enter") add(); }} placeholder="New category name"
          className="flex-1 px-3 py-2.5 outline-none input"
          style={{ ...inputStyle, fontSize: 15, background: T.surface }} />
        <Btn variant="ghost" onClick={add} style={{ padding: "11px 16px" }}>Add</Btn>
      </div>

      {err && <p style={{ fontSize: 12.5, color: T.brandText, marginTop: 10 }}>{err}</p>}

      {orphaned > 0 && landing && (
        <p className="px-3.5 py-3" style={{ background: T.tint, borderRadius: 10, fontSize: 12.5,
               color: T.ink, lineHeight: 1.65, marginTop: 12 }}>
          Saving moves {orphaned} product{orphaned === 1 ? "" : "s"} out of{" "}
          {dropped.map((c) => `“${c}”`).join(", ")} and into “{landing}”.
        </p>
      )}

      <Btn onClick={save} style={{ marginTop: 16 }}>{saved ? "Saved" : "Save categories"}</Btn>
    </div>
  );
}

/* ==================================================================== reviews */
/* Real reviews only. Every competitor in this niche shows testimonials, which
   is why they work — and why inventing them would be both dishonest and, once
   a customer notices, worse for trust than showing none. */
function AdminReviews({ settings, setSettings, catalog }) {
  const reviews = settings.reviews || [];
  const [draft, setDraft] = useState(reviews);
  const [saved, setSaved] = useState(false);

  const touch = (next) => { setDraft(next); setSaved(false); };
  const patch = (i, p) => touch(draft.map((r, j) => (j === i ? { ...r, ...p } : r)));
  const add = () => touch([
    { id: "r" + Date.now(), name: "", text: "", rating: 5, productId: "", date: new Date().toISOString().slice(0, 10) },
    ...draft,
  ]);

  return (
    <div style={{ maxWidth: 660 }}>
      <p style={{ fontSize: 13, color: T.inkSoft, marginBottom: 6, lineHeight: 1.65 }}>
        Reviews customers actually sent you on WhatsApp. They appear on the home page, and on the
        product page if you attach one to a product — that is also what gives a product its stars.
      </p>
      <p className="flex items-start gap-1.5 mb-4" style={{ fontSize: 12, color: T.inkSoft, lineHeight: 1.55 }}>
        <AlertTriangle size={13} className="shrink-0" style={{ marginTop: 2, color: T.rose }} />
        Only add real ones. A customer who spots an invented review stops believing the rest of the page.
      </p>

      <Btn onClick={add} style={{ marginBottom: 14, padding: "10px 16px" }}><Plus size={14} /> Add review</Btn>

      {draft.length === 0 ? (
        <EmptyState title="No reviews yet" body="Add the first one a customer sends you." />
      ) : (
        <div className="flex flex-col gap-2.5">
          {draft.map((r, i) => (
            <div key={r.id || i} className="px-3.5 py-3.5 flex flex-col gap-2.5" style={cardStyle}>
              <div className="flex flex-wrap gap-2 items-center">
                <input value={r.name} onChange={(e) => patch(i, { name: e.target.value })}
                  placeholder="Customer name" className="flex-1 min-w-0 px-2.5 py-1.5 outline-none input"
                  style={{ ...inputStyle, fontSize: 14.5 }} />
                <select value={r.rating} onChange={(e) => patch(i, { rating: Number(e.target.value) })}
                  className="px-2 py-2 outline-none" style={{ ...inputStyle, width: 92 }} aria-label="Rating">
                  {[5, 4, 3, 2, 1].map((n) => <option key={n} value={n}>{n} ★</option>)}
                </select>
                <select value={r.productId || ""} onChange={(e) => patch(i, { productId: e.target.value })}
                  className="px-2 py-2 outline-none" style={{ ...inputStyle, maxWidth: 190 }} aria-label="Product">
                  <option value="">Any product</option>
                  {catalog.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
                </select>
                <button onClick={() => touch(draft.filter((_, j) => j !== i))} aria-label="Remove review"
                  className="press" style={{ color: T.rose }}><Trash2 size={15} /></button>
              </div>
              <textarea value={r.text} onChange={(e) => patch(i, { text: e.target.value })} rows={2}
                placeholder="What they said" className="w-full px-2.5 py-2 outline-none input asmar-scroll"
                style={{ ...inputStyle, fontSize: 13.5, color: T.inkSoft, resize: "vertical" }} />
              <div className="flex items-center gap-3">
                <Stars value={r.rating} />
                <input type="date" value={r.date || ""} onChange={(e) => patch(i, { date: e.target.value })}
                  className="px-2 py-1.5 outline-none" style={{ ...inputStyle, fontSize: 12.5 }} />
              </div>
            </div>
          ))}
        </div>
      )}

      <Btn style={{ marginTop: 16 }} onClick={() => {
        /* A nameless or empty review renders as a blank card on the storefront. */
        const clean = draft.filter((r) => r.name.trim() && r.text.trim());
        setSettings({ ...settings, reviews: clean });
        setDraft(clean);
        setSaved(true);
      }}>
        {saved ? "Saved" : "Save reviews"}
      </Btn>
    </div>
  );
}

/* ====================================================================== pages */
function AdminPages({ settings, setSettings, lang }) {
  const ar = lang === "ar";
  const [draft, setDraft] = useState(() => ({ ...SEED_PAGES, ...(settings.pages || {}) }));
  const [draftAr, setDraftAr] = useState(() => ({ ...(settings.pagesAr || {}) }));
  const [saved, setSaved] = useState(false);
  const current = ar ? draftAr : draft;
  const set = (k) => (e) => {
    const next = { ...current, [k]: e.target.value };
    if (ar) setDraftAr(next); else setDraft(next);
    setSaved(false);
  };

  const fields = [
    ["about", "About us", "/page/about"],
    ["refund", "Refund & warranty", "/page/refund"],
    ["terms", "Terms of service", "/page/terms"],
    ["privacy", "Privacy policy", "/page/privacy"],
  ];

  return (
    <div className="flex flex-col gap-5" style={{ maxWidth: 680 }}>
      <p style={{ fontSize: 13, color: T.inkSoft, lineHeight: 1.65 }}>
        These four pages are linked in the footer. Payment providers ask to see a refund policy and
        terms before they approve a merchant account, so it is worth keeping them accurate.
        Blank line = new paragraph, “## ” makes a heading, “- ” makes a ticked bullet.
      </p>
      {fields.map(([k, label, path]) => (
        <div key={k}>
          <div className="flex items-baseline justify-between gap-3 mb-1.5">
            <span style={labelStyle}>{label}{ar ? " — Arabic" : ""}</span>
            <a href={U(`/page/${k}`)} style={{ fontSize: 11.5, color: T.brandText }}>{path}</a>
          </div>
          <textarea value={current[k] || ""} onChange={set(k)} rows={10} dir={ar ? "rtl" : "ltr"}
            placeholder={ar ? "Leave blank to show the English version" : ""}
            className="w-full px-3 py-2.5 outline-none input asmar-scroll"
            style={{ ...inputStyle, fontSize: 13.5, lineHeight: 1.7, resize: "vertical" }} />
        </div>
      ))}
      <Btn onClick={() => { setSettings({ ...settings, pages: draft, pagesAr: draftAr }); setSaved(true); }}>
        {saved ? "Saved" : "Save pages"}
      </Btn>
    </div>
  );
}

/* ================================================================ diagnostics */
/* Setting this shop up means three SQL files, two Edge Functions, a bootstrap
   insert and a set of secrets. When one of them is missing the symptom is
   always the same — "it doesn't work" — so this page asks the database
   directly and names the one step that is actually missing. */
function AdminDiagnostics() {
  const [checks, setChecks] = useState(null);
  const [running, setRunning] = useState(false);

  const run = async () => {
    setRunning(true);
    try { setChecks(await runDiagnostics()); }
    catch (e) { console.error(e); }
    finally { setRunning(false); }
  };

  useEffect(() => { run(); }, []);

  const ICONS = { ok: Check, warn: AlertTriangle, bad: X };
  const COLOURS = { ok: T.ok, warn: "#E8B341", bad: T.brandText };

  return (
    <>
      <p style={{ fontSize: 13.5, color: T.inkSoft, lineHeight: 1.7, marginBottom: 16, maxWidth: 620 }}>
        Every part of the setup, checked against the live database. Anything marked in red is the
        reason something is not working — fix them top to bottom.
      </p>

      <Btn variant="ghost" onClick={run} style={{ marginBottom: 16, opacity: running ? 0.6 : 1 }}>
        {running ? <Loader2 size={14} className="animate-spin" /> : <Stethoscope size={14} />}
        {running ? "Checking…" : "Run checks again"}
      </Btn>

      {!checks ? (
        <div className="skeleton" style={{ height: 240 }} />
      ) : (
        <div className="flex flex-col gap-2">
          {checks.map((c) => {
            const Icon = ICONS[c.state];
            return (
              <div key={c.name} className="flex items-start gap-3 px-4 py-3.5" style={cardStyle}>
                <span className="flex items-center justify-center shrink-0"
                  style={{ width: 26, height: 26, borderRadius: 13, marginTop: 1,
                           background: `color-mix(in srgb, ${COLOURS[c.state]} 18%, transparent)`,
                           color: COLOURS[c.state] }}>
                  <Icon size={14} />
                </span>
                <div className="min-w-0 flex-1">
                  <div style={{ fontSize: 14, fontWeight: 500 }}>{c.name}</div>
                  <div style={{ fontSize: 12.5, color: T.inkSoft, lineHeight: 1.6, marginTop: 2 }}>{c.detail}</div>
                  {c.fix && (
                    <pre className="asmar-scroll" style={{
                      marginTop: 8, padding: "9px 11px", background: T.surface2, borderRadius: 8,
                      border: `1px solid ${T.line}`, fontSize: 11.5, lineHeight: 1.65,
                      overflowX: "auto", whiteSpace: "pre", color: T.ink,
                    }}>{c.fix}</pre>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </>
  );
}

/* =================================================================== settings */
function AdminSettings({ settings, setSettings, catalog, lang }) {
  const ar = lang === "ar";
  const qKey = langField(lang, "q");
  const aKey = langField(lang, "a");
  const [draft, setDraft] = useState(() => ({
    ...settings,
    socials: { instagram: "", tiktok: "", channel: "", ...(settings.socials || {}) },
    faq: settings.faq?.length ? settings.faq : SEED_FAQ,
  }));
  const [saved, setSaved] = useState(false);
  const [seeding, setSeeding] = useState("");
  const set = (k) => (e) => { setDraft({ ...draft, [k]: e.target.value }); setSaved(false); };
  const setSocial = (k) => (e) => {
    setDraft({ ...draft, socials: { ...draft.socials, [k]: e.target.value } });
    setSaved(false);
  };
  const setFaq = (i, key, value) => {
    setDraft({ ...draft, faq: draft.faq.map((f, j) => (j === i ? { ...f, [key]: value } : f)) });
    setSaved(false);
  };

  const seed = async () => {
    setSeeding("working");
    try { await seedRemote(catalog, settings); setSeeding("done"); }
    catch (e) { console.error(e); setSeeding("failed"); }
  };

  const rule = <div style={{ height: 1, background: T.line, margin: "10px 0" }} />;
  const groupLabel = (t) => (
    <p style={{ fontSize: 11, letterSpacing: ".16em", textTransform: "uppercase", color: T.rose, marginBottom: 2 }}>{t}</p>
  );

  return (
    <div className="flex flex-col gap-4" style={{ maxWidth: 520 }}>
      {groupLabel("Contact")}
      <Field label="WhatsApp number (no + or spaces)" value={draft.whatsapp} onChange={set("whatsapp")}
        placeholder="96170123456" inputMode="numeric"
        hint="Receives every order confirmation customers send from the receipt screen." />
      <Field label="Instagram link" value={draft.socials.instagram} onChange={setSocial("instagram")}
        placeholder="https://instagram.com/…" />
      <Field label="TikTok link" value={draft.socials.tiktok} onChange={setSocial("tiktok")}
        placeholder="https://tiktok.com/@…" />

      {rule}
      {groupLabel("Home page")}
      <Field label="Headline" value={draft.heroTitle} onChange={set("heroTitle")}
        hint="Leave blank to use the built-in headline, which is translated into Arabic too." />
      <Field label="Sub-headline" value={draft.heroSub} onChange={set("heroSub")} />

      {rule}
      {groupLabel("Payment instructions")}
      <Field label="Whish instructions" value={draft.whishNote} onChange={set("whishNote")} />
      <Field label="OMT instructions" value={draft.omtNote} onChange={set("omtNote")} />
      {/* The PIN only means anything in local mode; with Supabase the login is a
          real account and this field would be misleading. */}
      {!auth.real && (
        <Field label="Admin PIN (local mode only)" value={draft.pin} onChange={set("pin")} inputMode="numeric" />
      )}

      {rule}
      {groupLabel("Questions shown on the home page")}
      <div className="flex flex-col gap-3">
        {draft.faq.map((f, i) => (
          <div key={i} className="flex gap-2 items-start px-3 py-3" style={cardStyle}>
            <div className="flex-1 min-w-0 flex flex-col gap-1.5">
              <input value={f[qKey] || ""} onChange={(e) => setFaq(i, qKey, e.target.value)} dir={ar ? "rtl" : "ltr"}
                placeholder={ar ? f.q || "السؤال بالعربية" : "Question"}
                className="w-full px-2.5 py-1.5 outline-none input" style={{ ...inputStyle, fontSize: 14.5 }} />
              <textarea value={f[aKey] || ""} onChange={(e) => setFaq(i, aKey, e.target.value)} rows={2}
                dir={ar ? "rtl" : "ltr"} placeholder={ar ? "الجواب بالعربية" : "Answer"}
                className="w-full px-2.5 py-1.5 outline-none input asmar-scroll"
                style={{ ...inputStyle, fontSize: 13, color: T.inkSoft, resize: "vertical" }} />
            </div>
            <button onClick={() => { setDraft({ ...draft, faq: draft.faq.filter((_, j) => j !== i) }); setSaved(false); }}
              aria-label="Remove question" className="press" style={{ color: T.rose }}>
              <Trash2 size={15} />
            </button>
          </div>
        ))}
        <button onClick={() => { setDraft({ ...draft, faq: [...draft.faq, { q: "", a: "" }] }); setSaved(false); }}
          className="flex items-center gap-1.5 self-start press"
          style={{ fontSize: 12, color: T.brandText, letterSpacing: ".06em", textTransform: "uppercase" }}>
          <Plus size={13} /> Add question
        </button>
      </div>

      <Btn onClick={() => {
        /* Blank rows would render as empty accordion items on the storefront.
           A row counts as written if either language is complete, so a question
           added while editing Arabic is not thrown away for having no English. */
        const filled = (q, a) => (q || "").trim() && (a || "").trim();
        const faq = draft.faq.filter((f) => filled(f.q, f.a) || filled(f.qAr, f.aAr));
        setSettings({ ...draft, faq });
        setDraft({ ...draft, faq });
        setSaved(true);
      }} style={{ marginTop: 6 }}>
        {saved ? "Saved" : "Save changes"}
      </Btn>

      {rule}
      <div>
        {groupLabel("Storage")}
        <p style={{ fontSize: 12.5, color: T.inkSoft, lineHeight: 1.65, margin: "8px 0 10px" }}>
          {auth.real
            ? "Connected to Supabase. Products, settings and orders are shared across every device and every customer."
            : "Running on this browser only. Customers do not see your products or reach your orders until Supabase keys are added."}
        </p>
        {auth.real && (
          <>
            <Btn variant="ghost" onClick={seed} style={{ opacity: seeding === "working" ? 0.6 : 1 }}>
              <CloudUpload size={14} />
              {seeding === "working" ? "Uploading…" : "Push this catalogue to the database"}
            </Btn>
            {seeding === "done" && (
              <p style={{ fontSize: 12.5, color: T.ok, marginTop: 8 }}>Uploaded. Customers now see this catalogue.</p>
            )}
            {seeding === "failed" && (
              <p style={{ fontSize: 12.5, color: T.brandText, marginTop: 8 }}>
                Upload failed — check the browser console for the reason.
              </p>
            )}
          </>
        )}
      </div>
    </div>
  );
}
