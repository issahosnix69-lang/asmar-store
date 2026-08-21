import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

/* Replit sets several of these; any one of them means we are in a repl rather
   than on a laptop. Checking more than one because which are present has
   changed between Replit's generations, and getting this wrong means the dev
   server binds localhost and the webview just spins forever. */
const onReplit = Boolean(
  process.env.REPL_ID || process.env.REPLIT_DEV_DOMAIN || process.env.REPL_SLUG,
);

/* Set by the Playwright run. The end-to-end suite drives the localStorage
   implementation — it seeds accounts and balances directly — so it needs a
   build that ignores whatever real keys happen to be in .env.local. Without
   this the suite silently starts testing the live shop, fails on a test account
   that does not exist there, and any test that wrote would write to production.
   Overriding through `define` rather than env vars because it is unambiguous:
   the values are substituted at build time and nothing can shadow them. */
const forceLocal = Boolean(process.env.ASMAR_FORCE_LOCAL);

/* GitHub Pages serves a project site from /<repo>/, not the domain root, so the
   asset URLs Vite writes into index.html have to carry that prefix or every one
   of them 404s and the page renders as a bare background.

   Set by .github/workflows/deploy.yml and nowhere else. Netlify, Cloudflare
   Pages, `npm run dev` and the Playwright suite all serve from the root and
   leave it unset, so they keep a plain "/" and are untouched by any of this.
   src/paths.js reads the same value back at runtime for the shop's own links. */
const base = process.env.ASMAR_BASE || "/";

export default defineConfig({
  base,

  plugins: [react(), tailwindcss()],

  ...(forceLocal
    ? {
        define: {
          "import.meta.env.VITE_SUPABASE_URL": '""',
          "import.meta.env.VITE_SUPABASE_ANON_KEY": '""',
        },
      }
    : {}),

  server: {
    port: 5173,
    /* Vite's default is to walk up to the next free port when 5173 is taken —
       fine on a laptop, wrong here. .replit maps 5173 to the repl's public URL,
       so a server that quietly moved to 5186 is a server the webview cannot
       find, with nothing in the output saying why. Fail loudly instead: the
       error names the port, and killing the stale process is obvious. */
    strictPort: onReplit,
    /* 0.0.0.0 in a container: bound to localhost, Replit's proxy cannot reach
       the server at all. */
    host: onReplit ? "0.0.0.0" : "localhost",
    /* No browser to open inside a container. */
    open: !onReplit,
    ...(onReplit
      ? {
          /* Vite rejects unknown Host headers by default — genuine protection
             against DNS rebinding, and the right default on a laptop where the
             dev server shares a network with other machines.

             Replit serves each repl from a generated subdomain that changes
             between repls and between Replit's URL schemes, so an allowlist
             here is a standing source of "Blocked request. This host is not
             allowed." For a dev server that only exists inside an ephemeral
             container, reachable only through Replit's own authenticated
             proxy, the check is not buying anything. Off, and only here —
             local development keeps the protection. */
          allowedHosts: true,
          /* The browser reaches the repl over HTTPS on 443, not port 5173
             directly, so the hot-reload socket has to be told where to connect
             or every edit needs a manual refresh. */
          hmr: { clientPort: 443, protocol: "wss" },
        }
      : {}),
  },

  preview: {
    port: 4173,
    host: onReplit ? "0.0.0.0" : "localhost",
    ...(onReplit ? { allowedHosts: true } : {}),
  },

  build: {
    rollupOptions: {
      output: {
        /* React changes when React changes, which is roughly never; the shop
           changes whenever Ali edits it. Keeping them in separate files means a
           copy edit does not invalidate the 140 KB of framework a returning
           customer already has cached.

           Supabase is not listed here on purpose — it is reached through a
           dynamic import in src/backend.js, so Rollup already gives it its own
           chunk that only downloads when the keys are configured. */
        manualChunks: {
          react: ["react", "react-dom"],
        },
      },
    },
  },
});
