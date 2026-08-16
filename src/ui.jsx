/* Shared design system for The Asmar Store.
 *
 * Colour lives in CSS custom properties rather than in the T object, so one
 * attribute on <html> repaints the whole shop. Fonts do the same, because the
 * Latin faces have no Arabic glyphs and have to swap under [dir="rtl"].
 */
import React, { createContext, useContext, useEffect, useRef, useState } from "react";
import { Check, ImagePlus, Loader2, Star, X } from "lucide-react";
import { DIR, LANG_KEY, readLang, translate } from "./i18n.js";

export const T = {
  bg:        "var(--bg)",
  bg2:       "var(--bg-2)",
  surface:   "var(--surface)",
  surface2:  "var(--surface-2)",
  line:      "var(--line)",
  ink:       "var(--ink)",
  inkSoft:   "var(--ink-soft)",
  brand:     "var(--brand)",
  brandText: "var(--brand-text)",
  tint:      "var(--tint)",
  tintDeep:  "var(--tint-deep)",
  rose:      "var(--rose)",
  ok:        "var(--ok)",
};

export const display = "var(--font-display)";
export const script  = "var(--font-script)";
export const ui      = "var(--font-ui)";

export const WRAP = 1180;

/* ------------------------------------------------------------------ helpers */
export const money = (n) => `$${Number(n).toFixed(2)}`;

export const emailOk = (s) => /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(s.trim());
export const phoneOk = (s) => s.replace(/\D/g, "").length >= 7;

export const slugify = (s) =>
  String(s).toLowerCase().trim().replace(/&/g, "and").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");

export const lowestPrice = (p) => Math.min(...(p.variants?.length ? p.variants : [{ price: 0 }]).map((v) => v.price));

/* Owner-written content comes in two versions. Arabic wins on an Arabic page,
   but only if it has actually been written — an untranslated field falls back
   to the English rather than going blank, so a half-translated shop still
   reads as a complete one. */
export const pick = (lang, base, ar) => (lang === "ar" && ar && String(ar).trim() ? ar : base);

/* A discount only counts when the old price is genuinely higher. */
export const discountPct = (v) =>
  v?.compareAt && v.compareAt > v.price ? Math.round((1 - v.price / v.compareAt) * 100) : 0;

export const hasOffer = (p) => (p.variants || []).some((v) => discountPct(v) > 0);

/* --------------------------------------------------------------------- i18n */
const I18nContext = createContext({ lang: "en", dir: "ltr", t: (k, v) => translate("en", k, v) });
export const useT = () => useContext(I18nContext);

export function I18nProvider({ children }) {
  const [lang, setLang] = useState(readLang);

  useEffect(() => {
    const el = document.documentElement;
    el.setAttribute("lang", lang);
    el.setAttribute("dir", DIR[lang]);
    try { localStorage.setItem(LANG_KEY, lang); } catch { /* private mode */ }
  }, [lang]);

  const value = {
    lang,
    dir: DIR[lang],
    t: (key, vars) => translate(lang, key, vars),
    setLang,
    toggleLang: () => setLang((l) => (l === "ar" ? "en" : "ar")),
  };
  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

/* Prices and codes are Latin-script even in Arabic, so they get isolated from
   the surrounding right-to-left run or the "$" lands on the wrong side. */
export const Money = ({ v, style, className }) => (
  <span dir="ltr" className={className} style={{ unicodeBidi: "isolate", ...style }}>{money(v)}</span>
);

export const Ltr = ({ children, style, className }) => (
  <span dir="ltr" className={className} style={{ unicodeBidi: "isolate", ...style }}>{children}</span>
);

/* Owner-authored text can be Arabic or Latin whatever the page language is —
   product names, plan labels, category names. dir="auto" lets the browser
   resolve each string from its own first letter, so "1 month" does not come out
   as "month 1" on an Arabic page, while an Arabic label still reads correctly. */
export const Auto = ({ children, as: Tag = "span", style, ...rest }) => (
  <Tag dir="auto" style={{ unicodeBidi: "isolate", ...style }} {...rest}>{children}</Tag>
);

/* Chevron that always points the way the reader is going. */
export function Arrow({ size = 16, back = false, style, className }) {
  const { dir } = useT();
  const rtl = dir === "rtl";
  const forward = back ? !rtl : rtl;   // true => point left
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor"
      strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={style} className={className}
      aria-hidden="true">
      <polyline points={forward ? "15 18 9 12 15 6" : "9 18 15 12 9 6"} />
    </svg>
  );
}

/* ---------------------------------------------------------------- primitives */
export const Eyebrow = ({ children, style }) => (
  <p className="lbl" style={{ fontSize: 11, letterSpacing: ".24em", textTransform: "uppercase",
              color: T.rose, ...style }}>
    {children}
  </p>
);

export function SectionHead({ eyebrow, title, action }) {
  return (
    <div className="flex items-end justify-between gap-4 mb-5">
      <div>
        {eyebrow && <Eyebrow style={{ marginBottom: 10 }}>{eyebrow}</Eyebrow>}
        <h2 style={{ fontFamily: display, fontSize: "clamp(24px, 5vw, 34px)",
                     lineHeight: 1.2, fontWeight: 400, letterSpacing: "-.01em" }}>
          {title}
        </h2>
      </div>
      {action}
    </div>
  );
}

export const Monogram = ({ name, size = 52 }) => (
  <div className="flex items-center justify-center shrink-0"
    style={{ width: size, height: size, borderRadius: 8, background: T.tint,
             border: `1px solid ${T.line}`, fontFamily: display,
             fontSize: size * 0.42, color: T.brandText, lineHeight: 1 }}>
    {String(name || "?").trim().charAt(0).toUpperCase()}
  </div>
);

/* Product logo. Brand marks are drawn for light backgrounds, so the tile stays
   white in both themes — a Netflix logo on near-black would vanish. */
export const ProductMark = ({ src, name, size = 52 }) =>
  src ? (
    <img src={src} alt="" className="shrink-0"
      style={{ width: size, height: size, borderRadius: 8, objectFit: "contain",
               background: "#fff", border: `1px solid ${T.line}`,
               padding: Math.round(size * 0.1) }} />
  ) : (
    <Monogram name={name} size={size} />
  );

export const Field = ({ label, error, hint, as, ...rest }) => {
  const Tag = as === "textarea" ? "textarea" : "input";
  return (
    <label className="block">
      {label && (
        <span className="block mb-1.5 lbl" style={{ fontFamily: ui, fontSize: 11, letterSpacing: ".14em",
                                                textTransform: "uppercase", color: T.inkSoft }}>
          {label}
        </span>
      )}
      <Tag {...rest} aria-invalid={error ? true : undefined} className="w-full px-3.5 py-2.5 outline-none input"
        style={{ fontFamily: ui, fontSize: 15, color: T.ink, background: T.surface2,
                 border: `1px solid ${error ? T.brand : T.line}`, borderRadius: 8,
                 resize: as === "textarea" ? "vertical" : undefined }} />
      {error
        ? <span className="block mt-1.5" style={{ fontFamily: ui, fontSize: 12.5, color: T.brandText }}>{error}</span>
        : hint
          ? <span className="block mt-1.5" style={{ fontFamily: ui, fontSize: 12, color: T.inkSoft }}>{hint}</span>
          : null}
    </label>
  );
};

export const Btn = ({ children, variant = "solid", full, style, className = "", ...rest }) => {
  const base = {
    fontFamily: ui, fontSize: 13, fontWeight: 500, letterSpacing: ".1em",
    textTransform: "uppercase", padding: "12px 20px", borderRadius: 8,
    cursor: "pointer", display: "inline-flex", alignItems: "center",
    justifyContent: "center", gap: 8, lineHeight: 1.3,
  };
  const styles = {
    solid: { background: T.brand, color: "#fff", border: `1px solid ${T.brand}` },
    ghost: { background: "transparent", color: T.ink, border: `1px solid ${T.line}` },
    quiet: { background: T.surface2, color: T.ink, border: `1px solid ${T.line}` },
    dark:  { background: T.ink, color: T.bg, border: `1px solid ${T.ink}` },
  };
  return (
    <button {...rest} className={`btn press lbl ${className}`}
      style={{ ...base, ...styles[variant], width: full ? "100%" : undefined, ...style }}>
      {children}
    </button>
  );
};

export const EmptyState = ({ title, body }) => (
  <div className="py-20 text-center" style={{ color: T.inkSoft }}>
    <p style={{ fontFamily: display, fontSize: 22, marginBottom: 8, color: T.ink }}>{title}</p>
    <p style={{ fontSize: 14 }}>{body}</p>
  </div>
);

/* ------------------------------------------------------------------- stars */
export function Stars({ value = 0, size = 13, showValue = false }) {
  const full = Math.round(value);
  return (
    <span className="inline-flex items-center gap-0.5" dir="ltr" style={{ unicodeBidi: "isolate" }}>
      {[1, 2, 3, 4, 5].map((i) => (
        <Star key={i} size={size} style={{ color: i <= full ? "#E8B341" : T.line }}
          fill={i <= full ? "#E8B341" : "none"} />
      ))}
      {showValue && value > 0 && (
        <span style={{ fontSize: size, color: T.inkSoft, marginInlineStart: 5 }}>{value.toFixed(1)}</span>
      )}
    </span>
  );
}

export const avgRating = (list) =>
  list.length ? list.reduce((s, r) => s + (Number(r.rating) || 5), 0) / list.length : 0;

/* --------------------------------------------------------------- rich text */
/* Admin writes plain text. Lines beginning "## " are headings, "- " become
   ticked bullets, blank lines split paragraphs. Deliberately not Markdown —
   the shop owner should not have to learn a syntax to write a refund policy.
 *
 * Every block carries dir="auto": the owner may write a description in English
 * on an Arabic page or the reverse, and each block should read in whichever
 * direction its own text is written. */
export function RichText({ text, muted }) {
  const lines = String(text || "").split("\n");
  const out = [];
  let para = [];

  const flush = (key) => {
    if (!para.length) return;
    out.push(
      <p key={`p${key}`} dir="auto"
        style={{ fontSize: 14.5, lineHeight: 1.9, color: muted ? T.inkSoft : T.ink, marginBottom: 14 }}>
        {para.join(" ")}
      </p>
    );
    para = [];
  };

  lines.forEach((raw, i) => {
    const line = raw.trim();
    if (!line) { flush(i); return; }
    if (line.startsWith("## ")) {
      flush(i);
      out.push(
        <h3 key={`h${i}`} dir="auto"
          style={{ fontFamily: display, fontSize: 21, lineHeight: 1.5,
                   marginTop: out.length ? 26 : 0, marginBottom: 10 }}>
          {line.slice(3)}
        </h3>
      );
      return;
    }
    if (line.startsWith("- ")) {
      flush(i);
      out.push(
        <span key={`l${i}`} dir="auto" className="flex items-start gap-2.5" style={{ marginBottom: 9 }}>
          <Check size={15} className="shrink-0" style={{ color: T.ok, marginTop: 4 }} />
          <span style={{ fontSize: 14.5, lineHeight: 1.75, color: muted ? T.inkSoft : T.ink }}>{line.slice(2)}</span>
        </span>
      );
      return;
    }
    para.push(line);
  });
  flush("end");
  return <>{out}</>;
}

/* ----------------------------------------------------------- payment marks */
/* Real card marks read as legitimacy far more than the words "Visa, Mastercard"
   do. Kept on white tiles so they survive the dark theme. */
const payTile = {
  height: 26, minWidth: 42, borderRadius: 5, background: "#fff", border: "1px solid rgba(0,0,0,.09)",
  display: "inline-flex", alignItems: "center", justifyContent: "center", padding: "0 7px",
};

export function PayMarks({ className = "" }) {
  return (
    <div className={`flex flex-wrap items-center gap-1.5 ${className}`} dir="ltr">
      <span style={payTile} title="Visa">
        <svg width="34" height="11" viewBox="0 0 48 16" aria-label="Visa">
          <text x="0" y="13" fontFamily="Arial, Helvetica, sans-serif" fontSize="15"
            fontWeight="700" fontStyle="italic" fill="#1A1F71" letterSpacing="0.5">VISA</text>
        </svg>
      </span>
      <span style={payTile} title="Mastercard">
        <svg width="30" height="19" viewBox="0 0 40 25" aria-label="Mastercard">
          <circle cx="15" cy="12.5" r="9.5" fill="#EB001B" />
          <circle cx="25" cy="12.5" r="9.5" fill="#F79E1B" fillOpacity=".85" />
        </svg>
      </span>
      <span style={{ ...payTile, background: "#25D366" }} title="Whish Money">
        <span style={{ fontSize: 10.5, fontWeight: 700, color: "#fff", letterSpacing: ".02em" }}>whish</span>
      </span>
      <span style={payTile} title="OMT">
        <span style={{ fontSize: 10.5, fontWeight: 800, color: "#E4002B", letterSpacing: ".04em" }}>OMT</span>
      </span>
      <span style={payTile} title="Cash">
        <span style={{ fontSize: 10, fontWeight: 700, color: "#1E1315", letterSpacing: ".04em" }}>CASH</span>
      </span>
    </div>
  );
}

/* ------------------------------------------------------------ image pickers */
/* Logos live inside the product record, so they have to stay small — downscale
   and re-encode rather than keeping the original file. */
export const MAX_LOGO_PX = 256;
export const MAX_COVER_PX = 640;

export function readImageFile(file, maxPx = MAX_LOGO_PX, quality = 0.9) {
  return new Promise((resolve, reject) => {
    if (!file.type.startsWith("image/")) return reject(new Error("That file isn’t an image."));
    const reader = new FileReader();
    reader.onerror = () => reject(new Error("Could not read that file."));
    reader.onload = () => {
      const img = new Image();
      img.onerror = () => reject(new Error("That image is damaged or unsupported."));
      img.onload = () => {
        const scale = Math.min(1, maxPx / Math.max(img.width, img.height));
        const w = Math.max(1, Math.round(img.width * scale));
        const h = Math.max(1, Math.round(img.height * scale));
        const canvas = document.createElement("canvas");
        canvas.width = w; canvas.height = h;
        canvas.getContext("2d").drawImage(img, 0, 0, w, h);
        resolve(canvas.toDataURL("image/webp", quality));
      };
      img.src = reader.result;
    };
    reader.readAsDataURL(file);
  });
}

export function LogoPicker({ product, onChange }) {
  const inputRef = useRef(null);
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);

  const pick = async (e) => {
    const file = e.target.files?.[0];
    e.target.value = ""; // let the same file be chosen again after a removal
    if (!file) return;
    setBusy(true); setErr("");
    try { onChange(await readImageFile(file)); }
    catch (ex) { setErr(ex.message); }
    finally { setBusy(false); }
  };

  const chip = {
    fontSize: 12, letterSpacing: ".06em", textTransform: "uppercase",
    border: `1px solid ${T.line}`, borderRadius: 8, padding: "7px 12px", background: T.surface,
  };

  return (
    <div>
      <span className="lbl" style={{ fontSize: 11, letterSpacing: ".14em", textTransform: "uppercase", color: T.inkSoft }}>Logo</span>
      <div className="flex items-center gap-3 mt-2">
        <ProductMark src={product.image} name={product.name || "?"} size={52} />
        <div className="flex flex-wrap gap-1.5">
          <button onClick={() => inputRef.current?.click()} disabled={busy}
            className="flex items-center gap-1.5 press" style={{ ...chip, color: T.brandText }}>
            {busy ? <Loader2 size={13} className="animate-spin" /> : <ImagePlus size={13} />}
            {product.image ? "Replace" : "Upload logo"}
          </button>
          {product.image && (
            <button onClick={() => { onChange(""); setErr(""); }}
              className="flex items-center gap-1.5 press" style={{ ...chip, color: T.rose }}>
              <X size={13} /> Remove
            </button>
          )}
        </div>
        <input ref={inputRef} type="file" accept="image/*" onChange={pick} style={{ display: "none" }} />
      </div>
      {err
        ? <p style={{ fontSize: 12, color: T.brandText, marginTop: 8 }}>{err}</p>
        : <p style={{ fontSize: 11.5, color: T.inkSoft, marginTop: 8 }}>
            PNG, JPG or WEBP. Scaled to {MAX_LOGO_PX}px — a transparent PNG looks best.
          </p>}
    </div>
  );
}

/* Compact cover control for a category row — click the thumbnail to pick, the
   × to clear. Wider than a logo, so it is encoded at a larger size. */
export function CoverPicker({ value, name, onChange }) {
  const inputRef = useRef(null);
  const [busy, setBusy] = useState(false);

  const pick = async (e) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    setBusy(true);
    try { onChange(await readImageFile(file, MAX_COVER_PX, 0.82)); }
    catch { /* ignored — the thumbnail simply stays as it was */ }
    finally { setBusy(false); }
  };

  return (
    <div className="relative shrink-0">
      <button onClick={() => inputRef.current?.click()} disabled={busy}
        aria-label={`Cover image for ${name || "category"}`}
        className="flex items-center justify-center overflow-hidden press"
        style={{ width: 64, height: 42, borderRadius: 8, background: T.tint,
                 border: `1px solid ${T.line}`, padding: 0 }}>
        {busy
          ? <Loader2 size={14} className="animate-spin" style={{ color: T.brandText }} />
          : value
            ? <img src={value} alt="" style={{ width: "100%", height: "100%", objectFit: "cover" }} />
            : <ImagePlus size={15} style={{ color: T.rose }} />}
      </button>
      {value && !busy && (
        <button onClick={() => onChange("")} aria-label="Remove cover"
          className="absolute flex items-center justify-center"
          style={{ top: -6, insetInlineEnd: -6, width: 18, height: 18, borderRadius: 9,
                   background: T.brand, color: "#fff", border: `1px solid ${T.bg}` }}>
          <X size={11} />
        </button>
      )}
      <input ref={inputRef} type="file" accept="image/*" onChange={pick} style={{ display: "none" }} />
    </div>
  );
}
