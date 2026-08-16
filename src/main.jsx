import React from "react";
import { createRoot } from "react-dom/client";
import "./index.css";
import AsmarStore from "../asmar-store.jsx";
import { ErrorBoundary, installGlobalErrorHandlers } from "./boundary.jsx";
import { installAnalytics } from "./analytics.js";

/* Persistence lives in src/backend.js — Supabase when configured,
   browser localStorage otherwise. */

document.body.style.margin = "0";

/* Both are no-ops until their env vars are set, so a fresh clone stays silent. */
installGlobalErrorHandlers();
installAnalytics();

createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    {/* Outside AsmarStore on purpose: if the theme or i18n provider is what
        threw, a boundary nested inside them would go down with them. */}
    <ErrorBoundary>
      <AsmarStore />
    </ErrorBoundary>
  </React.StrictMode>
);
