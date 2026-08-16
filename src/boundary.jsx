/* Crash handling for The Asmar Store.
 *
 * Without this a single thrown render error unmounts the whole tree and the
 * customer is left staring at a white page — no message, no way back, and no
 * signal to Ali that it happened. A shop that fails silently loses the sale
 * twice: once now, and again because nobody ever finds out.
 *
 * The fallback is deliberately plain HTML and inline colour. Whatever broke may
 * well be the design system itself, so this file must not depend on it.
 */
import React from "react";

/* Where errors go. Set VITE_ERROR_WEBHOOK to a URL that accepts a JSON POST —
   a Supabase Edge Function, a Netlify function, a Discord/Slack webhook. Left
   blank, errors are logged to the console and nothing is sent. */
const ERROR_WEBHOOK = import.meta.env.VITE_ERROR_WEBHOOK || "";

/* Reporting must never be able to break the page harder than the original
   error did, so every failure here is swallowed on purpose. */
export function reportError(error, info = {}) {
  const payload = {
    message: String(error?.message || error),
    stack: String(error?.stack || "").slice(0, 4000),
    componentStack: String(info?.componentStack || "").slice(0, 2000),
    url: typeof location !== "undefined" ? location.href : "",
    userAgent: typeof navigator !== "undefined" ? navigator.userAgent : "",
    at: new Date().toISOString(),
  };
  console.error("[asmar] crash", payload);
  if (!ERROR_WEBHOOK) return;
  try {
    /* keepalive so the report still goes out if this was a navigation that
       took the page down with it. */
    fetch(ERROR_WEBHOOK, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
      keepalive: true,
    }).catch(() => {});
  } catch { /* offline, blocked by an extension, CSP — never mind */ }
}

/* Errors thrown outside React's render cycle — an await in an event handler, a
   bad response parsed in a promise — never reach a boundary, so catch them at
   the window level too. */
export function installGlobalErrorHandlers() {
  if (typeof window === "undefined" || window.__asmarErrorHandlers) return;
  window.__asmarErrorHandlers = true;
  window.addEventListener("error", (e) => reportError(e.error || e.message));
  window.addEventListener("unhandledrejection", (e) => reportError(e.reason));
}

export class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { error: null };
  }

  static getDerivedStateFromError(error) {
    return { error };
  }

  componentDidCatch(error, info) {
    reportError(error, info);
  }

  render() {
    if (!this.state.error) return this.props.children;

    /* "Try again" re-renders in place, which is enough for a transient failure
       — a product that arrived half-loaded, a settings blob that was mid-save.
       Reloading is the heavier option and gets its own button. */
    const retry = () => this.setState({ error: null });

    return (
      <div
        role="alert"
        style={{
          minHeight: "100vh",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          gap: 14,
          padding: "48px 24px",
          textAlign: "center",
          background: "#0C0A0B",
          color: "#F4ECEA",
          fontFamily: "system-ui, -apple-system, Segoe UI, sans-serif",
        }}
      >
        <div style={{ fontSize: 34, color: "#C4737F", fontFamily: "Georgia, serif" }}>Asmar</div>
        <h1 style={{ fontSize: 21, fontWeight: 500, margin: 0 }}>Something went wrong on our side.</h1>
        <p style={{ fontSize: 14, lineHeight: 1.7, color: "#A08D91", maxWidth: 380, margin: 0 }}>
          Your cart is safe. Try again, and if it keeps happening message us on WhatsApp and we
          will sort the order out by hand.
        </p>
        <div style={{ display: "flex", gap: 10, flexWrap: "wrap", justifyContent: "center", marginTop: 10 }}>
          <button
            onClick={retry}
            style={{
              padding: "11px 22px", borderRadius: 10, border: "none", cursor: "pointer",
              background: "#9B1B30", color: "#fff", fontSize: 14, fontFamily: "inherit",
            }}
          >
            Try again
          </button>
          <button
            onClick={() => window.location.reload()}
            style={{
              padding: "11px 22px", borderRadius: 10, cursor: "pointer",
              border: "1px solid #2A2225", background: "transparent", color: "#F4ECEA",
              fontSize: 14, fontFamily: "inherit",
            }}
          >
            Reload the page
          </button>
        </div>

        {import.meta.env.DEV && (
          <pre
            style={{
              marginTop: 22, maxWidth: "min(90vw, 720px)", overflow: "auto", textAlign: "left",
              fontSize: 11.5, lineHeight: 1.6, color: "#A08D91", background: "#141011",
              border: "1px solid #2A2225", borderRadius: 10, padding: 14,
            }}
          >
            {String(this.state.error?.stack || this.state.error)}
          </pre>
        )}
      </div>
    );
  }
}
