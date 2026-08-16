/* Receives Whish Pay's server-to-server notification that a payment settled.
 *
 * This endpoint is public — anyone on the internet can POST to it. Treat every
 * request as hostile until proven otherwise:
 *
 *   1. verify the shared secret / signature Whish sends
 *   2. re-read the amount from OUR database, never trust the body
 *   3. record the event id so a retry cannot pay the same order twice
 *
 * Deploy: supabase functions deploy whish-callback --no-verify-jwt
 *         (--no-verify-jwt because Whish will not send a Supabase JWT)
 */
import { createClient } from "jsr:@supabase/supabase-js@2";

/* ───────────────────────────────────────────────────────────────────────────
 * NEEDS WHISH'S DOCS: ask them how they authenticate the callback. Most PSPs
 * do one of two things — a static shared secret in a header, or an HMAC
 * signature over the raw body. Implement whichever they use.
 *
 * Do not skip this. Without it, anyone who learns this URL can mark any
 * order paid by POSTing a JSON body.
 * ─────────────────────────────────────────────────────────────────────────── */
function callbackIsAuthentic(req: Request, _rawBody: string): boolean {
  const expected = Deno.env.get("WHISH_CALLBACK_SECRET");
  if (!expected) return false;                       // fail closed, never open
  const given = req.headers.get("secret") ?? req.headers.get("x-whish-signature");
  return given === expected;

  // If Whish signs instead, replace the two lines above with an HMAC compare:
  //   const mac = createHmac("sha256", expected).update(_rawBody).digest("hex");
  //   return timingSafeEqual(mac, given);
}

Deno.serve(async (req) => {
  if (req.method !== "POST") return new Response("Use POST.", { status: 405 });

  const raw = await req.text();

  if (!callbackIsAuthentic(req, raw)) {
    console.warn("Rejected an unauthenticated payment callback.");
    return new Response("Forbidden", { status: 403 });
  }

  let body: Record<string, unknown>;
  try { body = JSON.parse(raw); } catch { return new Response("Bad JSON", { status: 400 }); }

  /* Field names below are the likely ones — confirm against Whish's payload. */
  const reference  = (body.externalId ?? body.reference ?? body.external_id) as string | undefined;
  const externalId = String(body.id ?? body.transactionId ?? reference ?? "");
  const status     = String(body.status ?? body.state ?? "").toLowerCase();
  const amount     = Number(body.amount ?? 0);

  if (!reference) return new Response("Missing reference", { status: 400 });

  const db = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  const { data: order } = await db
    .from("orders").select("code,total").eq("payment_ref", reference).maybeSingle();
  if (!order) {
    console.warn("Callback for unknown reference", reference);
    return new Response("ok", { status: 200 });   // 200 so Whish stops retrying
  }

  const settled = ["success", "successful", "paid", "completed", "approved"].includes(status);
  if (!settled) {
    await db.from("orders").update({ payment_status: "failed" }).eq("code", order.code);
    return new Response("ok", { status: 200 });
  }

  /* mark_order_paid is idempotent and re-checks the amount against the order. */
  const { data: applied, error } = await db.rpc("mark_order_paid", {
    p_code: order.code,
    p_provider: "whish",
    p_external_id: externalId,
    p_amount: amount,
    p_payload: body,
  });

  if (error) {
    console.error("mark_order_paid failed", error);
    return new Response("error", { status: 500 });   // let Whish retry
  }

  console.log(`Order ${order.code}: ${applied ? "marked paid" : "ignored (duplicate or short payment)"}`);
  return new Response("ok", { status: 200 });
});
