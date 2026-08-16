/* A static server for dist/ that behaves the way Netlify does.
 *
 * `vite preview` cannot be used for the end-to-end run: its SPA fallback
 * rewrites every unknown path to the root index.html *before* looking for a
 * matching file, so /p/netflix is served the homepage's head and the whole
 * prerender step appears to have done nothing.
 *
 * Netlify's order is the opposite, and it is the order that matters:
 *   1. an exact file            -> /robots.txt
 *   2. a directory index        -> /p/netflix  ->  dist/p/netflix/index.html
 *   3. the SPA fallback, 200    -> /account    ->  dist/index.html
 *
 * Used by playwright.config.js. Not part of the deployed site.
 */
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const DIST = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "dist");
const PORT = Number(process.env.PORT || 4173);

const TYPES = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".xml": "application/xml; charset=utf-8",
  ".txt": "text/plain; charset=utf-8",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".svg": "image/svg+xml",
  ".webp": "image/webp",
  ".ico": "image/x-icon",
};

const send = (res, status, body, file) => {
  res.writeHead(status, {
    "Content-Type": TYPES[path.extname(file || "")] || "application/octet-stream",
    /* Mirrors netlify.toml so a caching mistake shows up here too. */
    "Cache-Control": file?.includes(`${path.sep}assets${path.sep}`)
      ? "public, max-age=31536000, immutable"
      : "public, max-age=0, must-revalidate",
    "X-Content-Type-Options": "nosniff",
    "X-Frame-Options": "SAMEORIGIN",
    "Referrer-Policy": "strict-origin-when-cross-origin",
  });
  res.end(body);
};

const readIfFile = (p) => {
  try {
    return fs.statSync(p).isFile() ? fs.readFileSync(p) : null;
  } catch {
    return null;
  }
};

http
  .createServer((req, res) => {
    const url = new URL(req.url, "http://localhost");
    /* Reject anything trying to climb out of dist/. */
    const rel = path.normalize(decodeURIComponent(url.pathname)).replace(/^([/\\])+/, "");
    const target = path.join(DIST, rel);
    if (!target.startsWith(DIST)) return send(res, 403, "Forbidden", ".txt");

    const exact = readIfFile(target);
    if (exact) return send(res, 200, exact, target);

    const index = path.join(target, "index.html");
    const dirIndex = readIfFile(index);
    if (dirIndex) return send(res, 200, dirIndex, index);

    const fallback = path.join(DIST, "index.html");
    return send(res, 200, fs.readFileSync(fallback), fallback);
  })
  .listen(PORT, "127.0.0.1", () => {
    console.log(`serving dist/ on http://127.0.0.1:${PORT} (netlify-style resolution)`);
  });
