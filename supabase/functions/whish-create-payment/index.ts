/* Creates a Whish Pay checkout for an existing order and returns the URL to
 * send the customer to.
 *
 * Runs server-side so WHISH_SECRET never reaches the browser.
 *
 * Deploy:  supabase functions deploy whish-create-payment
 * Secrets: supabase secrets set WHISH_API_URL=... WHISH_CHANNEL=... \
 *                               WHISH_SECRET=... PUBLIC_SITE_URL=https://...
 */
import { createClient } from "jsr:@supabase/supabase-js@2";

const cors = {
  "Access-Control-Allow-Origin": Deno.env.get("PUBLIC_SITE_URL") ?? "*",
  "Access-Control-Allow-Headers": "content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...cors, "content-type": "application/json" },
  });

/* ───────────────────────────────────────────────────────────────────────────
 * THE ONE PART THAT NEEDS WHISH'S DOCS.
 *
 * Ask Whish Pay for: the collect/create-payment endpoint, the auth header
 * they expect, the exact request fields, and which field in the response
 * holds the checkout URL. Then fix this function to match. Everything
 * else in this file and in whish-callback is provider-agnostic.
 *
 * The shape below is the common PSP pattern, NOT verified against Whish.
 * ─────────────────────────────────────────────────────────────────────────── */
async function createWhishCheckout(input: {
  amount: number;
  currency: string;
  reference: string;      // our payment_ref — comes back on the callback
  description: string;
  successUrl: string;
  failureUrl: string;
  callbackUrl: string;
}) {
  const res = await fetch(`${Deno.env.get("WHISH_API_URL")}/payment/whish`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      channel: Deno.env.get("WHISH_CHANNEL") ?? "",
      secret: Deno.env.get("WHISH_SECRET") ?? "",
    },
    body: JSON.stringify({
      amount: input.amount,
      currency: input.currency,
      invoice: input.description,
      externalId: input.reference,
      successCallbackUrl: input.successUrl,
      failureCallbackUrl: input.failureUrl,
      successRedirectUrl: input.successUrl,
      failureRedirectUrl: input.failureUrl,
      webhookUrl: input.callbackUrl,
    }),
  });

  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`Whish rejected the request: ${res.status} ${JSON.stringify(body)}`);

  const url = body?.data?.collectUrl ?? body?.collectUrl ?? body?.url;
  if (!url) throw new Error(`No checkout URL in Whish response: ${JSON.stringify(body)}`);
  return { url: url as string, providerRef: body?.data?.id ?? body?.id ?? null };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ error: "Use POST." }, 405);

  try {
    const { code } = await req.json();
    if (!code || typeof code !== "string") return json({ error: "Missing order code." }, 400);

    /* Service role: this function is trusted, the browser is not. */
    const db = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    const { data: order, error } = await db
      .from("orders").select("code,total,payment_status,payment_ref").eq("code", code).maybeSingle();
    if (error) throw error;
    if (!order) return json({ error: "Unknown order." }, 404);
    if (order.payment_status === "paid") return json({ error: "That order is already paid." }, 409);

    /* Amount comes from the database, never from the request body — otherwise
       a customer could ask to pay one dollar for a fifty dollar order. */
    const site = Deno.env.get("PUBLIC_SITE_URL")!;
    const reference = order.payment_ref ?? `${order.code}-${crypto.randomUUID().slice(0, 8)}`;

    const checkout = await createWhishCheckout({
      amount: Number(order.total),
      currency: "USD",
      reference,
      description: `The Asmar Store — order ${order.code}`,
      successUrl: `${site}/#/order/${order.code}`,
      failureUrl: `${site}/#/order/${order.code}`,
      callbackUrl: `${Deno.env.get("SUPABASE_URL")}/functions/v1/whish-callback`,
    });

    await db.from("orders").update({
      payment_provider: "whish",
      payment_status: "pending",
      payment_ref: reference,
    }).eq("code", order.code);

    return json({ url: checkout.url });
  } catch (e) {
    console.error(e);
    return json({ error: "Could not start the payment." }, 500);
  }
});
