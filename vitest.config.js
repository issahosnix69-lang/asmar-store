import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  test: {
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
