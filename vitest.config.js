import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  test: {
    /* Blanked deliberately, and this matters more than it looks.
     *
     * Vitest loads .env.local like any other Vite process, so the moment real
     * Supabase keys existed the unit tests started running against the live
     * shop: the suite failed with the server's own "Sign in to place an order",
     * and a test that inserted rather than read would have written real rows
     * into production.
     *
     * These tests exist to exercise the localStorage implementation, which is
     * what runs before the keys are configured. Forcing the keys empty keeps
     * that true regardless of who has a .env.local. The real database is
     * covered by the Playwright suite instead. */
    env: {
      VITE_SUPABASE_URL: "",
      VITE_SUPABASE_ANON_KEY: "",
    },
    /* The default "forks" pool cannot start a worker from this project path —
       it sits under OneDrive and the folder name has a space in it, which the
       fork bootstrap does not survive. Threads start fine. */
    pool: "threads",
    environment: "jsdom",
    globals: true,
    setupFiles: ["./tests/setup.js"],
    include: ["tests/**/*.test.{js,jsx}"],
    /* Playwright drives a real browser and has its own runner. */
    exclude: ["tests/e2e/**", "node_modules/**"],
  },
});
