import { defineConfig, devices } from "@playwright/test";

/* Runs against the production build, not the dev server, because the things
   most worth catching here only exist in the built output: the prerendered
   per-page <head>, the SPA fallback, and the code-split chunks. */
export default defineConfig({
  testDir: "./tests/e2e",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  reporter: process.env.CI ? "github" : "list",

  use: {
    baseURL: "http://127.0.0.1:4173",
    trace: "on-first-retry",
    screenshot: "only-on-failure",
  },

  projects: [
    { name: "desktop", use: { ...devices["Desktop Chrome"] } },
    /* Nearly every customer here is on a phone, so the mobile viewport is not
       an afterthought — it is the primary one. */
    { name: "mobile", use: { ...devices["Pixel 7"] } },
  ],

  /* Build, then serve dist/ the way Netlify resolves it — static file, then
     directory index, then the SPA fallback. `vite preview` applies its SPA
     fallback first, which hides the prerendered pages entirely and would make
     these tests pass against a site that is broken in production. */
  webServer: {
    command: "npm run build && node scripts/serve-dist.mjs",
    url: "http://127.0.0.1:4173/",
    reuseExistingServer: !process.env.CI,
    timeout: 240_000,
    stdout: "pipe",
  },
});
