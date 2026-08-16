/* Analytics for The Asmar Store.
 *
 * Ali cannot currently tell which products people open and then abandon, which
 * is the one number that would tell him what to stock and what to reprice.
 *
 * Plausible and Umami are both cookieless and do not collect personal data, so
 * neither needs a consent banner under GDPR-style rules — that is the whole
 * reason for choosing them over Google Analytics on a shop whose checkout
 * already handles names, phone numbers and payment receipts.
 *
 * Nothing loads until VITE_ANALYTICS_DOMAIN is set, so a fresh clone and the
 * local dev server stay completely untracked.
 */
const PROVIDER = import.meta.env.VITE_ANALYTICS_PROVIDER || "plausible";
const DOMAIN = import.meta.env.VITE_ANALYTICS_DOMAIN || "";
const HOST = import.meta.env.VITE_ANALYTICS_HOST || "";

export const analyticsEnabled = Boolean(DOMAIN);

export function installAnalytics() {
  if (!analyticsEnabled) return;
  if (document.getElementById("asmar-analytics")) return;

  const s = document.createElement("script");
  s.id = "asmar-analytics";
  s.defer = true;

  if (PROVIDER === "umami") {
    s.src = `${HOST || "https://cloud.umami.is"}/script.js`;
    s.setAttribute("data-website-id", DOMAIN);
  } else {
    /* "manual" so the script does not auto-fire a pageview on load. The shop is
       a single page whose URL changes without a document load, so pageviews are
       sent by trackPageview() below instead — otherwise every route after the
       first would go unrecorded. */
    s.src = `${HOST || "https://plausible.io"}/js/script.manual.js`;
    s.setAttribute("data-domain", DOMAIN);
  }

  document.head.appendChild(s);
}

/* Both providers queue calls made before their script finishes downloading, so
   these are safe to call immediately. */
export function trackPageview(url) {
  if (!analyticsEnabled) return;
  try {
    if (PROVIDER === "umami") {
      window.umami?.track?.((props) => ({ ...props, url }));
    } else {
      window.plausible = window.plausible || function (...a) {
        (window.plausible.q = window.plausible.q || []).push(a);
      };
      window.plausible("pageview", { u: location.origin + url });
    }
  } catch { /* blocked by an ad blocker, which is fine */ }
}

/* Named events for the funnel that actually matters: how many people add to
   cart, how many reach checkout, how many finish. Never pass anything
   identifying — no names, no emails, no order codes. */
export function trackEvent(name, props) {
  if (!analyticsEnabled) return;
  try {
    if (PROVIDER === "umami") window.umami?.track?.(name, props);
    else window.plausible?.(name, props ? { props } : undefined);
  } catch { /* ignore */ }
}
