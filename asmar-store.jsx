import React, { useState, useEffect, useMemo, useRef, useCallback, Suspense, lazy } from "react";
import {
  ShoppingBag, Plus, Minus, X, Check, Trash2, Lock, Loader2, Receipt,
  Search, AlertTriangle, Sun, Moon, Zap, ShieldCheck, MessageCircle, Instagram,
  Star, ArrowRight, Home, Ticket, HelpCircle, Sparkles, Languages, ChevronDown, Clock,
  User, Wallet, Upload, LogOut, ImagePlus,
} from "lucide-react";
import {
  backend, auth, fetchCatalog, saveCatalog, fetchSettings, saveSettings,
  placeOrder as submitOrder, updateOrderStatus, startWhishPayment, fetchOrderStatus,
  fetchAccount, submitTopup, requestAccount,
} from "./src/backend.js";
import {
  T, display, script, ui, WRAP,
  I18nProvider, useT, Money, Ltr, Auto, Arrow,
  Eyebrow, SectionHead, EmptyState, Field, Btn, ProductMark, Stars, avgRating,
  PayMarks, RichText,
  money, slugify, emailOk, phoneOk, lowestPrice, discountPct, hasOffer, pick,
  readImageFile,
} from "./src/ui.jsx";
import { SEED_CATALOG, SEED_CATEGORIES, SEED_FAQ, SEED_PAGES, SEED_SETTINGS } from "./src/seed.js";
import { useDocumentMeta } from "./src/useDocumentMeta.js";
import { trackPageview, trackEvent } from "./src/analytics.js";

/* One person ever opens the admin; every customer would otherwise pay for it in
   download size. Split out so it only loads on /admin. */
const Admin = lazy(() => import("./src/admin.jsx"));

/* ---------------------------------------------------------------- routing */
/* Real paths, not hash fragments. Every page needs its own shareable URL —
   the whole funnel runs through links pasted into WhatsApp, so "send me the
   Netflix page" has to be a real link rather than a filter click.
 *
 * This used to be hash routing, which worked for sharing but not for search:
 * a crawler asked for /#/p/netflix and got the homepage, so every product and
 * category page in the shop was invisible to Google. Paths make each one a
 * document a crawler can actually index, which is the point of the prerender
 * step in scripts/prerender.mjs.
 */
const NAV_EVENT = "asmar:navigate";

const readPath = () => window.location.pathname + window.location.search || "/";

const go = (path, { replace = false } = {}) => {
  const current = window.location.pathname + window.location.search;
  if (path === current) return;
  window.history[replace ? "replaceState" : "pushState"]({}, "", path);
  window.dispatchEvent(new Event(NAV_EVENT));
};

/* Links shared before the move to paths still exist — in WhatsApp threads, in
   bookmarks, in Instagram bios. Rewrite them in place on arrival rather than
   letting them land on the homepage. */
function upgradeLegacyHash() {
  const h = window.location.hash;
  if (!h.startsWith("#/")) return;
  window.history.replaceState({}, "", h.slice(1) + window.location.search);
}

function useAppRoute() {
  const [route, setRoute] = useState(() => {
    upgradeLegacyHash();
    return readPath();
  });

  useEffect(() => {
    const sync = () => setRoute(readPath());
    window.addEventListener("popstate", sync);
    window.addEventListener(NAV_EVENT, sync);
    return () => {
      window.removeEventListener("popstate", sync);
      window.removeEventListener(NAV_EVENT, sync);
    };
  }, []);

  /* One delegated listener rather than an onClick on every anchor. The hrefs
     stay real, crawlable, right-click-copyable URLs; this just stops the
     browser doing a full document load for the ones we can render ourselves.
     Modified clicks (new tab, download, external, target=_blank) are left
     entirely alone. */
  useEffect(() => {
    const onClick = (e) => {
      if (e.defaultPrevented || e.button !== 0) return;
      if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
      const a = e.target.closest?.("a");
      if (!a || a.hasAttribute("download")) return;
      if (a.target && a.target !== "_self") return;
      const href = a.getAttribute("href");
      if (!href || href.startsWith("#") || href.startsWith("mailto:") || href.startsWith("tel:")) return;
      let url;
      try { url = new URL(a.href, window.location.href); } catch { return; }
      if (url.origin !== window.location.origin) return;
      e.preventDefault();
      go(url.pathname + url.search);
    };
    document.addEventListener("click", onClick);
    return () => document.removeEventListener("click", onClick);
  }, []);

  return route;
}

/* Set when a customer is sent to sign in from somewhere that should be resumed
   afterwards, rather than dumping them on the account page. */
const RESUME_KEY = "asmar:resume";
const pendingResume = () => {
  try { return localStorage.getItem(RESUME_KEY); } catch { return null; }
};
const takeResume = () => {
  const v = pendingResume();
  try { localStorage.removeItem(RESUME_KEY); } catch { /* private mode */ }
  return v;
};

const productHref = (p) => `/p/${slugify(p.name)}`;
/* Matched on the name slug so links are readable, with the id as a fallback so
   an older link still resolves after a rename. */
const findProduct = (catalog, key) =>
  catalog.find((p) => slugify(p.name) === key) || catalog.find((p) => p.id === key) || null;

/* ------------------------------------------------------------------ theme */
/* Dark is the default: this shop is browsed at night on a phone, and the
   product logos read better against it. The choice is remembered. */
const THEME_KEY = "asmar:theme";

function useTheme() {
  const [theme, setTheme] = useState(() => {
    try { return localStorage.getItem(THEME_KEY) || "dark"; } catch { return "dark"; }
  });
  useEffect(() => {
    document.documentElement.setAttribute("data-theme", theme);
    document.documentElement.style.colorScheme = theme;
    try { localStorage.setItem(THEME_KEY, theme); } catch { /* private mode */ }
  }, [theme]);
  return [theme, () => setTheme((t) => (t === "dark" ? "light" : "dark"))];
}

/* ----------------------------------------------------------------- reveal */
/* Sections fade up as they enter the viewport. The failsafe matters more than
   the animation: if the observer never fires, everything is shown anyway
   rather than leaving the customer on a blank page. */
function useReveal(dep) {
  useEffect(() => {
    const els = Array.from(document.querySelectorAll("[data-reveal]:not(.revealed)"));
    if (!els.length) return;
    const showAll = () => els.forEach((e) => e.classList.add("revealed"));
    if (!("IntersectionObserver" in window)) { showAll(); return; }
    const io = new IntersectionObserver((entries) => {
      entries.forEach((e) => {
        if (e.isIntersecting) { e.target.classList.add("revealed"); io.unobserve(e.target); }
      });
    }, { rootMargin: "0px 0px -6% 0px", threshold: 0.04 });
    els.forEach((e) => io.observe(e));
    const failsafe = setTimeout(showAll, 1600);
    return () => { io.disconnect(); clearTimeout(failsafe); };
  }, [dep]);
}

/* =====================================================
   CHROME
===================================================== */
function ShopHeader({ categories, activeCategory, count, onCart, onSearch, theme, toggleTheme, catLabel, signedIn }) {
  const { t, lang, toggleLang } = useT();
  const [scrolled, setScrolled] = useState(false);
  useEffect(() => {
    const sync = () => setScrolled(window.scrollY > 6);
    sync();
    window.addEventListener("scroll", sync, { passive: true });
    return () => window.removeEventListener("scroll", sync);
  }, []);

  const iconBtn = {
    height: 38, minWidth: 38, borderRadius: 10, display: "flex", alignItems: "center",
    justifyContent: "center", color: T.ink, border: "1px solid transparent", padding: "0 8px",
  };

  return (
    <header className="sticky top-0 z-40"
      style={{ background: scrolled ? "var(--bg-blur)" : "transparent",
               backdropFilter: scrolled ? "blur(14px) saturate(140%)" : "none",
               borderBottom: `1px solid ${scrolled ? T.line : "transparent"}`,
               boxShadow: scrolled ? "0 14px 34px -30px var(--shadow)" : "none",
               transition: "background .35s ease, border-color .35s ease, box-shadow .35s ease" }}>
      <div className="flex items-center gap-4 px-4 sm:px-6 py-3" style={{ maxWidth: WRAP, margin: "0 auto" }}>
        {/* The wordmark stays in Latin script in both languages — it is the
            brand's signature, not a word to be translated. */}
        <a href="/" className="shrink-0 flex items-baseline gap-2" aria-label="The Asmar Store">
          <span dir="ltr" style={{ fontFamily: script, fontSize: 32, color: T.brandText, lineHeight: 1 }}>Asmar</span>
          <span className="hidden sm:inline lbl" style={{ fontSize: 9.5, letterSpacing: ".28em",
                 textTransform: "uppercase", color: T.inkSoft }}>{t("nav.store")}</span>
        </a>

        <nav className="hidden lg:flex flex-1 min-w-0 items-center gap-6 overflow-x-auto navscroll">
          {categories.slice(0, 6).map((c) => (
            <a key={c} href={`/c/${slugify(c)}`} className="navlink lbl" data-active={activeCategory === c}
              dir="auto"
              style={{ whiteSpace: "nowrap", fontSize: 11.5, letterSpacing: ".13em", textTransform: "uppercase",
                       color: activeCategory === c ? T.ink : T.inkSoft }}>
              {catLabel(c)}
            </a>
          ))}
        </nav>

        <div className="flex items-center gap-0.5 ms-auto">
          <button onClick={onSearch} aria-label={t("nav.search")} className="press icon-btn" style={iconBtn}>
            <Search size={18} />
          </button>
          <button onClick={toggleLang} className="press icon-btn flex items-center gap-1.5"
            style={{ ...iconBtn, fontSize: 12, fontWeight: 500 }} aria-label={t("lang.switch")}>
            <Languages size={17} />
            <span className="hidden sm:inline" style={{ fontFamily: lang === "en" ? "'Tajawal', sans-serif" : ui }}>
              {t("lang.other")}
            </span>
          </button>
          <button onClick={toggleTheme} className="press icon-btn" style={iconBtn}
            aria-label={theme === "dark" ? "Light mode" : "Dark mode"}>
            {theme === "dark" ? <Sun size={18} /> : <Moon size={18} />}
          </button>
          <a href={signedIn ? "/account" : "/login"} aria-label={t("acc.account")}
            className="press icon-btn" style={{ ...iconBtn, color: signedIn ? T.brandText : T.ink }}>
            {signedIn ? <Wallet size={18} /> : <User size={18} />}
          </a>
          <a href="/admin" aria-label={t("nav.admin")} className="press icon-btn hidden sm:flex"
            style={{ ...iconBtn, color: T.inkSoft }}>
            <Lock size={16} />
          </a>
          <button onClick={onCart} aria-label={t("nav.openCart")} className="relative press icon-btn" style={iconBtn}>
            <ShoppingBag size={19} />
            {count > 0 && (
              <span className="absolute flex items-center justify-center pop"
                style={{ top: 3, insetInlineEnd: 1, minWidth: 17, height: 17, borderRadius: 9, background: T.brand,
                         color: "#fff", fontSize: 10, fontWeight: 600, padding: "0 4px",
                         border: `2px solid ${T.bg}` }}>
                {count}
              </span>
            )}
          </button>
        </div>
      </div>
    </header>
  );
}

/* Thumb-reach navigation. The desktop header is out of range on a phone, and
   nearly every customer here is on one. */
function MobileTabs({ route, count, onSearch, onCart, signedIn }) {
  const { t } = useT();
  const item = (active) => ({
    flex: 1, display: "flex", flexDirection: "column", alignItems: "center", gap: 3,
    padding: "9px 0 7px", fontSize: 9.5, letterSpacing: ".1em", textTransform: "uppercase",
    color: active ? T.brandText : T.inkSoft,
  });
  const onHome = route === "/" || route.startsWith("/c/") || route.startsWith("/p/");
  return (
    <nav className="lg:hidden fixed left-0 right-0 bottom-0 z-40 flex"
      style={{ background: "var(--bg-blur)", backdropFilter: "blur(14px) saturate(140%)",
               borderTop: `1px solid ${T.line}`, paddingBottom: "env(safe-area-inset-bottom, 0px)" }}>
      <a href="/" className="lbl" style={item(onHome)}><Home size={19} /> {t("nav.home")}</a>
      <button onClick={onSearch} className="lbl" style={item(false)}><Search size={19} /> {t("nav.search")}</button>
      {/* Signed-in customers reach their balance far more often than they track
          an order, so the tab follows whichever they are. Tracking stays in the
          footer and on the account page. */}
      {signedIn ? (
        <a href="/account" className="lbl" style={item(route === "/account" || route === "/topup")}>
          <Wallet size={19} /> {t("acc.account")}
        </a>
      ) : (
        <a href="/track" className="lbl" style={item(route === "/track")}><Ticket size={19} /> {t("nav.track")}</a>
      )}
      <button onClick={onCart} className="relative lbl" style={item(false)}>
        <span className="relative">
          <ShoppingBag size={19} />
          {count > 0 && (
            <span className="absolute flex items-center justify-center"
              style={{ top: -5, insetInlineEnd: -9, minWidth: 16, height: 16, borderRadius: 8, background: T.brand,
                       color: "#fff", fontSize: 9.5, fontWeight: 600, padding: "0 4px" }}>
              {count}
            </span>
          )}
        </span>
        {t("nav.cart")}
      </button>
    </nav>
  );
}

function SearchOverlay({ catalog, onClose, onAdd }) {
  const { t } = useT();
  const [q, setQ] = useState("");
  const inputRef = useRef(null);

  useEffect(() => {
    inputRef.current?.focus();
    const esc = (e) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", esc);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => { window.removeEventListener("keydown", esc); document.body.style.overflow = prev; };
  }, [onClose]);

  const term = q.trim().toLowerCase();
  const results = useMemo(() => {
    if (!term) return [];
    return catalog
      .filter((p) => p.active)
      .filter((p) => [p.name, p.note, p.category].some((f) => (f || "").toLowerCase().includes(term)))
      /* Name matches first — someone typing "net" wants Netflix at the top, not
         something whose description happens to mention a network. */
      .sort((a, b) => Number(b.name.toLowerCase().startsWith(term)) - Number(a.name.toLowerCase().startsWith(term)))
      .slice(0, 24);
  }, [catalog, term]);

  return (
    <div className="fade fixed inset-0 z-[60] flex flex-col" style={{ background: "var(--scrim)" }} onClick={onClose}>
      <div onClick={(e) => e.stopPropagation()} className="drop w-full asmar-scroll"
        style={{ background: T.bg, borderBottom: `1px solid ${T.line}`, maxHeight: "88vh", overflowY: "auto" }}>
        <div className="px-4 sm:px-6 py-4" style={{ maxWidth: 760, margin: "0 auto" }}>
          <div className="flex items-center gap-3 px-4 py-3"
            style={{ background: T.surface, border: `1px solid ${T.line}`, borderRadius: 12 }}>
            <Search size={18} style={{ color: T.rose }} className="shrink-0" />
            <input ref={inputRef} value={q} onChange={(e) => setQ(e.target.value)}
              placeholder={t("search.placeholder")} className="w-full outline-none"
              style={{ fontFamily: ui, fontSize: 16, background: "transparent", color: T.ink }} />
            <button onClick={onClose} aria-label={t("search.close")} className="press shrink-0" style={{ color: T.inkSoft }}>
              <X size={19} />
            </button>
          </div>

          {!term ? (
            <p className="py-10 text-center" style={{ fontSize: 14, color: T.inkSoft }}>{t("search.hint")}</p>
          ) : results.length === 0 ? (
            <div className="py-12 text-center">
              <p style={{ fontFamily: display, fontSize: 20, marginBottom: 6 }}>{t("search.none", { q: q.trim() })}</p>
              <p style={{ fontSize: 13.5, color: T.inkSoft }}>{t("search.noneBody")}</p>
            </div>
          ) : (
            <div className="flex flex-col gap-1.5 py-3">
              {results.map((p) => (
                <div key={p.id} className="row flex items-center gap-3 px-3 py-2.5"
                  style={{ borderRadius: 10, border: "1px solid transparent" }}>
                  <ProductMark src={p.image} name={p.name} size={40} />
                  <a href={productHref(p)} onClick={onClose} className="flex-1 min-w-0">
                    <Auto as="div" className="truncate" style={{ fontFamily: display, fontSize: 17, lineHeight: 1.5 }}>{p.name}</Auto>
                    <div className="truncate" style={{ fontSize: 12, color: T.inkSoft, lineHeight: 1.7 }}>
                      <Auto>{p.category}</Auto> · {t("product.from")} <Money v={lowestPrice(p)} />
                    </div>
                  </a>
                  <button onClick={() => { onAdd(p, p.variants[0]); onClose(); }} className="press shrink-0 lbl"
                    style={{ fontSize: 11.5, letterSpacing: ".1em", textTransform: "uppercase", color: "#fff",
                             background: T.brand, borderRadius: 8, padding: "8px 14px" }}>
                    {t("product.add")}
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

/* =====================================================
   HOME SECTIONS
===================================================== */
function Hero({ settings, onSearch, categoryCount, productCount }) {
  const { t } = useT();
  return (
    <section className="relative overflow-hidden">
      {/* Two soft brand-coloured glows behind the type. They drift very slowly,
          which reads as depth rather than as an animation. */}
      <div aria-hidden className="aurora a1" />
      <div aria-hidden className="aurora a2" />

      <div className="relative px-4 sm:px-6 pt-12 sm:pt-20 pb-10 sm:pb-14"
        style={{ maxWidth: WRAP, margin: "0 auto" }}>
        <div data-reveal className="inline-flex items-center gap-2 px-3 py-1.5 mb-6 lbl"
          style={{ borderRadius: 999, border: `1px solid ${T.line}`, background: T.surface,
                   fontSize: 11, letterSpacing: ".14em", textTransform: "uppercase", color: T.inkSoft }}>
          <span className="live-dot" /> {t("hero.badge")}
        </div>

        <h1 data-reveal style={{ transitionDelay: ".06s", fontFamily: display, fontWeight: 400,
                     fontSize: "clamp(38px, 8.2vw, 82px)", lineHeight: 1.06, letterSpacing: "-.02em",
                     maxWidth: "var(--hero-max)", textWrap: "balance" }}>
          {settings.heroTitle?.trim() || t("hero.title")}
        </h1>

        <p data-reveal style={{ transitionDelay: ".12s", fontSize: "clamp(15px, 3.6vw, 17.5px)",
                    lineHeight: 1.75, color: T.inkSoft, maxWidth: 560, marginTop: 22 }}>
          {settings.heroSub?.trim() || t("hero.sub")}
        </p>

        {/* The search field is the fastest path for a returning customer who
            already knows what they want, so it sits in the hero. */}
        <button data-reveal onClick={onSearch}
          className="press flex items-center gap-3 w-full mt-8 px-4 py-3.5 text-start hero-search"
          style={{ transitionDelay: ".18s", maxWidth: 470, background: T.surface,
                   border: `1px solid ${T.line}`, borderRadius: 12, color: T.inkSoft, fontSize: 15 }}>
          <Search size={18} style={{ color: T.rose }} />
          <span className="flex-1">{t("hero.searchPlaceholder")}</span>
          <span className="hidden sm:inline" style={{ fontSize: 10.5, letterSpacing: ".1em",
                 border: `1px solid ${T.line}`, borderRadius: 5, padding: "3px 7px" }}>
            /
          </span>
        </button>

        <div data-reveal className="flex flex-wrap gap-x-8 gap-y-3 mt-9" style={{ transitionDelay: ".24s" }}>
          {[[`${productCount}+`, t("hero.subscriptions")], [categoryCount, t("hero.categories")],
            ["24/7", t("hero.support")]].map(([n, l]) => (
            <div key={l}>
              <div style={{ fontFamily: display, fontSize: 26, lineHeight: 1.1 }}><Ltr>{n}</Ltr></div>
              <div className="lbl" style={{ fontSize: 10.5, letterSpacing: ".16em", textTransform: "uppercase",
                            color: T.inkSoft, marginTop: 5 }}>{l}</div>
            </div>
          ))}
        </div>

        <div data-reveal className="mt-8" style={{ transitionDelay: ".3s" }}>
          <PayMarks />
        </div>
      </div>
    </section>
  );
}

function TrustStrip() {
  const { t } = useT();
  const items = [
    [Zap, t("trust.instant"), t("trust.instantSub")],
    [ShieldCheck, t("trust.warranty"), t("trust.warrantySub")],
    [MessageCircle, t("trust.support"), t("trust.supportSub")],
    [Star, t("trust.genuine"), t("trust.genuineSub")],
  ];
  return (
    <section className="px-4 sm:px-6 pb-4" style={{ maxWidth: WRAP, margin: "0 auto" }}>
      <div data-reveal className="grid grid-cols-2 lg:grid-cols-4 gap-2.5">
        {items.map(([Icon, title, sub]) => (
          <div key={title} className="flex items-center gap-3 px-3.5 py-3"
            style={{ background: T.surface, border: `1px solid ${T.line}`, borderRadius: 12 }}>
            <span className="flex items-center justify-center shrink-0"
              style={{ width: 34, height: 34, borderRadius: 9, background: T.tint, color: T.brandText }}>
              <Icon size={16} />
            </span>
            <span className="min-w-0">
              <span className="block truncate" style={{ fontSize: 13, fontWeight: 500 }}>{title}</span>
              <span className="block truncate" style={{ fontSize: 11.5, color: T.inkSoft }}>{sub}</span>
            </span>
          </div>
        ))}
      </div>
    </section>
  );
}

/* Category card with cover artwork. Without an image it falls back to a tinted
   panel carrying the initial, so a half-finished catalogue still looks
   deliberate rather than broken. */
function CategoryCard({ name, label, cover, note, count, delay }) {
  const { t } = useT();
  return (
    <a href={`/c/${slugify(name)}`} data-reveal className="tile block relative overflow-hidden"
      style={{ transitionDelay: `${delay}s`, background: T.surface,
               border: `1px solid ${T.line}`, borderRadius: 14 }}>
      <div className="relative flex items-center justify-center"
        style={{ aspectRatio: "16 / 11", background: T.tint, overflow: "hidden" }}>
        {cover ? (
          <img src={cover} alt="" loading="lazy" className="tile-img"
            style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }} />
        ) : (
          <span dir="auto" style={{ fontFamily: display, fontSize: "clamp(34px, 10vw, 54px)", color: T.brandText,
                         opacity: 0.4, lineHeight: 1.3 }}>
            {(label || name).trim().charAt(0).toUpperCase()}
          </span>
        )}
        <span className="absolute" style={{ top: 8, insetInlineEnd: 8, fontSize: 10,
               background: "var(--chip-scrim)", color: "#fff",
               borderRadius: 999, padding: "3px 8px", backdropFilter: "blur(6px)" }}>
          {count}
        </span>
      </div>

      <div className="flex items-center gap-2 px-3 py-2.5 sm:px-3.5 sm:py-3">
        <span className="min-w-0 flex-1">
          <Auto className="block truncate"
            style={{ fontFamily: display, fontSize: "clamp(15px, 3.9vw, 18px)", lineHeight: 1.5 }}>
            {label || name}
          </Auto>
          <Auto className="block truncate" style={{ fontSize: "clamp(10.5px, 2.7vw, 12px)",
                 color: T.inkSoft, marginTop: 3, lineHeight: 1.6 }}>
            {note || t(count === 1 ? "product.option" : "product.options", { n: count })}
          </Auto>
        </span>
        <Arrow size={16} className="tile-arrow shrink-0" style={{ color: T.rose }} />
      </div>
    </a>
  );
}

function HowItWorks() {
  const { t } = useT();
  const steps = [
    [t("home.step1"), t("home.step1d")],
    [t("home.step2"), t("home.step2d")],
    [t("home.step3"), t("home.step3d")],
  ];
  return (
    <section className="px-4 sm:px-6 py-14" style={{ maxWidth: WRAP, margin: "0 auto" }}>
      <SectionHead eyebrow={t("home.howEyebrow")} title={t("home.howTitle")} />
      <div className="grid sm:grid-cols-3 gap-3">
        {steps.map(([title, body], i) => (
          <div key={title} data-reveal className="px-5 py-6" style={{ transitionDelay: `${i * 0.08}s`,
                 background: T.surface, border: `1px solid ${T.line}`, borderRadius: 14 }}>
            <div dir="ltr" style={{ fontFamily: display, fontSize: 34, color: T.brandText, lineHeight: 1, opacity: .55 }}>
              {String(i + 1).padStart(2, "0")}
            </div>
            <h3 style={{ fontFamily: display, fontSize: 20, marginTop: 14, lineHeight: 1.4 }}>{title}</h3>
            <p style={{ fontSize: 13.5, color: T.inkSoft, lineHeight: 1.75, marginTop: 8 }}>{body}</p>
          </div>
        ))}
      </div>
    </section>
  );
}

function Faq({ items }) {
  const { t, lang } = useT();
  const [open, setOpen] = useState(0);
  if (!items?.length) return null;
  return (
    <section id="faq" className="px-4 sm:px-6 py-14" style={{ maxWidth: 800, margin: "0 auto" }}>
      <SectionHead eyebrow={t("home.faqEyebrow")} title={t("home.faqTitle")} />
      <div style={{ borderTop: `1px solid ${T.line}` }}>
        {items.map((f, i) => (
          <div key={f.q + i} data-reveal style={{ borderBottom: `1px solid ${T.line}` }}>
            <button onClick={() => setOpen(open === i ? -1 : i)}
              className="w-full flex items-center justify-between gap-4 py-4 text-start" aria-expanded={open === i}>
              <Auto style={{ fontFamily: display, fontSize: "clamp(16px, 4vw, 19px)", lineHeight: 1.5 }}>
                {pick(lang, f.q, f.qAr)}
              </Auto>
              <ChevronDown size={18} className="shrink-0"
                style={{ color: T.rose, transition: "transform .3s cubic-bezier(.22,.8,.24,1)",
                         transform: open === i ? "rotate(180deg)" : "none" }} />
            </button>
            <div style={{ display: "grid", gridTemplateRows: open === i ? "1fr" : "0fr",
                          transition: "grid-template-rows .34s cubic-bezier(.22,.8,.24,1)" }}>
              <div style={{ overflow: "hidden" }}>
                <Auto as="p" style={{ fontSize: 14.5, lineHeight: 1.9, color: T.inkSoft, paddingBottom: 18, maxWidth: 640 }}>
                  {pick(lang, f.a, f.aAr)}
                </Auto>
              </div>
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}

function ReviewCard({ review, catalog }) {
  const { t } = useT();
  const product = review.productId ? catalog.find((p) => p.id === review.productId) : null;
  return (
    <div className="flex flex-col px-5 py-5 h-full"
      style={{ background: T.surface, border: `1px solid ${T.line}`, borderRadius: 14 }}>
      <Stars value={review.rating} size={14} />
      <p style={{ fontSize: 14.5, lineHeight: 1.75, color: T.ink, margin: "12px 0 16px" }}>“{review.text}”</p>
      <div className="flex items-center gap-2.5 mt-auto">
        <span className="flex items-center justify-center shrink-0"
          style={{ width: 32, height: 32, borderRadius: 16, background: T.tint, color: T.brandText,
                   fontFamily: display, fontSize: 15 }}>
          {review.name.trim().charAt(0).toUpperCase()}
        </span>
        <span className="min-w-0">
          <span className="block truncate" style={{ fontSize: 13.5, fontWeight: 500 }}>{review.name}</span>
          <span className="block truncate" style={{ fontSize: 11.5, color: T.inkSoft }}>
            {product ? product.name : t("rev.verified")}
          </span>
        </span>
      </div>
    </div>
  );
}

function Reviews({ reviews, catalog }) {
  const { t } = useT();
  if (!reviews.length) return null;
  return (
    <section className="py-14" style={{ maxWidth: WRAP, margin: "0 auto" }}>
      <div className="px-4 sm:px-6">
        <SectionHead
          eyebrow={t("home.reviewsEyebrow")} title={t("home.reviewsTitle")}
          action={
            <span className="hidden sm:flex items-center gap-2">
              <Stars value={avgRating(reviews)} size={15} />
              <span style={{ fontSize: 12.5, color: T.inkSoft }}>
                {t(reviews.length === 1 ? "rev.one" : "rev.count", { n: reviews.length })}
              </span>
            </span>
          }
        />
      </div>
      <div className="flex gap-3 overflow-x-auto navscroll px-4 sm:px-6 pb-3" data-reveal>
        {reviews.slice(0, 12).map((r, i) => (
          <div key={r.id || i} className="shrink-0" style={{ width: "min(84vw, 330px)" }}>
            <ReviewCard review={r} catalog={catalog} />
          </div>
        ))}
      </div>
    </section>
  );
}

function Footer({ settings, categories, catLabel }) {
  const { t } = useT();
  const s = settings.socials || {};
  const link = { fontSize: 13, color: T.inkSoft, lineHeight: 2.1 };
  const social = { width: 38, height: 38, borderRadius: 10, border: `1px solid ${T.line}`, color: T.ink };
  return (
    <footer className="px-4 sm:px-6 pt-14 pb-28 lg:pb-14" style={{ borderTop: `1px solid ${T.line}`, background: T.bg2 }}>
      <div style={{ maxWidth: WRAP, margin: "0 auto" }}>
        <div className="grid gap-9 sm:grid-cols-2 lg:grid-cols-4">
          <div>
            <a href="/" dir="ltr" style={{ fontFamily: script, fontSize: 32, color: T.brandText, lineHeight: 1 }}>Asmar</a>
            <p style={{ fontSize: 13.5, color: T.inkSoft, lineHeight: 1.8, marginTop: 12, maxWidth: 270 }}>
              {t("foot.tagline")}
            </p>
            <div className="flex gap-2 mt-4">
              {settings.whatsapp && (
                <a href={`https://wa.me/${settings.whatsapp}`} target="_blank" rel="noopener noreferrer"
                  aria-label="WhatsApp" className="press icon-btn flex items-center justify-center" style={social}>
                  <MessageCircle size={17} />
                </a>
              )}
              {s.instagram && (
                <a href={s.instagram} target="_blank" rel="noopener noreferrer"
                  aria-label="Instagram" className="press icon-btn flex items-center justify-center" style={social}>
                  <Instagram size={17} />
                </a>
              )}
              {s.tiktok && (
                <a href={s.tiktok} target="_blank" rel="noopener noreferrer"
                  aria-label="TikTok" className="press icon-btn flex items-center justify-center"
                  style={{ ...social, fontSize: 13, fontWeight: 600 }}>
                  TT
                </a>
              )}
            </div>
          </div>

          <div>
            <Eyebrow style={{ marginBottom: 10 }}>{t("foot.categories")}</Eyebrow>
            <nav className="flex flex-col">
              {categories.slice(0, 6).map((c) => (
                <a key={c} href={`/c/${slugify(c)}`} style={link} className="foot-link" dir="auto">
                  {catLabel(c)}
                </a>
              ))}
            </nav>
          </div>

          <div>
            <Eyebrow style={{ marginBottom: 10 }}>{t("foot.help")}</Eyebrow>
            <nav className="flex flex-col">
              <a href="/track" style={link} className="foot-link">{t("foot.track")}</a>
              <a href="/page/refund" style={link} className="foot-link">{t("page.refund")}</a>
              <a href="/page/terms" style={link} className="foot-link">{t("page.terms")}</a>
              <a href="/page/privacy" style={link} className="foot-link">{t("page.privacy")}</a>
              <a href="/page/about" style={link} className="foot-link">{t("page.about")}</a>
              {settings.whatsapp && (
                <a href={`https://wa.me/${settings.whatsapp}`} target="_blank" rel="noopener noreferrer"
                  style={link} className="foot-link">{t("foot.contact")}</a>
              )}
            </nav>
          </div>

          <div>
            <Eyebrow style={{ marginBottom: 10 }}>{t("foot.accepted")}</Eyebrow>
            <PayMarks className="mt-1" />
            <a href="/admin" style={{ ...link, display: "block", marginTop: 14 }} className="foot-link">
              {t("nav.admin")}
            </a>
          </div>
        </div>

        <div className="flex flex-wrap items-center justify-between gap-3 mt-12 pt-6"
          style={{ borderTop: `1px solid ${T.line}` }}>
          <p style={{ fontSize: 12, color: T.inkSoft }}>{t("foot.rights", { year: new Date().getFullYear() })}</p>
          {settings.whatsapp && (
            <p style={{ fontSize: 12, color: T.inkSoft }}>WhatsApp <Ltr>+{settings.whatsapp}</Ltr></p>
          )}
        </div>
      </div>
    </footer>
  );
}

/* =====================================================
   PRODUCT
===================================================== */
function PriceBlock({ variant, size = "card" }) {
  const { t } = useT();
  const off = discountPct(variant);
  const big = size === "page";
  return (
    <div>
      <div className="flex items-baseline gap-2 flex-wrap">
        <span style={{ fontFamily: display, fontSize: big ? "clamp(32px, 8vw, 44px)" : "clamp(22px, 6vw, 28px)",
                       lineHeight: 1.1 }}>
          <Money v={variant.price} />
        </span>
        {off > 0 && (
          <span style={{ fontSize: big ? 17 : 13.5, color: T.inkSoft, textDecoration: "line-through" }}>
            <Money v={variant.compareAt} />
          </span>
        )}
      </div>
      <div className="flex items-center gap-2 mt-1.5 flex-wrap">
        <Auto className="lbl" style={{ fontSize: big ? 12 : 10.5, color: T.rose,
               letterSpacing: ".1em", textTransform: "uppercase", lineHeight: 1.6 }}>
          {variant.label}
        </Auto>
        {off > 0 && (
          <span style={{ fontSize: 10.5, fontWeight: 600, color: "#fff", background: T.ok,
                         borderRadius: 999, padding: "2px 8px" }}>
            {t("product.save", { n: off })}
          </span>
        )}
      </div>
    </div>
  );
}

function ProductCard({ product, onAdd, delay, noReveal, rating, reviewCount }) {
  const { t, lang } = useT();
  const [vi, setVi] = useState(0);
  const v = product.variants?.[vi] || product.variants?.[0];
  if (!v) return null;
  const multi = product.variants.length > 1;
  const offer = hasOffer(product);

  return (
    <article {...(noReveal ? {} : { "data-reveal": true })}
      className="card flex flex-col h-full p-3 sm:p-4 relative"
      style={{ transitionDelay: `${delay}s`, background: T.surface,
               border: `1px solid ${T.line}`, borderRadius: 14 }}>
      {/* In the flow rather than absolutely positioned: "Best seller" is one
          word in English and three in Arabic, and an overlaid badge cannot
          reserve the right amount of room for both. */}
      {(product.featured || offer) && (
        <div className="flex mb-2.5">
          <span className="flex items-center gap-1 lbl"
            style={{ fontSize: 9.5, letterSpacing: ".08em", textTransform: "uppercase",
                     color: offer ? "#fff" : T.brandText, background: offer ? T.ok : T.tint,
                     borderRadius: 999, padding: "3px 9px", lineHeight: 1.7 }}>
            {offer ? t("product.offer") : <><Star size={9} fill="currentColor" /> {t("product.best")}</>}
          </span>
        </div>
      )}

      <a href={productHref(product)} className="flex items-start gap-2.5 sm:gap-3 mb-3.5">
        <ProductMark src={product.image} name={product.name} size={44} />
        <div className="min-w-0 flex-1">
          {/* Not clipped to one line: "Disney+" and "YouTube Premium" lose their
              tail to an overflow box, and a wrapped name is fine. */}
          <Auto as="h3" style={{ fontFamily: display, fontSize: "clamp(16px, 4.2vw, 19px)",
                 lineHeight: 1.35, marginBottom: 3 }}>
            {product.name}
          </Auto>
          {reviewCount > 0 ? (
            <span className="flex items-center gap-1.5">
              <Stars value={rating} size={11} />
              <span style={{ fontSize: 11, color: T.inkSoft }}>({reviewCount})</span>
            </span>
          ) : (
            <Auto as="p" style={{ fontSize: 12, color: T.inkSoft, lineHeight: 1.5,
                        display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical",
                        overflow: "hidden" }}>
              {pick(lang, product.note, product.noteAr)}
            </Auto>
          )}
        </div>
      </a>

      {multi && (
        <div className="flex flex-wrap gap-1.5 mb-3.5">
          {product.variants.map((opt, i) => (
            <button key={opt.label} onClick={() => setVi(i)} className="chip press" dir="auto"
              style={{ padding: "5px 10px", borderRadius: 7, fontSize: 11.5, unicodeBidi: "isolate",
                       background: i === vi ? T.tint : "transparent",
                       color: i === vi ? T.brandText : T.inkSoft,
                       border: `1px solid ${i === vi ? T.tintDeep : T.line}` }}>
              {opt.label}
            </button>
          ))}
        </div>
      )}

      <div className="flex items-end justify-between gap-2 mt-auto">
        <PriceBlock variant={v} />
        <button onClick={() => onAdd(product, v)} className="press shrink-0 flex items-center justify-center"
          aria-label={`${t("product.addToCart")} — ${product.name} ${v.label}`}
          style={{ background: T.brand, color: "#fff", borderRadius: 9, width: 38, height: 38 }}>
          <Plus size={18} />
        </button>
      </div>
    </article>
  );
}

function ProductPage({ product, catalog, reviews, onAdd, whatsapp, catLabel }) {
  const { t, lang } = useT();
  const [vi, setVi] = useState(0);
  useEffect(() => { setVi(0); }, [product?.id]);

  if (!product) {
    return (
      <main className="px-4 sm:px-6 py-24" style={{ maxWidth: 620, margin: "0 auto" }}>
        <EmptyState title={t("product.gone")} body={t("search.noneBody")} />
        <div className="flex justify-center"><a href="/"><Btn variant="ghost">{t("status.back")}</Btn></a></div>
      </main>
    );
  }

  const v = product.variants?.[vi] || product.variants?.[0];
  const mine = reviews.filter((r) => r.productId === product.id);
  const rating = avgRating(mine);
  const category = catLabel(product.category);
  const related = catalog
    .filter((p) => p.active && p.category === product.category && p.id !== product.id)
    .slice(0, 4);

  return (
    <main className="px-4 sm:px-6 pt-6 pb-20" style={{ maxWidth: WRAP, margin: "0 auto" }}>
      <a href={`/c/${slugify(product.category)}`} className="inline-flex items-center gap-1.5 press lbl"
        style={{ fontSize: 11.5, letterSpacing: ".14em", textTransform: "uppercase", color: T.inkSoft }}>
        <Arrow size={14} back /> {t("product.backToCategory", { category })}
      </a>

      <div className="grid lg:grid-cols-2 gap-6 lg:gap-10 mt-5">
        {/* ---- visual ---- */}
        <div data-reveal className="relative flex items-center justify-center overflow-hidden"
          style={{ background: T.surface, border: `1px solid ${T.line}`, borderRadius: 18,
                   aspectRatio: "4 / 3", maxHeight: 420 }}>
          <div aria-hidden className="aurora a2" style={{ inset: "auto", top: "-30%", opacity: .7 }} />
          <div className="relative">
            <ProductMark src={product.image} name={product.name} size={148} />
          </div>
          {product.featured && (
            <span className="absolute flex items-center gap-1 lbl"
              style={{ top: 14, insetInlineStart: 14, fontSize: 10, letterSpacing: ".1em", textTransform: "uppercase",
                       color: T.brandText, background: T.tint, borderRadius: 999, padding: "4px 10px" }}>
              <Star size={10} fill="currentColor" /> {t("product.best")}
            </span>
          )}
        </div>

        {/* ---- buy box ---- */}
        <div data-reveal style={{ transitionDelay: ".06s" }}>
          <Auto as="p" className="lbl" style={{ fontSize: 11, letterSpacing: ".2em",
                 textTransform: "uppercase", color: T.rose }}>
            {category}
          </Auto>
          <Auto as="h1" style={{ fontFamily: display, fontWeight: 400, letterSpacing: "-.015em",
                       fontSize: "clamp(30px, 7vw, 50px)", lineHeight: 1.12, marginTop: 10 }}>
            {product.name}
          </Auto>

          {mine.length > 0 && (
            <div className="flex items-center gap-2 mt-3">
              <Stars value={rating} size={15} showValue />
              <span style={{ fontSize: 12.5, color: T.inkSoft }}>
                {t(mine.length === 1 ? "rev.one" : "rev.count", { n: mine.length })}
              </span>
            </div>
          )}

          <Auto as="p" style={{ fontSize: 15, color: T.inkSoft, lineHeight: 1.7, marginTop: 12 }}>
            {pick(lang, product.note, product.noteAr)}
          </Auto>

          <div className="flex flex-wrap gap-2 mt-5">
            <span className="flex items-center gap-1.5 px-3 py-1.5"
              style={{ fontSize: 12, borderRadius: 999, background: T.surface, border: `1px solid ${T.line}` }}>
              <Zap size={13} style={{ color: T.ok }} /> {t("trust.instant")}
            </span>
            {product.warrantyDays > 0 && (
              <span className="flex items-center gap-1.5 px-3 py-1.5"
                style={{ fontSize: 12, borderRadius: 999, background: T.surface, border: `1px solid ${T.line}` }}>
                <ShieldCheck size={13} style={{ color: T.ok }} /> {t("product.warranty", { n: product.warrantyDays })}
              </span>
            )}
            <span className="flex items-center gap-1.5 px-3 py-1.5"
              style={{ fontSize: 12, borderRadius: 999, background: T.surface, border: `1px solid ${T.line}` }}>
              <Clock size={13} style={{ color: T.ok }} /> 24/7
            </span>
          </div>

          {product.variants.length > 1 && (
            <div className="mt-7">
              <span className="lbl" style={{ fontSize: 11, letterSpacing: ".14em", textTransform: "uppercase", color: T.inkSoft }}>
                {t("product.choosePlan")}
              </span>
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 mt-2.5">
                {product.variants.map((opt, i) => {
                  const off = discountPct(opt);
                  const on = i === vi;
                  return (
                    <button key={opt.label} onClick={() => setVi(i)} className="press text-start px-3 py-2.5 relative"
                      style={{ borderRadius: 10, background: on ? T.tint : T.surface,
                               border: `1px solid ${on ? T.brand : T.line}` }}>
                      <Auto className="block" style={{ fontSize: 12.5, color: T.inkSoft }}>{opt.label}</Auto>
                      <span className="block" style={{ fontFamily: display, fontSize: 19, marginTop: 2 }}>
                        <Money v={opt.price} />
                      </span>
                      {off > 0 && (
                        <span className="absolute" style={{ top: -7, insetInlineEnd: 6, fontSize: 9.5, fontWeight: 600,
                               color: "#fff", background: T.ok, borderRadius: 999, padding: "2px 7px" }}>
                          −{off}%
                        </span>
                      )}
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          <div className="flex items-end justify-between gap-4 flex-wrap mt-7 pt-6"
            style={{ borderTop: `1px solid ${T.line}` }}>
            <PriceBlock variant={v} size="page" />
            <Btn onClick={() => onAdd(product, v)} style={{ flex: "1 1 190px", padding: "15px 22px" }}>
              <ShoppingBag size={16} /> {t("product.addToCart")}
            </Btn>
          </div>

          <p className="flex items-start gap-2 mt-4" style={{ fontSize: 12.5, color: T.inkSoft, lineHeight: 1.65 }}>
            <Check size={14} className="shrink-0" style={{ color: T.ok, marginTop: 2 }} />
            {t("product.deliveryNote")}
          </p>
        </div>
      </div>

      {/* ---- description ---- */}
      {pick(lang, product.description, product.descriptionAr)?.trim() && (
        <section data-reveal className="mt-14" style={{ maxWidth: 760 }}>
          <SectionHead eyebrow={t("product.details")} title={t("product.about")} />
          <RichText text={pick(lang, product.description, product.descriptionAr)} />
        </section>
      )}

      {/* ---- reviews for this product ---- */}
      <section data-reveal className="mt-14" style={{ maxWidth: 760 }}>
        <SectionHead
          eyebrow={t("rev.title")}
          title={mine.length ? t(mine.length === 1 ? "rev.one" : "rev.count", { n: mine.length }) : t("rev.none")}
        />
        {mine.length > 0 ? (
          <div className="grid sm:grid-cols-2 gap-3">
            {mine.map((r, i) => <ReviewCard key={r.id || i} review={r} catalog={catalog} />)}
          </div>
        ) : whatsapp ? (
          <a href={`https://wa.me/${whatsapp}?text=${encodeURIComponent(`Hello, I have a question about ${product.name}`)}`}
            target="_blank" rel="noopener noreferrer">
            <Btn variant="ghost">{t("status.message")}</Btn>
          </a>
        ) : null}
      </section>

      {/* ---- related ---- */}
      {related.length > 0 && (
        <section data-reveal className="mt-16">
          <SectionHead title={t("product.related", { category })} />
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-2.5 sm:gap-4">
            {related.map((p) => (
              <ProductCard key={p.id} product={p} onAdd={onAdd} delay={0} noReveal
                rating={avgRating(reviews.filter((r) => r.productId === p.id))}
                reviewCount={reviews.filter((r) => r.productId === p.id).length} />
            ))}
          </div>
        </section>
      )}
    </main>
  );
}

/* =====================================================
   CATEGORY
===================================================== */
function CategoryHeader({ name, cover, note, count }) {
  const { t } = useT();
  return (
    <section className="px-4 sm:px-6 pt-6 pb-8" style={{ maxWidth: WRAP, margin: "0 auto" }}>
      <a href="/" className="inline-flex items-center gap-1.5 press lbl"
        style={{ fontSize: 11.5, letterSpacing: ".14em", textTransform: "uppercase", color: T.inkSoft }}>
        <Arrow size={14} back /> {t("cat.allCategories")}
      </a>

      {/* Cover art doubles as the page banner, with the title laid over it.
          Without an image there is nothing to fill the height with, so the band
          collapses to the text rather than leaving an empty slab. */}
      <div data-reveal className="relative overflow-hidden mt-4 flex items-end"
        style={{ borderRadius: 16, background: cover ? T.surface : "transparent",
                 border: cover ? `1px solid ${T.line}` : "none",
                 minHeight: cover ? "clamp(160px, 30vw, 240px)" : 0 }}>
        {cover && (
          <>
            <img src={cover} alt="" style={{ position: "absolute", inset: 0, width: "100%",
                   height: "100%", objectFit: "cover" }} />
            <div style={{ position: "absolute", inset: 0,
                   background: "linear-gradient(180deg, rgba(0,0,0,.15) 0%, rgba(0,0,0,.78) 100%)" }} />
          </>
        )}
        <div className={`relative ${cover ? "px-5 sm:px-8 py-6 sm:py-8" : "py-2"}`}>
          <p className="lbl" style={{ fontSize: 10.5, letterSpacing: ".2em", textTransform: "uppercase",
                      color: cover ? "rgba(255,255,255,.75)" : T.rose, marginBottom: 8 }}>
            {t(count === 1 ? "cat.sub" : "cat.subs", { n: count })}
          </p>
          <h1 style={{ fontFamily: display, fontWeight: 400, letterSpacing: "-.015em",
                       fontSize: "clamp(32px, 7vw, 58px)", lineHeight: 1.1,
                       color: cover ? "#fff" : T.ink }}>
            {name}
          </h1>
          {note && (
            <p style={{ fontSize: 14, lineHeight: 1.7, marginTop: 10, maxWidth: 500,
                        color: cover ? "rgba(255,255,255,.8)" : T.inkSoft }}>
              {note}
            </p>
          )}
        </div>
      </div>
    </section>
  );
}

/* Links rather than filter buttons, so each one is a real page a customer can
   be sent straight to. */
function CategoryChips({ categories, active, catLabel }) {
  const { t } = useT();
  const chip = (isOn) => ({
    whiteSpace: "nowrap", padding: "7px 15px", borderRadius: 999, fontSize: 12,
    letterSpacing: ".08em", textTransform: "uppercase",
    background: isOn ? T.brand : T.surface,
    color: isOn ? "#fff" : T.inkSoft,
    border: `1px solid ${isOn ? T.brand : T.line}`,
  });
  const list = active && !categories.includes(active) ? [...categories, active] : categories;
  return (
    <div className="flex gap-2 overflow-x-auto pb-5 navscroll">
      <a href="/" className="chip lbl" style={chip(false)}>{t("cat.all")}</a>
      {list.map((c) => (
        <a key={c} href={`/c/${slugify(c)}`} className="chip lbl" dir="auto" style={chip(active === c)}>
          {catLabel(c)}
        </a>
      ))}
    </div>
  );
}

/* =====================================================
   STANDALONE PAGES
===================================================== */
function TrackPage() {
  const { t } = useT();
  const [code, setCode] = useState("");
  return (
    <main className="px-4 sm:px-6 py-16" style={{ maxWidth: 520, margin: "0 auto" }}>
      <div data-reveal>
        <Eyebrow style={{ marginBottom: 12 }}>{t("track.eyebrow")}</Eyebrow>
        <h1 style={{ fontFamily: display, fontSize: "clamp(30px, 7vw, 46px)", lineHeight: 1.15, fontWeight: 400 }}>
          {t("track.title")}
        </h1>
        <p style={{ fontSize: 14.5, color: T.inkSoft, lineHeight: 1.75, marginTop: 12 }}>
          {t("track.body", { example: "" })}<Ltr style={{ color: T.ink, fontWeight: 500 }}>ASM-4K2-91X</Ltr>
        </p>

        <form className="flex flex-col gap-3 mt-8"
          onSubmit={(e) => {
            e.preventDefault();
            const c = code.trim().toUpperCase();
            if (c) go(`/order/${encodeURIComponent(c)}`);
          }}>
          <Field label={t("track.code")} value={code} placeholder="ASM-0000-000" dir="ltr"
            onChange={(e) => setCode(e.target.value)} autoCapitalize="characters" />
          <Btn full type="submit" style={{ opacity: code.trim() ? 1 : 0.5 }}>{t("track.check")}</Btn>
        </form>

        <div className="flex items-start gap-2.5 mt-8 px-4 py-3.5"
          style={{ background: T.surface, border: `1px solid ${T.line}`, borderRadius: 12 }}>
          <HelpCircle size={16} className="shrink-0" style={{ color: T.rose, marginTop: 1 }} />
          <p style={{ fontSize: 13, color: T.inkSoft, lineHeight: 1.7 }}>{t("track.lost")}</p>
        </div>
      </div>
    </main>
  );
}

function PolicyPage({ pageKey, settings }) {
  const { t, lang } = useT();
  const body = pick(
    lang,
    (settings.pages || {})[pageKey] ?? SEED_PAGES[pageKey],
    (settings.pagesAr || {})[pageKey],
  );
  return (
    <main className="px-4 sm:px-6 py-14" style={{ maxWidth: 720, margin: "0 auto" }}>
      <div data-reveal>
        <a href="/" className="inline-flex items-center gap-1.5 press lbl mb-6"
          style={{ fontSize: 11.5, letterSpacing: ".14em", textTransform: "uppercase", color: T.inkSoft }}>
          <Arrow size={14} back /> {t("status.back")}
        </a>
        <h1 style={{ fontFamily: display, fontSize: "clamp(30px, 7vw, 48px)", lineHeight: 1.15,
                     fontWeight: 400, marginBottom: 24 }}>
          {t(`page.${pageKey}`)}
        </h1>
        {body?.trim()
          ? <RichText text={body} />
          : <p style={{ fontSize: 14.5, color: T.inkSoft }}>{t("page.empty")}</p>}
      </div>
    </main>
  );
}

/* =====================================================
   ACCOUNTS — login, balance, top-up
===================================================== */
/* Signing in and asking for an account are the same page, two tabs.
 *
 * They were two pages, and that put a navigation between a customer and the
 * thing they were trying to do: someone who does not have an account yet has to
 * discover that they are on the wrong page, find the link, and load another one.
 * Someone who does have an account and lands on the request form has the same
 * problem in reverse. A tab is one tap and the answer is visible before it is
 * needed.
 *
 * The tab is driven by the route rather than by internal state, so /login and
 * /request stay real, shareable, back-button-able URLs. */
function AccountAccessPage({ mode = "signin", whatsapp, onDone }) {
  const { t } = useT();
  const tab = (key, label) => {
    const on = mode === key;
    return (
      <a
        key={key}
        href={key === "signin" ? "/login" : "/request"}
        className="press lbl flex-1 text-center"
        aria-current={on ? "page" : undefined}
        style={{
          padding: "10px 8px", fontSize: 11.5, letterSpacing: ".12em",
          textTransform: "uppercase", borderRadius: 9,
          background: on ? T.surface : "transparent",
          color: on ? T.ink : T.inkSoft,
          border: `1px solid ${on ? T.line : "transparent"}`,
          boxShadow: on ? "0 6px 18px -14px var(--shadow)" : "none",
        }}
      >
        {label}
      </a>
    );
  };

  return (
    <main className="px-4 sm:px-6 py-12" style={{ maxWidth: 460, margin: "0 auto" }}>
      <div data-reveal>
        <Eyebrow style={{ marginBottom: 12 }}>{t("acc.account")}</Eyebrow>

        <div className="flex gap-1 p-1 mb-7"
          style={{ background: T.surface2, border: `1px solid ${T.line}`, borderRadius: 12 }}>
          {tab("signin", t("acc.signIn"))}
          {tab("request", t("req.cta"))}
        </div>

        {/* onDone is the sign-in's "you are through, go somewhere" callback.
            The request form deliberately does not get it: a request does not
            sign anyone in, and it has its own confirmation to show. */}
        {mode === "request"
          ? <RequestAccountForm whatsapp={whatsapp} />
          : <SignInForm whatsapp={whatsapp} onDone={onDone} />}
      </div>
    </main>
  );
}

function SignInForm({ whatsapp, onDone }) {
  const { t } = useT();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);

  const submit = async (e) => {
    e?.preventDefault();
    if (busy) return;
    setBusy(true); setErr("");
    try {
      /* Read before signing in, not after. Signing in fires an auth-change
         event, and the effect listening for it consumes the resume marker —
         synchronously in local mode. Checking afterwards therefore sometimes
         saw nothing waiting and sent the customer to the wrong page, and which
         way it went depended on event timing. */
      const hadResume = Boolean(pendingResume());
      await auth.signIn(email.trim(), password);
      /* One sign-in for everyone. Whether this person runs the shop or buys
         from it is the database's answer, not a second form and not a choice
         the customer makes — asking someone to pick "am I staff?" is both a
         worse experience and a thing worth lying about. The check is
         server-side, so a wrong answer is not available. */
      const isAdmin = await auth.isAdmin().catch(() => false);
      onDone?.(isAdmin, hadResume);
    } catch (ex) {
      setErr(ex?.message || t("acc.wrong"));
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <h1 style={{ fontFamily: display, fontSize: "clamp(26px, 6vw, 38px)", lineHeight: 1.15, fontWeight: 400 }}>
        {t("acc.loginTitle")}
      </h1>
      <p style={{ fontSize: 14.5, color: T.inkSoft, lineHeight: 1.75, marginTop: 12 }}>
        {t("acc.loginBody")}
      </p>

      <form className="flex flex-col gap-3 mt-7" onSubmit={submit}>
        <Field label={t("acc.email")} type="email" value={email} dir="ltr" autoComplete="username"
          onChange={(e) => { setEmail(e.target.value); setErr(""); }} />
        <Field label={t("acc.password")} type="password" value={password} dir="ltr" autoComplete="current-password"
          onChange={(e) => { setPassword(e.target.value); setErr(""); }} />
        {err && (
          <p className="flex items-start gap-1.5" style={{ fontSize: 12.5, color: T.brandText }}>
            <AlertTriangle size={14} className="shrink-0" style={{ marginTop: 1 }} /> {err}
          </p>
        )}
        <Btn full type="submit" style={{ opacity: busy ? 0.6 : 1 }}>
          {busy ? t("acc.signingIn") : t("acc.signIn")}
        </Btn>
      </form>

      {/* WhatsApp stays as the fallback for anyone who would rather just talk to
          a person than fill in a form. */}
      {whatsapp && (
        <div className="mt-8 pt-6 text-center" style={{ borderTop: `1px solid ${T.line}` }}>
          <p style={{ fontSize: 13.5, color: T.inkSoft, marginBottom: 12 }}>{t("acc.noAccount")}</p>
          <a href={`https://wa.me/${whatsapp}?text=${encodeURIComponent(t("acc.askMessage"))}`}
            target="_blank" rel="noopener noreferrer">
            <Btn variant="ghost" full><MessageCircle size={15} /> {t("acc.askForOne")}</Btn>
          </a>
        </div>
      )}
    </>
  );
}

/* Customers still do not sign themselves up — Ali creates every login. This
   form only replaces the WhatsApp round-trip where he asks for name, email and
   phone one message at a time, and it means a customer at 2am is a request
   waiting in the morning rather than a sale lost to a slow reply. */
function RequestAccountForm({ whatsapp }) {
  const { t } = useT();
  const [form, setForm] = useState({ name: "", email: "", phone: "", password: "", confirm: "" });
  const [touched, setTouched] = useState({});
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(null);

  const set = (k) => (e) => { setForm({ ...form, [k]: e.target.value }); setErr(""); };
  const blur = (k) => () => setTouched((x) => ({ ...x, [k]: true }));

  /* Checked here so a mistake is caught before the round-trip, and again in
     request_account() because anything a stranger can call has to validate on
     the server too. */
  const problems = {
    name: form.name.trim() ? "" : t("req.errName"),
    email: emailOk(form.email) ? "" : t("req.errEmail"),
    phone: phoneOk(form.phone) ? "" : t("req.errPhone"),
    password: form.password.length >= 6 ? "" : t("req.errPassword"),
    confirm: form.password === form.confirm ? "" : t("req.errConfirm"),
  };
  const valid = !Object.values(problems).some(Boolean);
  const errorFor = (k) => (touched[k] ? problems[k] : "");

  const submit = async (e) => {
    e?.preventDefault();
    if (!valid) return setTouched({ name: true, email: true, phone: true, password: true, confirm: true });
    if (busy) return;
    setBusy(true); setErr("");
    try {
      const res = await requestAccount(form);
      setSent(res?.email || form.email.trim().toLowerCase());
      trackEvent("Account requested");
    } catch (ex) {
      setErr(ex?.message || "Could not send that. Please try again.");
    } finally {
      setBusy(false);
    }
  };

  if (sent) {
    const msg = t("req.tellUsMessage", { email: sent });
    return (
      <div className="text-center py-6">
        <div className="flex items-center justify-center pop mx-auto"
          style={{ width: 52, height: 52, borderRadius: 26, background: T.tint, marginBottom: 18 }}>
          <Check size={24} style={{ color: T.ok }} />
        </div>
        <h1 style={{ fontFamily: display, fontSize: "clamp(24px, 6vw, 34px)", lineHeight: 1.3 }}>{t("req.sent")}</h1>
        <p style={{ fontSize: 14.5, color: T.inkSoft, lineHeight: 1.75, marginTop: 12 }}>
          {t("req.sentBody", { email: sent })}
        </p>
        <div className="flex flex-col gap-2.5 mt-8">
          {whatsapp && (
            <a href={`https://wa.me/${whatsapp}?text=${encodeURIComponent(msg)}`}
              target="_blank" rel="noopener noreferrer">
              <Btn full variant="dark"><MessageCircle size={15} /> {t("req.tellUs")}</Btn>
            </a>
          )}
          <a href="/login"><Btn full variant="ghost">{t("req.backToSignIn")}</Btn></a>
        </div>
      </div>
    );
  }

  return (
    <>
        <h1 style={{ fontFamily: display, fontSize: "clamp(26px, 6vw, 38px)", lineHeight: 1.15, fontWeight: 400 }}>
          {t("req.title")}
        </h1>
        <p style={{ fontSize: 14.5, color: T.inkSoft, lineHeight: 1.75, marginTop: 12 }}>{t("req.body")}</p>

        <form className="flex flex-col gap-3 mt-7" onSubmit={submit}>
          <Field label={t("req.name")} value={form.name} onChange={set("name")} onBlur={blur("name")}
            error={errorFor("name")} placeholder={t("req.namePlaceholder")} autoComplete="name" />
          <Field label={t("req.email")} type="email" value={form.email} onChange={set("email")} onBlur={blur("email")}
            error={errorFor("email")} hint={t("req.emailHint")} placeholder="you@email.com"
            dir="ltr" autoComplete="email" />
          <Field label={t("req.phone")} value={form.phone} onChange={set("phone")} onBlur={blur("phone")}
            error={errorFor("phone")} placeholder="+961 70 000 000" inputMode="tel" dir="ltr" autoComplete="tel" />
          <Field label={t("req.password")} type="password" value={form.password} onChange={set("password")}
            onBlur={blur("password")} error={errorFor("password")} hint={t("req.passwordHint")}
            dir="ltr" autoComplete="new-password" />
          <Field label={t("req.confirm")} type="password" value={form.confirm} onChange={set("confirm")}
            onBlur={blur("confirm")} error={errorFor("confirm")} dir="ltr" autoComplete="new-password" />

          {err && (
            <p className="flex items-start gap-1.5" style={{ fontSize: 12.5, color: T.brandText }}>
              <AlertTriangle size={14} className="shrink-0" style={{ marginTop: 1 }} /> {err}
            </p>
          )}

          <Btn full type="submit" style={{ opacity: busy ? 0.6 : 1 }}>
            {busy ? t("req.sending") : t("req.submit")}
          </Btn>
        </form>

        {whatsapp && (
          <div className="mt-8 pt-6 text-center" style={{ borderTop: `1px solid ${T.line}` }}>
            <p style={{ fontSize: 13.5, color: T.inkSoft, marginBottom: 12 }}>{t("acc.noAccount")}</p>
            <a href={`https://wa.me/${whatsapp}?text=${encodeURIComponent(t("acc.askMessage"))}`}
              target="_blank" rel="noopener noreferrer">
              <Btn variant="ghost" full><MessageCircle size={15} /> {t("acc.askForOne")}</Btn>
            </a>
          </div>
        )}
    </>
  );
}

const walletKindKey = { topup: "wal.topup", order: "wal.order", refund: "wal.refund", adjustment: "wal.adjustment" };
const topupStatusKey = { pending: "wal.pending", approved: "wal.approved", rejected: "wal.rejected" };

function AccountPage({ account, loading, whatsapp, onSignOut }) {
  const { t, lang } = useT();
  if (loading || !account) {
    return (
      <main className="px-4 sm:px-6 py-16" style={{ maxWidth: 720, margin: "0 auto" }}>
        <div className="skeleton" style={{ height: 130, marginBottom: 16 }} />
        <div className="skeleton" style={{ height: 200 }} />
      </main>
    );
  }

  const { profile, balance, entries, topups, orders } = account;
  const name = profile?.name?.trim() || profile?.email || "";
  const dateOf = (s) => new Date(s).toLocaleDateString(lang === "ar" ? "ar-LB" : "en-GB");

  const chip = (status) => ({
    fontSize: 10.5, letterSpacing: ".06em", borderRadius: 999, padding: "3px 9px", whiteSpace: "nowrap",
    background: status === "approved" ? T.ok : status === "rejected" ? T.line : T.tint,
    color: status === "approved" ? "#fff" : status === "rejected" ? T.inkSoft : T.brandText,
  });

  return (
    <main className="px-4 sm:px-6 py-10" style={{ maxWidth: 720, margin: "0 auto" }}>
      {!auth.real && (
        <p className="flex items-start gap-2 px-4 py-3 mb-6"
          style={{ background: T.tint, borderRadius: 10, fontSize: 12.5, color: T.ink, lineHeight: 1.6 }}>
          <AlertTriangle size={14} className="shrink-0" style={{ marginTop: 2, color: T.brandText }} />
          {t("acc.localWarning")}
        </p>
      )}

      <div data-reveal className="flex items-start justify-between gap-4 mb-6">
        <div className="min-w-0">
          <Eyebrow style={{ marginBottom: 8 }}>{t("acc.account")}</Eyebrow>
          <Auto as="h1" className="truncate"
            style={{ fontFamily: display, fontSize: "clamp(24px, 6vw, 36px)", lineHeight: 1.3, fontWeight: 400 }}>
            {t("acc.hello", { name })}
          </Auto>
        </div>
        <button onClick={onSignOut} className="press flex items-center gap-1.5 shrink-0 px-3 py-2 lbl"
          style={{ fontSize: 11.5, letterSpacing: ".08em", textTransform: "uppercase", color: T.inkSoft,
                   border: `1px solid ${T.line}`, borderRadius: 8 }}>
          <LogOut size={14} /> {t("acc.signOut")}
        </button>
      </div>

      {/* ---- the balance ---- */}
      <div data-reveal className="relative overflow-hidden px-6 py-7 mb-4"
        style={{ background: T.surface, border: `1px solid ${T.line}`, borderRadius: 16 }}>
        <div aria-hidden className="aurora a2" style={{ top: "-60%", opacity: .7 }} />
        <div className="relative flex flex-wrap items-end justify-between gap-4">
          <div>
            <p className="lbl" style={{ fontSize: 11, letterSpacing: ".2em", textTransform: "uppercase", color: T.rose }}>
              {t("acc.balance")}
            </p>
            <p style={{ fontFamily: display, fontSize: "clamp(38px, 10vw, 54px)", lineHeight: 1.1, marginTop: 8 }}>
              <Money v={balance} />
            </p>
          </div>
          <a href="/topup"><Btn><Plus size={15} /> {t("acc.addFunds")}</Btn></a>
        </div>
      </div>

      {/* ---- top-up requests ---- */}
      {topups.length > 0 && (
        <section data-reveal className="mb-4">
          <SectionHead title={t("acc.topupsTitle")} />
          <div className="flex flex-col gap-2">
            {topups.map((tp) => (
              <div key={tp.id} className="flex items-center gap-3 px-4 py-3"
                style={{ background: T.surface, border: `1px solid ${T.line}`, borderRadius: 12 }}>
                <span className="flex items-center justify-center shrink-0"
                  style={{ width: 34, height: 34, borderRadius: 9, background: T.tint, color: T.brandText }}>
                  <Upload size={15} />
                </span>
                <div className="flex-1 min-w-0">
                  <div style={{ fontSize: 14, fontWeight: 500 }}><Money v={tp.amount} /></div>
                  <Ltr style={{ fontSize: 11.5, color: T.inkSoft }}>{tp.ref}</Ltr>
                  <span style={{ fontSize: 11.5, color: T.inkSoft }}> · {dateOf(tp.created_at)}</span>
                  {tp.admin_note && (
                    <Auto as="div" style={{ fontSize: 11.5, color: T.inkSoft, marginTop: 2 }}>{tp.admin_note}</Auto>
                  )}
                </div>
                <span className="lbl" style={chip(tp.status)}>{t(topupStatusKey[tp.status])}</span>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* ---- ledger ---- */}
      <section data-reveal className="mb-4">
        <SectionHead title={t("acc.history")} />
        {entries.length === 0 ? (
          <p style={{ fontSize: 14, color: T.inkSoft }}>{t("acc.noHistory")}</p>
        ) : (
          <div style={{ background: T.surface, border: `1px solid ${T.line}`, borderRadius: 12 }}>
            {entries.map((e, i) => (
              <div key={e.id || i} className="flex items-center justify-between gap-3 px-4 py-3"
                style={{ borderTop: i ? `1px solid ${T.line}` : "none" }}>
                <div className="min-w-0">
                  <div style={{ fontSize: 13.5 }}>{t(walletKindKey[e.kind] || "wal.adjustment")}</div>
                  <div style={{ fontSize: 11.5, color: T.inkSoft }}>
                    {dateOf(e.created_at)}{e.ref ? <> · <Ltr>{e.ref}</Ltr></> : null}
                  </div>
                </div>
                <div style={{ fontFamily: display, fontSize: 17,
                              color: Number(e.amount) >= 0 ? T.ok : T.ink }}>
                  <Ltr>{Number(e.amount) >= 0 ? "+" : "−"}{money(Math.abs(Number(e.amount)))}</Ltr>
                </div>
              </div>
            ))}
          </div>
        )}
      </section>

      {/* ---- orders ---- */}
      <section data-reveal>
        <SectionHead title={t("acc.myOrders")} />
        {orders.length === 0 ? (
          <p style={{ fontSize: 14, color: T.inkSoft }}>{t("acc.noOrders")}</p>
        ) : (
          <div className="flex flex-col gap-2">
            {orders.map((o) => (
              <a key={o.code} href={`/order/${encodeURIComponent(o.code)}`}
                className="row flex items-center justify-between gap-3 px-4 py-3"
                style={{ background: T.surface, border: `1px solid ${T.line}`, borderRadius: 12 }}>
                <div className="min-w-0">
                  <Ltr style={{ fontSize: 13, fontWeight: 500 }}>{o.code}</Ltr>
                  <Auto as="div" className="truncate" style={{ fontSize: 11.5, color: T.inkSoft }}>
                    {(o.items || []).map((i) => `${i.name} ${i.label}`).join(" · ")}
                  </Auto>
                </div>
                <div className="text-end shrink-0">
                  <div style={{ fontFamily: display, fontSize: 16 }}><Money v={o.total} /></div>
                  <div style={{ fontSize: 11, color: T.inkSoft }}>{o.status}</div>
                </div>
              </a>
            ))}
          </div>
        )}
      </section>

      {whatsapp && (
        <a href={`https://wa.me/${whatsapp}`} target="_blank" rel="noopener noreferrer"
          className="block mt-8">
          <Btn variant="ghost" full><MessageCircle size={15} /> {t("status.message")}</Btn>
        </a>
      )}
    </main>
  );
}

/* Receipts are photographs, so they arrive at 3–5 MB. Downscaling in the
   browser keeps the request small and the database usable. */
const MAX_RECEIPT_PX = 1000;

function TopUpPage({ settings, account, onDone }) {
  const { t } = useT();
  /* The database refuses a sixth pending request. Saying so before the upload
     round-trip beats letting them re-photograph a receipt for nothing, and it
     says it in their own language — the server's exception is English only. */
  const pendingCount = (account?.topups || []).filter((tp) => tp.status === "pending").length;
  const tooMany = pendingCount >= 5;
  const [amount, setAmount] = useState("");
  const [method, setMethod] = useState("whish");
  const [receipt, setReceipt] = useState("");
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  const [reading, setReading] = useState(false);
  const [done, setDone] = useState(null);
  const fileRef = useRef(null);

  const pick = async (e) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    setReading(true); setErr("");
    try {
      setReceipt(await readImageFile(file, MAX_RECEIPT_PX, 0.72));
    } catch (ex) {
      setErr(ex.message);
    } finally {
      setReading(false);
    }
  };

  const submit = async () => {
    if (tooMany) return setErr(t("top.tooMany"));
    const value = parseFloat(amount);
    if (!value || value <= 0) return setErr(t("top.needAmount"));
    if (!receipt) return setErr(t("top.needImage"));
    if (busy) return;
    setBusy(true); setErr("");
    try {
      const row = await submitTopup({ amount: value, method, receipt });
      setDone({ ref: row.ref, amount: value });
      onDone();
    } catch (ex) {
      setErr(ex?.message || "Could not send that. Please try again.");
    } finally {
      setBusy(false);
    }
  };

  if (done) {
    const msg = t("top.tellUsMessage", { amount: money(done.amount), ref: done.ref });
    return (
      <main className="px-4 sm:px-6 py-20 text-center" style={{ maxWidth: 460, margin: "0 auto" }}>
        <div className="flex items-center justify-center pop mx-auto"
          style={{ width: 52, height: 52, borderRadius: 26, background: T.tint, marginBottom: 18 }}>
          <Check size={24} style={{ color: T.ok }} />
        </div>
        <h1 style={{ fontFamily: display, fontSize: "clamp(24px, 6vw, 34px)", lineHeight: 1.3 }}>{t("top.sent")}</h1>
        <p style={{ fontSize: 14.5, color: T.inkSoft, lineHeight: 1.75, marginTop: 12 }}>
          {t("top.sentBody", { ref: done.ref, amount: money(done.amount) })}
        </p>
        <div className="flex flex-col gap-2.5 mt-8">
          {/* The owner reads WhatsApp far more often than he opens the admin,
              so this is the message that actually reaches him. */}
          {settings.whatsapp && (
            <a href={`https://wa.me/${settings.whatsapp}?text=${encodeURIComponent(msg)}`}
              target="_blank" rel="noopener noreferrer">
              <Btn full variant="dark"><MessageCircle size={15} /> {t("top.tellUs")}</Btn>
            </a>
          )}
          <a href="/account"><Btn full variant="ghost">{t("top.backToAccount")}</Btn></a>
        </div>
      </main>
    );
  }

  const methods = [
    { k: "whish", label: "Whish Money", note: settings.whishNote },
    { k: "omt", label: "OMT", note: settings.omtNote },
  ];

  return (
    <main className="px-4 sm:px-6 py-12" style={{ maxWidth: 520, margin: "0 auto" }}>
      <div data-reveal>
        <a href="/account" className="inline-flex items-center gap-1.5 press lbl mb-5"
          style={{ fontSize: 11.5, letterSpacing: ".14em", textTransform: "uppercase", color: T.inkSoft }}>
          <Arrow size={14} back /> {t("top.backToAccount")}
        </a>
        <h1 style={{ fontFamily: display, fontSize: "clamp(28px, 6.5vw, 42px)", lineHeight: 1.2, fontWeight: 400 }}>
          {t("top.title")}
        </h1>
        <p style={{ fontSize: 14.5, color: T.inkSoft, lineHeight: 1.75, marginTop: 12 }}>{t("top.body")}</p>

        {/* ---- 1. where to send ---- */}
        <div className="mt-8">
          <span className="lbl" style={{ fontSize: 11, letterSpacing: ".14em", textTransform: "uppercase", color: T.inkSoft }}>
            {t("top.method")}
          </span>
          <div className="grid grid-cols-2 gap-2 mt-2">
            {methods.map((m) => (
              <button key={m.k} onClick={() => setMethod(m.k)} className="text-start px-3.5 py-3 press"
                style={{ borderRadius: 10, background: method === m.k ? T.tint : T.surface,
                         border: `1px solid ${method === m.k ? T.brand : T.line}` }}>
                <div style={{ fontSize: 14, fontWeight: 500 }}>{m.label}</div>
              </button>
            ))}
          </div>
          <p className="px-3.5 py-3 mt-2" style={{ background: T.surface2, borderRadius: 10,
                 fontSize: 12.5, color: T.ink, lineHeight: 1.7, border: `1px solid ${T.line}` }}>
            <Ltr>{methods.find((m) => m.k === method)?.note}</Ltr>
          </p>
        </div>

        {/* ---- 2. how much ---- */}
        <div className="mt-6">
          <Field label={t("top.amount")} type="number" step="0.5" min="0" inputMode="decimal" dir="ltr"
            value={amount} placeholder="10" onChange={(e) => { setAmount(e.target.value); setErr(""); }} />
        </div>

        {/* ---- 3. the proof ---- */}
        <div className="mt-6">
          <span className="lbl" style={{ fontSize: 11, letterSpacing: ".14em", textTransform: "uppercase", color: T.inkSoft }}>
            {t("top.receipt")}
          </span>
          <div className="mt-2">
            {receipt ? (
              <div className="relative overflow-hidden"
                style={{ borderRadius: 12, border: `1px solid ${T.line}`, background: T.surface }}>
                <img src={receipt} alt="" style={{ width: "100%", maxHeight: 300, objectFit: "contain", display: "block" }} />
                <button onClick={() => fileRef.current?.click()} className="press w-full py-2.5 lbl"
                  style={{ fontSize: 12, letterSpacing: ".08em", textTransform: "uppercase",
                           color: T.brandText, borderTop: `1px solid ${T.line}` }}>
                  {t("top.replace")}
                </button>
              </div>
            ) : (
              <button onClick={() => fileRef.current?.click()} disabled={reading}
                className="press w-full flex flex-col items-center justify-center gap-2 py-10"
                style={{ borderRadius: 12, border: `1px dashed ${T.line}`, background: T.surface, color: T.inkSoft }}>
                {reading
                  ? <Loader2 size={22} className="animate-spin" style={{ color: T.brandText }} />
                  : <ImagePlus size={22} style={{ color: T.rose }} />}
                <span style={{ fontSize: 13.5 }}>{t("top.choose")}</span>
              </button>
            )}
            {/* capture="environment" puts the camera first on a phone, which is
                where most of these screenshots and photos come from. */}
            <input ref={fileRef} type="file" accept="image/*" onChange={pick} style={{ display: "none" }} />
          </div>
        </div>

        {err && (
          <p className="flex items-start gap-1.5 mt-4" style={{ fontSize: 12.5, color: T.brandText }}>
            <AlertTriangle size={14} className="shrink-0" style={{ marginTop: 1 }} /> {err}
          </p>
        )}

        <Btn full onClick={submit} style={{ marginTop: 20, opacity: busy || tooMany ? 0.6 : 1 }}>
          {busy ? t("top.submitting") : t("top.submit")}
        </Btn>
      </div>
    </main>
  );
}

function OrderStatusPage({ code, whatsapp }) {
  const { t } = useT();
  const [state, setState] = useState({ loading: true, order: null });

  /* The redirect can beat the server-to-server callback, so poll briefly rather
     than telling someone their payment failed when it is in flight. */
  useEffect(() => {
    let alive = true, tries = 0;
    const check = async () => {
      try {
        const order = await fetchOrderStatus(code);
        if (!alive) return;
        setState({ loading: false, order });
        if (order?.paymentStatus === "pending" && tries++ < 10) setTimeout(check, 2000);
      } catch (e) {
        console.error(e);
        if (alive) setState({ loading: false, order: null });
      }
    };
    check();
    return () => { alive = false; };
  }, [code]);

  const { loading, order } = state;
  const paid = order?.paymentStatus === "paid";
  const pending = order?.paymentStatus === "pending";

  return (
    <div className="min-h-screen flex flex-col items-center justify-center px-6 py-16 text-center"
      style={{ background: T.bg, fontFamily: ui, color: T.ink }}>
      <a href="/" dir="ltr" style={{ fontFamily: script, fontSize: 34, color: T.brandText, marginBottom: 26 }}>Asmar</a>

      {loading ? (
        <Loader2 className="animate-spin" size={22} style={{ color: T.brandText }} />
      ) : !order ? (
        <>
          <p style={{ fontFamily: display, fontSize: 26, marginBottom: 8 }}>{t("status.notFound")}</p>
          <p style={{ fontSize: 14, color: T.inkSoft, maxWidth: 340, lineHeight: 1.7 }}>{t("status.notFoundBody")}</p>
        </>
      ) : (
        <>
          <div className="flex items-center justify-center pop"
            style={{ width: 52, height: 52, borderRadius: 26, marginBottom: 18, background: T.tint }}>
            {paid ? <Check size={24} style={{ color: T.ok }} />
                  : pending ? <Loader2 size={22} className="animate-spin" style={{ color: T.brandText }} />
                  : <AlertTriangle size={22} style={{ color: T.brandText }} />}
          </div>
          <p style={{ fontFamily: display, fontSize: "clamp(24px, 6vw, 32px)", marginBottom: 8 }}>
            {paid ? t("status.paid") : pending ? t("status.pending") : t("status.failed")}
          </p>
          <Ltr style={{ fontSize: 11, letterSpacing: ".22em", textTransform: "uppercase", color: T.inkSoft }}>
            {order.code}
          </Ltr>
          <p style={{ fontSize: 14.5, color: T.inkSoft, lineHeight: 1.75, marginTop: 16, maxWidth: 400 }}>
            {paid ? t("status.paidBody") : pending ? t("status.pendingBody") : t("status.failedBody")}
          </p>
        </>
      )}

      <div className="flex flex-col gap-2.5 mt-9" style={{ width: "100%", maxWidth: 300 }}>
        {whatsapp && (
          <a href={`https://wa.me/${whatsapp}?text=${encodeURIComponent(`Hello, about order ${code}`)}`}
            target="_blank" rel="noopener noreferrer">
            <Btn full variant="dark">{t("status.message")}</Btn>
          </a>
        )}
        <a href="/"><Btn full variant="ghost">{t("status.back")}</Btn></a>
      </div>
    </div>
  );
}

function BootSkeleton() {
  return (
    <div className="min-h-screen px-4 sm:px-6 pt-16" style={{ background: T.bg }}>
      <div style={{ maxWidth: WRAP, margin: "0 auto" }}>
        <div className="skeleton" style={{ height: 22, width: 180, marginBottom: 26 }} />
        <div className="skeleton" style={{ height: 64, width: "min(100%, 620px)", marginBottom: 12 }} />
        <div className="skeleton" style={{ height: 64, width: "min(80%, 460px)", marginBottom: 34 }} />
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
          {Array.from({ length: 8 }).map((_, i) => (
            <div key={i} className="skeleton" style={{ aspectRatio: "16 / 14" }} />
          ))}
        </div>
      </div>
    </div>
  );
}

/* =====================================================
   CART / CHECKOUT DRAWER
===================================================== */
function CartDrawer({ cart, total, stage, setStage, setQty, removeItem, settings, placeOrder,
                      lastOrder, close, catalog, account, signedIn, onSignIn }) {
  const { t } = useT();
  const balance = Number(account?.balance ?? 0);
  const canUseBalance = signedIn && balance >= total && total > 0;
  /* Resolved from the catalogue rather than copied onto each line item —
     duplicating logo data into every saved order would fill up storage fast. */
  const logoFor = (id) => catalog.find((p) => p.id === id)?.image;

  const [form, setForm] = useState({ name: "", phone: "", email: "", payment: "cod", notes: "" });
  const [touched, setTouched] = useState({});

  /* Prefill from the signed-in account, and default to paying from the balance
     when it covers the order — that is the whole reason the balance exists. */
  useEffect(() => {
    const p = account?.profile;
    if (!p) return;
    setForm((f) => ({
      ...f,
      name: f.name || p.name || "",
      phone: f.phone || p.phone || "",
      email: f.email || p.email || "",
      payment: f.payment === "cod" && canUseBalance ? "balance" : f.payment,
    }));
  }, [account, canUseBalance]);

  /* If the balance stops covering the order — another tab spent it, or an item
     was added — fall back rather than submitting something that will fail. */
  useEffect(() => {
    if (form.payment === "balance" && !canUseBalance) setForm((f) => ({ ...f, payment: "cod" }));
  }, [canUseBalance, form.payment]);

  /* Signing out with the checkout form open would otherwise leave a form that
     cannot submit. */
  useEffect(() => {
    if (!signedIn && stage === "details") setStage("cart");
  }, [signedIn, stage, setStage]);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState("");
  /* Captured at submit time. Reading it off the live balance afterwards
     subtracts the order twice, because the refresh has already applied it. */
  const [balanceAfter, setBalanceAfter] = useState(null);
  const set = (k) => (e) => setForm({ ...form, [k]: e.target.value });
  const blur = (k) => () => setTouched((x) => ({ ...x, [k]: true }));

  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const esc = (e) => { if (e.key === "Escape") close(); };
    window.addEventListener("keydown", esc);
    return () => { document.body.style.overflow = prev; window.removeEventListener("keydown", esc); };
  }, [close]);

  /* A typo'd email means a subscription we can never deliver, so check the
     shape of these before letting the order through. */
  const problems = {
    name: form.name.trim() ? "" : t("co.errName"),
    phone: phoneOk(form.phone) ? "" : t("co.errPhone"),
    email: emailOk(form.email) ? "" : t("co.errEmail"),
  };
  const valid = !problems.name && !problems.phone && !problems.email;
  const errorFor = (k) => (touched[k] ? problems[k] : "");

  const waLink = () => {
    if (!lastOrder) return "#";
    const lines = lastOrder.items.map((i) => `• ${i.name} — ${i.label} ×${i.qty} = ${money(i.price * i.qty)}`).join("\n");
    const msg =
      `Order ${lastOrder.code}\n${lines}\n\nTotal: ${money(lastOrder.total)}\n` +
      `Payment: ${lastOrder.customer.payment === "online" ? "Online" : "Cash on delivery"}\n` +
      `Name: ${lastOrder.customer.name}\nEmail: ${lastOrder.customer.email}`;
    return `https://wa.me/${settings.whatsapp}?text=${encodeURIComponent(msg)}`;
  };

  return (
    <div className="fade fixed inset-0 z-[65] flex justify-end" style={{ background: "var(--scrim)" }} onClick={close}>
      <aside onClick={(e) => e.stopPropagation()}
        className="slidein flex flex-col h-full w-full asmar-scroll"
        style={{ maxWidth: 440, background: T.bg, borderInlineStart: `1px solid ${T.line}`, overflowY: "auto" }}>

        <div className="sticky top-0 z-10 flex items-center justify-between px-5 py-4"
          style={{ background: T.bg, borderBottom: `1px solid ${T.line}` }}>
          <div className="flex items-center gap-2">
            {stage === "details" && (
              <button onClick={() => setStage("cart")} aria-label={t("cart.back")} className="press" style={{ color: T.inkSoft }}>
                <Arrow size={20} back />
              </button>
            )}
            <span style={{ fontFamily: display, fontSize: 21 }}>
              {stage === "cart" ? t("cart.title") : stage === "details" ? t("cart.checkout") : t("cart.placed")}
            </span>
          </div>
          <button onClick={close} aria-label={t("cart.close")} className="press" style={{ color: T.inkSoft }}><X size={20} /></button>
        </div>

        {/* ---- cart stage ---- */}
        {stage === "cart" && (
          <div className="flex-1 flex flex-col">
            {cart.length === 0 ? (
              <div className="flex-1 flex flex-col items-center justify-center px-8 text-center gap-2">
                <Receipt size={30} style={{ color: T.tintDeep }} />
                <p style={{ fontFamily: display, fontSize: 21 }}>{t("cart.empty")}</p>
                <p style={{ fontSize: 14, color: T.inkSoft }}>{t("cart.emptyBody")}</p>
                <Btn variant="ghost" onClick={close} style={{ marginTop: 12 }}>{t("cart.browse")}</Btn>
              </div>
            ) : (
              <>
                <div className="px-5 py-4 flex flex-col gap-4">
                  {cart.map((i) => (
                    <div key={i.key} className="flex items-start gap-3 pb-4" style={{ borderBottom: `1px dashed ${T.line}` }}>
                      <ProductMark src={logoFor(i.id)} name={i.name} size={44} />
                      <div className="flex-1 min-w-0">
                        <Auto as="div" style={{ fontFamily: display, fontSize: 17, lineHeight: 1.4 }}>{i.name}</Auto>
                        <Auto as="div" className="lbl" style={{ fontSize: 11.5, color: T.rose,
                               letterSpacing: ".08em", textTransform: "uppercase", lineHeight: 1.7 }}>
                          {i.label}
                        </Auto>
                        <div className="flex items-center gap-3 mt-2.5">
                          <div className="flex items-center" style={{ border: `1px solid ${T.line}`, borderRadius: 8 }}>
                            <button onClick={() => setQty(i.key, -1)} className="px-2.5 py-1.5 press" aria-label={t("cart.decrease")}><Minus size={13} /></button>
                            <span style={{ minWidth: 20, textAlign: "center", fontSize: 14 }}>{i.qty}</span>
                            <button onClick={() => setQty(i.key, 1)} className="px-2.5 py-1.5 press" aria-label={t("cart.increase")}><Plus size={13} /></button>
                          </div>
                          <button onClick={() => removeItem(i.key)} aria-label={t("cart.remove")} className="press" style={{ color: T.rose }}>
                            <Trash2 size={15} />
                          </button>
                        </div>
                      </div>
                      <div style={{ fontFamily: display, fontSize: 17 }}><Money v={i.price * i.qty} /></div>
                    </div>
                  ))}
                </div>
                <div className="mt-auto sticky bottom-0 px-5 py-5"
                  style={{ background: T.surface, borderTop: `1px solid ${T.line}` }}>
                  <div className="flex justify-between items-baseline mb-4">
                    <span className="lbl" style={{ fontSize: 11.5, letterSpacing: ".18em", textTransform: "uppercase", color: T.inkSoft }}>
                      {t("cart.total")}
                    </span>
                    <span style={{ fontFamily: display, fontSize: 30, color: T.brandText }}><Money v={total} /></span>
                  </div>

                  {/* Browsing and filling a cart stay open to everyone; the gate
                      is at checkout, where an account is actually needed. */}
                  {signedIn ? (
                    <Btn full onClick={() => setStage("details")}>{t("cart.continue")}</Btn>
                  ) : (
                    <>
                      <p style={{ fontSize: 12.5, color: T.inkSoft, lineHeight: 1.65, marginBottom: 12 }}>
                        {t("cart.signInBody")}
                      </p>
                      <Btn full onClick={onSignIn}>{t("cart.signIn")}</Btn>
                      {/* Someone stopped here with a full cart is the most
                          valuable person to give an account to, so the request
                          form is one tap away rather than a WhatsApp detour. */}
                      <a href="/request" onClick={close} className="block mt-2">
                        <Btn full variant="ghost">{t("req.cta")}</Btn>
                      </a>
                      <p className="text-center" style={{ fontSize: 11.5, color: T.inkSoft, marginTop: 10 }}>
                        {t("cart.keepCart")}
                      </p>
                    </>
                  )}
                </div>
              </>
            )}
          </div>
        )}

        {/* ---- details stage ---- */}
        {stage === "details" && (
          <div className="flex-1 flex flex-col px-5 py-5 gap-4">
            <p style={{ fontSize: 13, color: T.inkSoft, lineHeight: 1.7 }}>{t("co.note")}</p>
            <Field label={t("co.name")} value={form.name} onChange={set("name")} onBlur={blur("name")}
              error={errorFor("name")} placeholder={t("co.namePlaceholder")} autoComplete="name" />
            <Field label={t("co.phone")} value={form.phone} onChange={set("phone")} onBlur={blur("phone")}
              error={errorFor("phone")} placeholder="+961 70 000 000" inputMode="tel" autoComplete="tel" dir="ltr" />
            <Field label={t("co.email")} value={form.email} onChange={set("email")} onBlur={blur("email")}
              error={errorFor("email")} placeholder="you@email.com" type="email" autoComplete="email" dir="ltr" />

            <div>
              <span className="lbl" style={{ fontFamily: ui, fontSize: 11, letterSpacing: ".14em", textTransform: "uppercase", color: T.inkSoft }}>
                {t("co.payment")}
              </span>
              <div className="grid grid-cols-2 gap-2 mt-2">
                {signedIn && (
                  <button onClick={() => canUseBalance && setForm({ ...form, payment: "balance" })}
                    disabled={!canUseBalance}
                    className="text-start px-3 py-3 press col-span-2"
                    style={{ borderRadius: 10, opacity: canUseBalance ? 1 : 0.55,
                             background: form.payment === "balance" ? T.tint : T.surface,
                             border: `1px solid ${form.payment === "balance" ? T.brand : T.line}` }}>
                    <div className="flex items-center gap-1.5" style={{ fontSize: 13.5, fontWeight: 500, color: T.ink }}>
                      <Wallet size={14} style={{ color: T.brandText }} /> {t("co.balance")}
                    </div>
                    <div style={{ fontSize: 11.5, color: T.inkSoft, marginTop: 2 }}>
                      {canUseBalance
                        ? t("co.balanceSub", { amount: money(balance) })
                        : t("co.balanceShort", { amount: money(balance) })}
                    </div>
                  </button>
                )}
                {[
                  { k: "cod", title: t("co.cod"), sub: t("co.codSub") },
                  { k: "online", title: t("co.online"), sub: t("co.onlineSub") },
                ].map((o) => (
                  <button key={o.k} onClick={() => setForm({ ...form, payment: o.k })}
                    className="text-start px-3 py-3 press"
                    style={{ borderRadius: 10,
                             background: form.payment === o.k ? T.tint : T.surface,
                             border: `1px solid ${form.payment === o.k ? T.brand : T.line}` }}>
                    <div style={{ fontSize: 13.5, fontWeight: 500, color: T.ink }}>{o.title}</div>
                    <div style={{ fontSize: 11.5, color: T.inkSoft, marginTop: 2 }}>{o.sub}</div>
                  </button>
                ))}
              </div>
              {!signedIn && (
                <a href="/login" onClick={close} className="inline-block mt-2"
                  style={{ fontSize: 12, color: T.brandText }}>
                  {t("co.signInToUse")} →
                </a>
              )}
            </div>

            {form.payment === "online" && (
              <div className="px-3.5 py-3" style={{ background: T.tint, borderRadius: 10, fontSize: 12.5,
                     color: T.ink, lineHeight: 1.7 }}>
                <div style={{ fontWeight: 500, marginBottom: 4, color: T.brandText }}>{t("co.transfer")}</div>
                <Ltr>{settings.whishNote}</Ltr><br /><Ltr>{settings.omtNote}</Ltr>
              </div>
            )}

            <Field label={t("co.notes")} value={form.notes} onChange={set("notes")} placeholder={t("co.notesPlaceholder")} />

            <div className="mt-auto pt-4">
              <div className="flex justify-between items-baseline mb-3">
                <span className="lbl" style={{ fontSize: 11.5, letterSpacing: ".18em", textTransform: "uppercase", color: T.inkSoft }}>
                  {t("cart.total")}
                </span>
                <span style={{ fontFamily: display, fontSize: 27, color: T.brandText }}><Money v={total} /></span>
              </div>
              {submitError && (
                <p className="flex items-start gap-1.5" style={{ fontSize: 12.5, color: T.brandText, marginBottom: 10 }}>
                  <AlertTriangle size={14} className="shrink-0" style={{ marginTop: 1 }} /> {submitError}
                </p>
              )}
              {/* Left clickable while invalid so tapping it reveals what is missing
                  rather than leaving a dead button with no explanation. */}
              <Btn full
                onClick={async () => {
                  if (!valid) return setTouched({ name: true, phone: true, email: true });
                  if (submitting) return;            // guard against a double tap
                  setSubmitting(true); setSubmitError("");
                  const payingWithBalance = form.payment === "balance";
                  const balanceBefore = balance;
                  try {
                    const order = await placeOrder(form, payingWithBalance);
                    if (payingWithBalance) {
                      setBalanceAfter(Math.max(0, balanceBefore - Number(order.total)));
                    }
                    /* Pay online: hand the customer to Whish's own page. The order
                       already exists, so an abandoned payment leaves a recoverable
                       "Awaiting payment" order rather than nothing. */
                    if (form.payment === "online" && backend.mode === "supabase") {
                      const url = await startWhishPayment(order.code);
                      window.location.href = url;
                      return;
                    }
                  } catch (e) {
                    console.error(e);
                    setSubmitError(e?.message || t("co.errGeneric"));
                  } finally {
                    setSubmitting(false);
                  }
                }}
                style={{ opacity: valid && !submitting ? 1 : 0.5 }}>
                {submitting ? t("co.placing") : t("co.place")}
              </Btn>
            </div>
          </div>
        )}

        {/* ---- done stage ---- */}
        {stage === "done" && lastOrder && (
          <div className="flex-1 flex flex-col px-5 py-8">
            <div className="receipt-tear px-5 py-6"
              style={{ background: T.surface, border: `1px solid ${T.line}`, borderBottom: "none",
                       borderRadius: "12px 12px 0 0" }}>
              <div className="flex flex-col items-center gap-2 mb-5">
                <div className="flex items-center justify-center pop"
                  style={{ width: 44, height: 44, borderRadius: 22, background: T.tint }}>
                  <Check size={21} style={{ color: T.ok }} />
                </div>
                <div dir="ltr" style={{ fontFamily: script, fontSize: 27, color: T.brandText, lineHeight: 1.1 }}>Asmar</div>
                <Ltr style={{ fontSize: 11, letterSpacing: ".22em", textTransform: "uppercase", color: T.inkSoft }}>
                  {lastOrder.code}
                </Ltr>
              </div>
              {lastOrder.items.map((i, n) => (
                <div key={i.key || n} className="flex justify-between gap-3 py-1.5" style={{ fontSize: 13.5 }}>
                  <Auto style={{ color: T.inkSoft }}>{i.name} · {i.label} ×{i.qty}</Auto>
                  <span><Money v={i.price * i.qty} /></span>
                </div>
              ))}
              <div style={{ height: 1, background: T.line, margin: "12px 0" }} />
              <div className="flex justify-between items-baseline">
                <span className="lbl" style={{ fontSize: 11.5, letterSpacing: ".18em", textTransform: "uppercase", color: T.inkSoft }}>
                  {t("cart.total")}
                </span>
                <span style={{ fontFamily: display, fontSize: 25 }}><Money v={lastOrder.total} /></span>
              </div>
            </div>

            <p style={{ fontSize: 13.5, color: T.inkSoft, lineHeight: 1.75, marginTop: 28 }}>
              {lastOrder.customer.payment === "balance"
                ? t("co.balanceUsed", { amount: money(balanceAfter ?? balance) })
                : lastOrder.customer.payment === "online" ? t("done.online") : t("done.cod")}
            </p>
            <a href={waLink()} target="_blank" rel="noopener noreferrer" style={{ marginTop: 16 }}>
              <Btn full variant="dark">{t("done.confirm")}</Btn>
            </a>
            <a href={`/order/${encodeURIComponent(lastOrder.code)}`} onClick={close} style={{ marginTop: 10 }}>
              <Btn full variant="ghost">{t("done.track")}</Btn>
            </a>
            <Btn variant="quiet" full onClick={close} style={{ marginTop: 10 }}>{t("done.keep")}</Btn>
          </div>
        )}
      </aside>
    </div>
  );
}

/* =====================================================
   GLOBAL STYLE
===================================================== */
/* Amiri and Tajawal carry the Arabic — Bodoni and Jost have no Arabic glyphs at
   all, so without them an Arabic page falls back to whatever the device happens
   to have. They are also ~200 KB, which an English-only visitor should not be
   made to download, so they are fetched the first time the shop is in Arabic
   and then left in the head for the rest of the session. */
const ARABIC_FONT_ID = "asmar-arabic-fonts";

function loadArabicFonts() {
  if (document.getElementById(ARABIC_FONT_ID)) return;
  const l = document.createElement("link");
  l.id = ARABIC_FONT_ID;
  l.rel = "stylesheet";
  l.href = "https://fonts.googleapis.com/css2" +
    "?family=Amiri:wght@400;700" +
    "&family=Tajawal:wght@300;400;500;700" +
    "&display=swap";
  document.head.appendChild(l);
}

function GlobalStyle() {
  const { lang } = useT();

  /* The Latin faces are a plain <link> in index.html so they start downloading
     during HTML parse rather than after the bundle executes. */
  useEffect(() => {
    if (lang === "ar") loadArabicFonts();
  }, [lang]);

  useEffect(() => {
    const s = document.createElement("style");
    s.textContent = `
      :root, [data-theme="light"] {
        --bg:#FDF7F5; --bg-2:#F8EDEA; --surface:#FFFFFF; --surface-2:#FBF3F1;
        --line:#EBD8D3;
        --ink:#1E1315; --ink-soft:#75595F;
        --brand:#9B1B30; --brand-text:#9B1B30;
        --tint:#F7E5E1; --tint-deep:#EFCDC7;
        --rose:#B4737F; --ok:#2F6B4F;
        --shadow:rgba(30,19,21,.42);
        --bg-blur:rgba(253,247,245,.88);
        --scrim:rgba(30,19,21,.45);
        --chip-scrim:rgba(30,19,21,.55);
        --glow-a:rgba(155,27,48,.16); --glow-b:rgba(196,115,127,.14);
      }
      [data-theme="dark"] {
        --bg:#0C0A0B; --bg-2:#110D0F; --surface:#171214; --surface-2:#1D1719;
        --line:#2B2226;
        --ink:#F5EEEB; --ink-soft:#9A888D;
        --brand:#C41F3C; --brand-text:#F0637A;
        --tint:rgba(196,31,60,.14); --tint-deep:rgba(196,31,60,.26);
        --rose:#C4737F; --ok:#3FB27F;
        --shadow:rgba(0,0,0,.85);
        --bg-blur:rgba(12,10,11,.82);
        --scrim:rgba(0,0,0,.62);
        --chip-scrim:rgba(0,0,0,.5);
        --glow-a:rgba(196,31,60,.28); --glow-b:rgba(240,99,122,.16);
      }

      /* Type. Latin and Arabic need different faces, and the wordmark keeps
         its script face in both. */
      :root {
        --font-display:'Bodoni Moda', Georgia, serif;
        --font-ui:'Jost', system-ui, sans-serif;
        --font-script:'Pinyon Script', cursive;
        --origin-start: left;
      }
      [dir="rtl"] {
        --font-display:'Amiri', 'Bodoni Moda', Georgia, serif;
        --font-ui:'Tajawal', system-ui, sans-serif;
        --origin-start: right;
        --hero-max: 26ch;
      }
      :root { --hero-max: 16ch; }
      /* Arabic letters join up. Tracking them apart breaks the word, and
         text-transform does nothing in a script with no case — so both are
         removed rather than merely overridden per component. */
      [dir="rtl"] .lbl, [dir="rtl"] .lbl * {
        letter-spacing: normal !important;
        text-transform: none !important;
      }
      /* Arabic sits taller than Latin at the same size: it stacks marks above
         and tails below the line. The display sizes are tuned for Bodoni, so
         headings need the extra leading back or the lines touch. */
      [dir="rtl"] h1 { line-height: 1.4 !important; }
      [dir="rtl"] h2, [dir="rtl"] h3 { line-height: 1.55 !important; }

      html { scroll-behavior: smooth; }
      body { background: var(--bg); }
      ::selection { background: var(--tint-deep); color: var(--ink); }
      *:focus-visible { outline: 2px solid var(--brand-text); outline-offset: 2px; border-radius: 4px; }

      .asmar-scroll::-webkit-scrollbar { width: 7px; height: 7px; }
      .asmar-scroll::-webkit-scrollbar-thumb { background: var(--line); border-radius: 4px; }

      /* --- entrances --- */
      [data-reveal] {
        opacity: 0; transform: translateY(18px);
        transition: opacity .7s cubic-bezier(.22,.8,.24,1), transform .7s cubic-bezier(.22,.8,.24,1);
        will-change: opacity, transform;
      }
      [data-reveal].revealed { opacity: 1; transform: none; }
      .fade { animation: fade .3s ease both; }
      @keyframes fade { from { opacity:0 } to { opacity:1 } }
      .slidein { animation: slidein .38s cubic-bezier(.22,.8,.24,1) both; }
      @keyframes slidein { from { transform: translateX(100%) } to { transform:none } }
      [dir="rtl"] .slidein { animation-name: slideinRtl; }
      @keyframes slideinRtl { from { transform: translateX(-100%) } to { transform:none } }
      .drop { animation: drop .32s cubic-bezier(.22,.8,.24,1) both; }
      @keyframes drop { from { transform: translateY(-14px); opacity:0 } to { transform:none; opacity:1 } }
      .pop { animation: pop .28s cubic-bezier(.22,1.5,.36,1) both; }
      @keyframes pop { from { transform: scale(.4) } to { transform: scale(1) } }

      /* --- hero glows --- */
      .aurora { position:absolute; border-radius:50%; filter: blur(80px); pointer-events:none; }
      .a1 { width:min(60vw,620px); aspect-ratio:1; background:var(--glow-a); top:-24%; inset-inline-end:-12%;
            animation: float1 22s ease-in-out infinite; }
      .a2 { width:min(44vw,440px); aspect-ratio:1; background:var(--glow-b); top:22%; inset-inline-start:-14%;
            animation: float2 26s ease-in-out infinite; }
      @keyframes float1 { 0%,100%{transform:translate(0,0)} 50%{transform:translate(-5%,7%)} }
      @keyframes float2 { 0%,100%{transform:translate(0,0)} 50%{transform:translate(6%,-6%)} }

      .live-dot { width:6px; height:6px; border-radius:3px; background:var(--ok); display:inline-block;
                  box-shadow:0 0 0 0 var(--ok); animation: ping 2.4s ease-out infinite; }
      @keyframes ping { 0%{box-shadow:0 0 0 0 rgba(63,178,127,.55)} 70%{box-shadow:0 0 0 7px rgba(63,178,127,0)} 100%{box-shadow:0 0 0 0 rgba(63,178,127,0)} }

      /* --- interaction --- */
      .card, .tile {
        transition: transform .34s cubic-bezier(.22,.8,.24,1), box-shadow .34s ease,
                    border-color .34s ease, opacity .7s cubic-bezier(.22,.8,.24,1);
      }
      .card:hover, .tile:hover {
        transform: translateY(-4px);
        border-color: var(--tint-deep);
        box-shadow: 0 22px 44px -26px var(--shadow);
      }
      .tile-img { transition: transform .6s cubic-bezier(.22,.8,.24,1); }
      .tile:hover .tile-img { transform: scale(1.06); }
      .tile-arrow { transition: transform .3s cubic-bezier(.22,.8,.24,1); }
      .tile:hover .tile-arrow { transform: translateX(4px); }
      [dir="rtl"] .tile:hover .tile-arrow { transform: translateX(-4px); }

      .btn { transition: filter .18s ease, transform .12s ease, background .18s ease, border-color .18s ease; }
      .btn:hover { filter: brightness(1.08); }
      .press { transition: transform .12s ease; }
      .press:active { transform: scale(.96); }
      .icon-btn { transition: background .2s ease, color .2s ease; }
      .icon-btn:hover { background: var(--surface-2); }
      .row { transition: background .2s ease, border-color .2s ease; }
      .row:hover { background: var(--surface-2); border-color: var(--line) !important; }
      .chip { transition: background .2s ease, color .2s ease, border-color .2s ease; }
      .input { transition: border-color .2s ease, background .2s ease; }
      .input:focus { border-color: var(--brand-text) !important; }
      .hero-search:hover { border-color: var(--tint-deep) !important; }
      .foot-link { transition: color .2s ease; }
      .foot-link:hover { color: var(--ink) !important; }

      /* Underline wipes in from the reading edge, which is the right edge in
         Arabic — a transform origin handles both without duplicating the rule. */
      .navlink { position: relative; transition: color .2s ease; }
      .navlink:hover { color: var(--ink) !important; }
      .navlink::after {
        content:''; position:absolute; inset-inline:0; bottom:-6px; height:1px;
        background:var(--brand-text); transform: scaleX(0); transform-origin: var(--origin-start);
        transition: transform .34s cubic-bezier(.22,.8,.24,1);
      }
      .navlink:hover::after, .navlink[data-active="true"]::after { transform: scaleX(1); }

      .navscroll { scrollbar-width: none; -webkit-overflow-scrolling: touch; }
      .navscroll::-webkit-scrollbar { display: none; }

      .receipt-tear { position: relative; }
      .receipt-tear::after {
        content:''; position:absolute; left:0; right:0; bottom:-9px; height:9px;
        background:
          linear-gradient(-45deg, transparent 9px, var(--bg) 0) 0 0,
          linear-gradient(45deg, transparent 9px, var(--bg) 0) 0 0;
        background-size: 18px 18px; background-repeat: repeat-x;
        transform: rotate(180deg);
      }

      .skeleton { background: linear-gradient(90deg, var(--surface) 25%, var(--surface-2) 50%, var(--surface) 75%);
                  background-size: 300% 100%; animation: shimmer 1.4s linear infinite; border-radius: 12px; }
      @keyframes shimmer { from { background-position: 150% 0 } to { background-position: -150% 0 } }

      @media (prefers-reduced-motion: reduce) {
        html { scroll-behavior: auto; }
        *, *::before, *::after {
          animation-duration: .001ms !important; animation-iteration-count: 1 !important;
          transition-duration: .001ms !important;
        }
        [data-reveal] { opacity: 1 !important; transform: none !important; }
        .card:hover, .tile:hover { transform: none; }
      }
    `;
    document.head.appendChild(s);
    return () => { s.remove(); };
  }, []);
  return null;
}

/* =====================================================
   MAIN
===================================================== */
function Store() {
  const { t, lang } = useT();
  const [ready, setReady] = useState(false);
  const [loadError, setLoadError] = useState("");
  const [saveError, setSaveError] = useState("");
  const [saveState, setSaveState] = useState("idle");   // idle | saving | saved | error
  const [catalog, setCatalog] = useState(SEED_CATALOG);
  const [orders, setOrders] = useState([]);
  const [settings, setSettings] = useState(SEED_SETTINGS);

  const [theme, toggleTheme] = useTheme();
  const route = useAppRoute();
  const [cart, setCart] = useState(() => {
    /* A cart that survives a refresh, a WhatsApp detour, or a Whish redirect —
       losing it mid-checkout loses the sale. */
    try { return JSON.parse(localStorage.getItem("asmar:cart") || "[]"); } catch { return []; }
  });
  const [cartOpen, setCartOpen] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [stage, setStage] = useState("cart");
  const [lastOrder, setLastOrder] = useState(null);
  const [q, setQ] = useState("");
  const [sort, setSort] = useState("featured");

  /* The signed-in customer and their wallet. Admins get a session too; the
     admin panel checks separately whether it is allowed to let them in. */
  const [session, setSession] = useState(null);
  const [account, setAccount] = useState(null);
  const [accountLoading, setAccountLoading] = useState(false);

  /* Load the shop. Orders are deliberately not fetched here — they are
     admin-only and the database refuses them until someone signs in. */
  useEffect(() => {
    (async () => {
      try {
        const [c, s] = await Promise.all([
          fetchCatalog(SEED_CATALOG),
          fetchSettings(SEED_SETTINGS),
        ]);
        setCatalog(c);
        setSettings({ ...SEED_SETTINGS, ...s });
      } catch (e) {
        console.error("Could not load the shop", e);
        setLoadError("We could not reach the store. Check your connection and refresh.");
      } finally {
        setReady(true);
      }
    })();
  }, []);

  useEffect(() => {
    try { localStorage.setItem("asmar:cart", JSON.stringify(cart)); } catch { /* full or private */ }
  }, [cart]);

  useEffect(() => {
    let alive = true;
    auth.session().then((s) => { if (alive) setSession(s); }).catch(() => {});
    const off = auth.onChange((s) => setSession(s));
    return () => { alive = false; off?.(); };
  }, []);

  const refreshAccount = useCallback(async () => {
    if (!session) { setAccount(null); return; }
    setAccountLoading(true);
    try {
      setAccount(await fetchAccount());
    } catch (e) {
      /* An expired session reads as "signed out" rather than as an error the
         customer can do nothing about. Re-check rather than assume: a network
         blip should not sign anyone out, but a session that really is gone
         must stop the UI claiming otherwise — and stop it retrying forever. */
      setAccount(null);
      const live = await auth.session().catch(() => null);
      if (!live) setSession(null);
      else console.error("Could not load the account", e);
    } finally {
      setAccountLoading(false);
    }
  }, [session]);

  useEffect(() => { refreshAccount(); }, [refreshAccount]);

  /* The balance goes stale the moment the owner approves a top-up, and a stale
     balance silently greys out "Pay from balance" — the customer then pays cash
     while their credit sits there. So re-read it at the three moments it
     matters: opening the cart, landing on the account pages, and coming back to
     the tab after going off to send a transfer. */
  useEffect(() => { if (cartOpen) refreshAccount(); }, [cartOpen, refreshAccount]);

  useEffect(() => {
    if (route === "/account" || route === "/topup") refreshAccount();
  }, [route, refreshAccount]);

  useEffect(() => {
    const onVisible = () => { if (document.visibilityState === "visible") refreshAccount(); };
    document.addEventListener("visibilitychange", onVisible);
    return () => document.removeEventListener("visibilitychange", onVisible);
  }, [refreshAccount]);

  /* Signed in after being stopped at the cart: back to the shop, cart reopened,
     carry on where they left off. */
  useEffect(() => {
    if (!session) return;
    if (takeResume() === "cart") {
      go("/");
      setCartOpen(true);
      setStage("cart");
    }
  }, [session]);

  /* "/" opens search, the way every catalogue app on a desktop does. */
  useEffect(() => {
    const key = (e) => {
      const typing = /^(INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName) || e.target.isContentEditable;
      if (e.key === "/" && !typing && !searchOpen) { e.preventDefault(); setSearchOpen(true); }
    };
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  }, [searchOpen]);

  const categories = settings.categories?.length ? settings.categories : SEED_CATEGORIES;
  const reviews = settings.reviews || [];

  /* The English category name stays the key products point at; only what the
     customer reads changes, so translating one never re-parents the catalogue. */
  const catLabel = useCallback(
    (c) => pick(lang, c, (settings.categoryNamesAr || {})[c]),
    [lang, settings.categoryNamesAr],
  );

  const activeCategory = useMemo(() => {
    const m = route.match(/^\/c\/(.+)$/);
    return m ? categories.find((c) => slugify(c) === m[1]) || null : null;
  }, [route, categories]);

  /* A shared link can outlive the category it points at — renamed, deleted, or
     simply mistyped. Fall back to the full shop instead of a dead page. */
  useEffect(() => {
    if (/^\/c\//.test(route) && !activeCategory && ready) go("/");
  }, [route, activeCategory, ready]);

  useEffect(() => { window.scrollTo(0, 0); setQ(""); }, [route]);
  useReveal(`${route}|${ready}|${catalog.length}|${lang}`);

  /* Title, description, canonical and the WhatsApp preview card, per route.
     Waits for `ready` so a product page does not first publish the seed
     catalogue's version of itself and then correct it. */
  useDocumentMeta(route, { catalog, settings, reviews }, lang);

  useEffect(() => { if (ready) trackPageview(route); }, [route, ready]);

  /* Optimistic on screen, debounced on the wire.
   *
   * The admin edits fields character by character, and each keystroke produces
   * a whole new catalogue. Writing every one of those meant a full upsert of
   * every product per letter typed — slow, and with responses landing out of
   * order an early keystroke could overwrite a later one. Coalesce instead, and
   * show the owner whether his work is safe yet. */
  const saveTimer = useRef(null);
  const pendingSave = useRef(null);

  const flushSave = useCallback(() => {
    const job = pendingSave.current;
    if (!job) return;
    pendingSave.current = null;
    clearTimeout(saveTimer.current);
    setSaveState("saving");
    job()
      .then(() => setSaveState("saved"))
      .catch((e) => { console.error(e); setSaveState("error"); setSaveError("Could not save your changes."); });
  }, []);

  const queueSave = useCallback((job) => {
    pendingSave.current = job;
    setSaveState("saving");
    clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(flushSave, 600);
  }, [flushSave]);

  /* Leaving the page with an edit still in the debounce window would lose it. */
  useEffect(() => {
    const flush = () => { if (pendingSave.current) flushSave(); };
    window.addEventListener("beforeunload", flush);
    window.addEventListener("pagehide", flush);
    return () => {
      window.removeEventListener("beforeunload", flush);
      window.removeEventListener("pagehide", flush);
    };
  }, [flushSave]);

  const persistCatalog = (next) => {
    setCatalog(next);
    queueSave(() => saveCatalog(next));
  };
  const persistSettings = (next) => {
    setSettings(next);
    queueSave(() => saveSettings(next));
  };
  const setOrderStatus = (code, status) => {
    setOrders((list) => list.map((o) => (o.code === code ? { ...o, status } : o)));
    updateOrderStatus(code, status).catch((e) => { console.error(e); setSaveError("Could not update that order."); });
  };

  /* cart ops */
  const addToCart = (product, variant) => {
    if (!variant) return;
    const key = product.id + "|" + variant.label;
    setCart((c) => {
      const found = c.find((i) => i.key === key);
      if (found) return c.map((i) => (i.key === key ? { ...i, qty: i.qty + 1 } : i));
      return [...c, { key, id: product.id, name: product.name, label: variant.label, price: variant.price, qty: 1 }];
    });
    /* Straight into the cart, so the total and the checkout button are in front
       of the customer the moment they add something. */
    setCartOpen(true);
    setStage("cart");
    /* Product name and plan only — never anything that identifies the person.
       This is the number that says what to stock and what to reprice. */
    trackEvent("Add to cart", { product: product.name, plan: variant.label });
  };
  const setQty = (key, d) =>
    setCart((c) => c.map((i) => (i.key === key ? { ...i, qty: Math.max(0, i.qty + d) } : i)).filter((i) => i.qty > 0));
  const removeItem = (key) => setCart((c) => c.filter((i) => i.key !== key));

  const total = useMemo(() => cart.reduce((s, i) => s + i.price * i.qty, 0), [cart]);
  const count = useMemo(() => cart.reduce((s, i) => s + i.qty, 0), [cart]);

  const placeOrder = async (customer, useBalance = false) => {
    const order = await submitOrder({ items: cart, customer, total, useBalance });
    setLastOrder(order);
    setCart([]);
    setStage("done");
    if (useBalance) refreshAccount();
    trackEvent("Order placed", {
      payment: useBalance ? "balance" : customer.payment,
      items: String(cart.length),
    });
    return order;
  };

  const countIn = (c) => catalog.filter((p) => p.active && p.category === c).length;
  const reviewsFor = (id) => reviews.filter((r) => r.productId === id);

  const visible = useMemo(() => {
    const term = q.trim().toLowerCase();
    const matches = (p) =>
      term === "" || [p.name, p.note, p.category].some((f) => (f || "").toLowerCase().includes(term));
    const list = catalog.filter((p) => p.active && (!activeCategory || p.category === activeCategory) && matches(p));
    const sorted = [...list];
    if (sort === "low") sorted.sort((a, b) => lowestPrice(a) - lowestPrice(b));
    else if (sort === "high") sorted.sort((a, b) => lowestPrice(b) - lowestPrice(a));
    else if (sort === "az") sorted.sort((a, b) => a.name.localeCompare(b.name));
    else sorted.sort((a, b) => Number(!!b.featured) - Number(!!a.featured));
    return sorted;
  }, [catalog, activeCategory, q, sort]);

  const featured = useMemo(() => catalog.filter((p) => p.active && p.featured).slice(0, 8), [catalog]);

  /* An empty category is a dead end for a customer, so the storefront only
     advertises ones that have something in them. Admin still sees them all, and
     a direct link to an empty category still resolves. */
  const shownCategories = categories.filter((c) => countIn(c) > 0);
  const covers = settings.categoryImages || {};
  const notes = settings.categoryNotes || {};
  const notesAr = settings.categoryNotesAr || {};
  const catNote = (c) => pick(lang, notes[c], notesAr[c]);

  /* Where a successful sign-in lands. An admin goes to the admin — that is what
     they signed in to do — unless something was explicitly waiting to be
     resumed, like a cart they were stopped at, which is more specific than any
     default and wins. */
  const afterSignIn = (fallback) => (isAdmin, hadResume) => {
    if (hadResume) return;                // the resume effect handles where to go
    go(isAdmin ? "/admin" : fallback);
  };

  if (!ready) return <BootSkeleton />;

  const orderRoute = route.match(/^\/order\/(.+)$/);
  if (orderRoute) {
    return <OrderStatusPage code={decodeURIComponent(orderRoute[1])} whatsapp={settings.whatsapp} />;
  }
  /* Signed in already, or in local mode where the PIN gate inside Admin stands
     in for auth. The signed-out case needs `chrome`, so it is handled below
     once that is defined. */
  if (route === "/admin" && (session || !auth.real)) {
    return (
      <Suspense fallback={<BootSkeleton />}>
        <Admin
          catalog={catalog} setCatalog={persistCatalog}
          orders={orders} setOrders={setOrders} setOrderStatus={setOrderStatus}
          settings={settings} setSettings={persistSettings}
          saveError={saveError} saveState={saveState} onFlush={flushSave}
          exit={() => { flushSave(); go("/"); }}
        />
      </Suspense>
    );
  }

  const productRoute = route.match(/^\/p\/(.+)$/);
  const pageRoute = route.match(/^\/page\/(about|terms|refund|privacy)$/);

  const chrome = (children) => (
    <div className="min-h-screen" style={{ background: T.bg, fontFamily: ui, color: T.ink }}>
      <ShopHeader
        categories={shownCategories} activeCategory={activeCategory} count={count}
        onCart={() => { setCartOpen(true); setStage("cart"); }}
        onSearch={() => setSearchOpen(true)}
        theme={theme} toggleTheme={toggleTheme} catLabel={catLabel} signedIn={!!session}
      />
      {loadError && (
        <div className="px-5 py-3 flex items-center justify-center gap-2"
          style={{ background: T.tint, color: T.brandText }}>
          <AlertTriangle size={15} className="shrink-0" />
          <span style={{ fontSize: 13 }}>{loadError}</span>
        </div>
      )}
      {children}
      <Footer settings={settings} categories={shownCategories} catLabel={catLabel} />
      <MobileTabs route={route} count={count} signedIn={!!session}
        onSearch={() => setSearchOpen(true)}
        onCart={() => { setCartOpen(true); setStage("cart"); }} />
      {searchOpen && (
        <SearchOverlay catalog={catalog} onClose={() => setSearchOpen(false)} onAdd={addToCart} />
      )}
      {cartOpen && (
        <CartDrawer
          cart={cart} total={total} stage={stage} setStage={setStage} catalog={catalog}
          setQty={setQty} removeItem={removeItem}
          settings={settings} lastOrder={lastOrder} placeOrder={placeOrder}
          account={account} signedIn={!!session}
          onSignIn={() => {
            /* Remember why they left, so signing in drops them back on the cart
               instead of the account page they never asked for. */
            try { localStorage.setItem(RESUME_KEY, "cart"); } catch { /* private mode */ }
            setCartOpen(false);
            go("/login");
          }}
          close={() => { setCartOpen(false); if (stage === "done") setStage("cart"); }}
        />
      )}
    </div>
  );

  /* The admin has no sign-in form of its own any more. Ali uses the same one
     every customer uses, and the database decides what he sees afterwards — a
     second login screen was a second prompt for the same password, and it hid
     the fact that the two are one account. */
  if (route === "/admin") {
    return chrome(
      <AccountAccessPage whatsapp={settings.whatsapp} onDone={afterSignIn("/admin")} />,
    );
  }

  if (route === "/track") return chrome(<TrackPage />);
  if (pageRoute) return chrome(<PolicyPage pageKey={pageRoute[1]} settings={settings} />);

  /* Signing in and requesting an account are one page with two tabs; the route
     just says which tab. Someone already signed in has no use for either, and
     landing on them after a session restore would be confusing. */
  if (route === "/login" || route === "/request") {
    return session
      ? chrome(<AccountPage account={account} loading={accountLoading} whatsapp={settings.whatsapp}
                 onSignOut={async () => { await auth.signOut(); setSession(null); go("/"); }} />)
      /* Stay put when something is waiting to be resumed — the effect below
         handles where to go, and two navigations at once race each other. */
      : chrome(<AccountAccessPage
                 mode={route === "/request" ? "request" : "signin"}
                 whatsapp={settings.whatsapp}
                 onDone={afterSignIn("/account")} />);
  }
  if (route === "/account" || route === "/topup") {
    /* A signed-out visitor lands on the sign-in page rather than an error — the
       link is shared, bookmarked, and reached after a session expires. */
    if (!session) {
      return chrome(<AccountAccessPage whatsapp={settings.whatsapp} onDone={afterSignIn(route)} />);
    }
    return chrome(route === "/topup"
      ? <TopUpPage settings={settings} account={account} onDone={refreshAccount} />
      : <AccountPage account={account} loading={accountLoading} whatsapp={settings.whatsapp}
          onSignOut={async () => { await auth.signOut(); setSession(null); go("/"); }} />);
  }
  if (productRoute) {
    return chrome(
      <div key={route}>
        <ProductPage
          product={findProduct(catalog.filter((p) => p.active), decodeURIComponent(productRoute[1]))}
          catalog={catalog} reviews={reviews} onAdd={addToCart} whatsapp={settings.whatsapp}
          catLabel={catLabel}
        />
      </div>
    );
  }

  return chrome(
    <div key={route}>
      {activeCategory ? (
        <>
          <CategoryHeader
            name={catLabel(activeCategory)} cover={covers[activeCategory]} note={catNote(activeCategory)}
            count={countIn(activeCategory)}
          />
          <main className="px-4 sm:px-6 pb-20" style={{ maxWidth: WRAP, margin: "0 auto" }}>
            <div className="flex flex-wrap items-center gap-2 mb-5">
              <div className="flex items-center gap-2 px-3.5 py-2.5 flex-1"
                style={{ minWidth: 210, background: T.surface, border: `1px solid ${T.line}`, borderRadius: 10 }}>
                <Search size={16} style={{ color: T.rose }} className="shrink-0" />
                <input value={q} onChange={(e) => setQ(e.target.value)}
                  placeholder={t("cat.searchIn", { category: catLabel(activeCategory) })} className="w-full outline-none"
                  style={{ fontFamily: ui, fontSize: 15, background: "transparent", color: T.ink }} />
                {q && (
                  <button onClick={() => setQ("")} aria-label="Clear" style={{ color: T.rose }}>
                    <X size={15} />
                  </button>
                )}
              </div>
              <select value={sort} onChange={(e) => setSort(e.target.value)} aria-label={t("cat.sort")}
                className="px-3 py-2.5 outline-none"
                style={{ fontFamily: ui, fontSize: 13.5, color: T.ink, background: T.surface,
                         border: `1px solid ${T.line}`, borderRadius: 10 }}>
                <option value="featured">{t("cat.sortRecommended")}</option>
                <option value="low">{t("cat.sortLow")}</option>
                <option value="high">{t("cat.sortHigh")}</option>
                <option value="az">{t("cat.sortAZ")}</option>
              </select>
            </div>

            <CategoryChips categories={shownCategories} active={activeCategory} catLabel={catLabel} />

            {q && (
              <p style={{ fontSize: 12.5, color: T.inkSoft, marginBottom: 14 }}>
                {t(visible.length === 1 ? "cat.match" : "cat.matches", { n: visible.length, q: q.trim() })}
              </p>
            )}

            {visible.length === 0 ? (
              <EmptyState title={t("cat.nothing")} body={q ? t("cat.noMatch") : t("cat.noLive")} />
            ) : (
              <div className="grid grid-cols-2 lg:grid-cols-3 gap-2.5 sm:gap-4">
                {visible.map((p, i) => (
                  <ProductCard key={p.id} product={p} onAdd={addToCart} delay={Math.min(i, 8) * 0.04}
                    rating={avgRating(reviewsFor(p.id))} reviewCount={reviewsFor(p.id).length} />
                ))}
              </div>
            )}
          </main>
        </>
      ) : (
        <>
          <Hero settings={settings} onSearch={() => setSearchOpen(true)}
            categoryCount={shownCategories.length}
            productCount={catalog.filter((p) => p.active).length} />
          <TrustStrip />

          <section className="px-4 sm:px-6 pt-12" style={{ maxWidth: WRAP, margin: "0 auto" }}>
            <SectionHead eyebrow={t("home.catalogue")} title={t("home.browse")} />
            {/* Fixed column counts rather than auto-fill: a phone must show
                exactly two per row, which a min track width cannot guarantee. */}
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-2.5 sm:gap-4">
              {shownCategories.map((c, i) => (
                <CategoryCard key={c} name={c} label={catLabel(c)} cover={covers[c]} note={catNote(c)}
                  count={countIn(c)} delay={Math.min(i, 8) * 0.05} />
              ))}
            </div>
            {shownCategories.length === 0 && (
              <EmptyState title={t("home.setupTitle")} body={t("home.setupBody")} />
            )}
          </section>

          {featured.length > 0 && (
            <section className="pt-14" style={{ maxWidth: WRAP, margin: "0 auto" }}>
              <div className="px-4 sm:px-6">
                <SectionHead
                  eyebrow={t("home.popularEyebrow")}
                  title={t("home.popularTitle")}
                  action={
                    <span className="hidden sm:flex items-center gap-1.5 lbl"
                      style={{ fontSize: 11.5, letterSpacing: ".12em", textTransform: "uppercase", color: T.inkSoft }}>
                      <Sparkles size={14} style={{ color: T.rose }} /> {t("home.handpicked")}
                    </span>
                  }
                />
              </div>
              {/* A rail rather than a grid: it signals "there is more" and keeps
                  the category grid as the page's main structure. */}
              <div className="flex gap-3 overflow-x-auto navscroll px-4 sm:px-6 pb-3" data-reveal>
                {featured.map((p) => (
                  <div key={p.id} className="shrink-0" style={{ width: 236 }}>
                    <ProductCard product={p} onAdd={addToCart} delay={0} noReveal
                      rating={avgRating(reviewsFor(p.id))} reviewCount={reviewsFor(p.id).length} />
                  </div>
                ))}
              </div>
            </section>
          )}

          <Reviews reviews={reviews} catalog={catalog} />
          <HowItWorks />
          <Faq items={settings.faq?.length ? settings.faq : SEED_FAQ} />

          <section className="px-4 sm:px-6 pb-8" style={{ maxWidth: WRAP, margin: "0 auto" }}>
            <div data-reveal className="relative overflow-hidden px-6 sm:px-12 py-12 text-center"
              style={{ background: T.surface, border: `1px solid ${T.line}`, borderRadius: 18 }}>
              <div aria-hidden className="aurora a2" style={{ insetInlineStart: "50%", top: "-40%", opacity: .8 }} />
              <div className="relative">
                <Eyebrow style={{ marginBottom: 12 }}>{t("home.ctaEyebrow")}</Eyebrow>
                <h2 style={{ fontFamily: display, fontSize: "clamp(24px, 5.5vw, 38px)", lineHeight: 1.25 }}>
                  {t("home.ctaTitle")}
                </h2>
                <p style={{ fontSize: 14.5, color: T.inkSoft, lineHeight: 1.75, marginTop: 12,
                            maxWidth: 460, marginInline: "auto" }}>
                  {t("home.ctaBody")}
                </p>
                {settings.whatsapp && (
                  <a href={`https://wa.me/${settings.whatsapp}`} target="_blank" rel="noopener noreferrer"
                    className="inline-block mt-7">
                    <Btn>{t("home.ctaBtn")} <ArrowRight size={15} /></Btn>
                  </a>
                )}
              </div>
            </div>
          </section>
        </>
      )}
    </div>
  );
}

export default function AsmarStore() {
  return (
    <I18nProvider>
      <GlobalStyle />
      <Store />
    </I18nProvider>
  );
}
