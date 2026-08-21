/* Where the shop is mounted.
 *
 * Netlify, Cloudflare Pages and the dev server all serve from the domain root,
 * so a link to "/track" is simply "/track". GitHub Pages serves a project site
 * from https://<user>.github.io/<repo>/ instead, and there the same link has to
 * be "/asmar-store/track" — the bare one lands on the domain root, which is a
 * different site entirely and answers with GitHub's own 404 rather than ours.
 *
 * Vite already knows the answer: `base` in vite.config.js is handed to the
 * bundle as import.meta.env.BASE_URL. Reading it here rather than hard-coding
 * the repo name means the same source deploys to either kind of host, and the
 * whole thing collapses to a no-op wherever BASE_URL is "/" — which is every
 * environment except Pages, including the test suite.
 *
 * Two directions, and both are needed:
 *   U()      app path  -> browser URL   ("/track" -> "/asmar-store/track")
 *   unbase() browser URL -> app path    ("/asmar-store/track" -> "/track")
 *
 * The router thinks entirely in app paths. The prefix exists only at the edges:
 * href attributes, history entries, and reading location.pathname back.
 */

/* No trailing slash, so BASE + "/track" concatenates cleanly. "/" becomes ""
   and every function below degrades to identity. */
export const BASE = String(import.meta.env?.BASE_URL || "/").replace(/\/+$/, "");

/** App path -> the URL to put in an href or a history entry. */
export function U(path) {
  if (!BASE || typeof path !== "string" || !path.startsWith("/")) return path;
  return BASE + path;
}

/** location.pathname -> the app path the router matches on. */
export function unbase(pathname) {
  if (!BASE || typeof pathname !== "string") return pathname;
  /* Exactly the base, with or without its trailing slash, is the homepage. */
  if (pathname === BASE || pathname === BASE + "/") return "/";
  return pathname.startsWith(BASE + "/") ? pathname.slice(BASE.length) : pathname;
}
