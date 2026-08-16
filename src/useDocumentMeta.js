/* Keeps <head> in step with the route.
 *
 * The prerendered HTML already carries the right tags for a crawler that never
 * runs JavaScript. This is for everyone else: once React takes over navigation,
 * the document title and the link-preview tags have to be updated by hand or
 * every page after the first inherits the homepage's.
 *
 * That matters here more than on most shops. Customers share product links into
 * WhatsApp constantly, and WhatsApp reads og:title and og:image off the URL it
 * is given — a stale tag means every product someone shares previews as the
 * generic storefront card.
 */
import { useEffect } from "react";
import { metaFor } from "./seo.js";

/* Reuses one element per tag instead of appending a new one on every
   navigation, which would otherwise leave a trail of dead <meta> tags. */
function setMeta(attr, key, content) {
  let el = document.head.querySelector(`meta[${attr}="${key}"]`);
  if (!el) {
    el = document.createElement("meta");
    el.setAttribute(attr, key);
    document.head.appendChild(el);
  }
  el.setAttribute("content", content);
}

function setLink(rel, href) {
  let el = document.head.querySelector(`link[rel="${rel}"]`);
  if (!el) {
    el = document.createElement("link");
    el.setAttribute("rel", rel);
    document.head.appendChild(el);
  }
  el.setAttribute("href", href);
}

const JSONLD_ID = "asmar-jsonld";

export function useDocumentMeta(route, data, lang) {
  /* `data` is a fresh object every render, so the effect keys off the values
     that actually change the output rather than off the object identity. */
  const catalogLength = data?.catalog?.length ?? 0;
  const settingsStamp = data?.settings?.heroTitle ?? "";

  useEffect(() => {
    const m = metaFor(route, data);

    document.title = m.title;
    setMeta("name", "description", m.description);
    setLink("canonical", m.canonical);

    setMeta("property", "og:title", m.title);
    setMeta("property", "og:description", m.description);
    setMeta("property", "og:url", m.canonical);
    setMeta("property", "og:image", m.image);
    setMeta("property", "og:type", route.startsWith("/p/") ? "product" : "website");
    setMeta("property", "og:locale", lang === "ar" ? "ar_LB" : "en_US");

    setMeta("name", "twitter:title", m.title);
    setMeta("name", "twitter:description", m.description);
    setMeta("name", "twitter:image", m.image);

    /* Account, checkout and order pages are personal or thin — keeping them out
       of the index protects customers and stops them competing with the
       product pages that should be ranking. */
    if (m.noindex) setMeta("name", "robots", "noindex, nofollow");
    else setMeta("name", "robots", "index, follow");

    document.getElementById(JSONLD_ID)?.remove();
    if (m.jsonLd?.length) {
      const s = document.createElement("script");
      s.id = JSONLD_ID;
      s.type = "application/ld+json";
      s.textContent = JSON.stringify(m.jsonLd.length === 1 ? m.jsonLd[0] : m.jsonLd);
      document.head.appendChild(s);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [route, lang, catalogLength, settingsStamp]);
}
