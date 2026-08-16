/* Tells Ali an order arrived.
 *
 * The shop's delivery promise is "minutes", but until now nothing actually
 * reached him when an order was placed. The customer saw a "send this on
 * WhatsApp" button on the receipt screen and if they did not tap it — plenty do
 * not — the order sat in the database until he happened to open the admin. A
 * shop that promises minutes cannot depend on the customer remembering to
 * notify the shopkeeper.
 *
 * Called by a database trigger on insert into public.orders (see
 * supabase/notify.sql), not by the browser. It is invoked with the service
 * role key from inside Postgres, so nothing here trusts a caller.
 *
 * Telegram is the default channel: a bot takes two minutes to create, costs
 * nothing, needs no business verification, and delivers to a phone instantly.
 * WhatsApp Cloud API is supported too but needs a Meta Business account and an
 * approved template, so it is opt-in.
 *
 * Deploy:
 *   supabase functions deploy notify-order --no-verify-jwt
 *   supabase secrets set NOTIFY_SECRET=$(openssl rand -hex 32)
 *   supabase secrets set TELEGRAM_BOT_TOKEN=... TELEGRAM_CHAT_ID=...
 */

const NOTIFY_SECRET = Deno.env.get("NOTIFY_SECRET") ?? "";

const TELEGRAM_TOKEN = Deno.env.get("TELEGRAM_BOT_TOKEN") ?? "";
const TELEGRAM_CHAT = Deno.env.get("TELEGRAM_CHAT_ID") ?? "";

const WHATSAPP_TOKEN = Deno.env.get("WHATSAPP_TOKEN") ?? "";
const WHATSAPP_PHONE_ID = Deno.env.get("WHATSAPP_PHONE_ID") ?? "";
const WHATSAPP_TO = Deno.env.get("WHATSAPP_TO") ?? "";
const WHATSAPP_TEMPLATE = Deno.env.get("WHATSAPP_TEMPLATE") ?? "";

const money = (n: number) => `$${Number(n).toFixed(2)}`;

/* Telegram's HTML mode. The customer controls their own name and note, so both
   are escaped — an unescaped "<" in a note would otherwise break the message
   or, worse, let a customer inject markup into Ali's chat. */
const esc = (s: unknown) =>
  String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

type Item = { name?: string; label?: string; qty?: number; price?: number };
type Order = {
  code: string;
  total: number | string;
  status?: string;
  payment_status?: string;
  items?: Item[];
  customer?: { name?: string; phone?: string; email?: string; payment?: string; notes?: string };
};

function buildMessage(o: Order) {
  const c = o.customer ?? {};
  const lines = (o.items ?? [])
    .map((i) => `• ${esc(i.name)} — ${esc(i.label)} ×${i.qty ?? 1}  ${money(Number(i.price ?? 0) * (i.qty ?? 1))}`)
    .join("\n");

  const payment =
    c.payment === "balance" ? "Paid from balance ✅"
    : c.payment === "online" ? "Online — awaiting payment"
    : "Cash on delivery";

  /* The phone number goes on its own line with no formatting around it so it
     stays tappable in the Telegram app — he calls straight from the message. */
  return [
    `🛒 <b>New order ${esc(o.code)}</b>`,
    "",
    lines,
    "",
    `<b>Total: ${money(Number(o.total))}</b>`,
    `Payment: ${payment}`,
    "",
    `👤 ${esc(c.name)}`,
    `📞 ${esc(c.phone)}`,
    `✉️ ${esc(c.email)}`,
    c.notes ? `\n📝 ${esc(c.notes)}` : "",
  ]
    .filter(Boolean)
    .join("\n");
}

async function sendTelegram(text: string) {
  if (!TELEGRAM_TOKEN || !TELEGRAM_CHAT) return { skipped: "telegram not configured" };
  const res = await fetch(`https://api.telegram.org/bot${TELEGRAM_TOKEN}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      chat_id: TELEGRAM_CHAT,
      text,
      parse_mode: "HTML",
      disable_web_page_preview: true,
    }),
  });
  if (!res.ok) throw new Error(`telegram ${res.status}: ${await res.text()}`);
  return { sent: "telegram" };
}

async function sendWhatsApp(order: Order) {
  if (!WHATSAPP_TOKEN || !WHATSAPP_PHONE_ID || !WHATSAPP_TO || !WHATSAPP_TEMPLATE) {
    return { skipped: "whatsapp not configured" };
  }
  /* Business-initiated messages must use a pre-approved template — free-form
     text is only allowed inside a 24-hour window opened by the other party,
     which does not exist here. Create a template with two variables: the order
     code and the total. */
  const res = await fetch(`https://graph.facebook.com/v21.0/${WHATSAPP_PHONE_ID}/messages`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${WHATSAPP_TOKEN}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      messaging_product: "whatsapp",
      to: WHATSAPP_TO,
      type: "template",
      template: {
        name: WHATSAPP_TEMPLATE,
        language: { code: "en" },
        components: [
          {
            type: "body",
            parameters: [
              { type: "text", text: order.code },
              { type: "text", text: money(Number(order.total)) },
            ],
          },
        ],
      },
    }),
  });
  if (!res.ok) throw new Error(`whatsapp ${res.status}: ${await res.text()}`);
  return { sent: "whatsapp" };
}

Deno.serve(async (req) => {
  if (req.method !== "POST") return new Response("Use POST.", { status: 405 });

  /* Deployed with --no-verify-jwt so Postgres can reach it, which means the URL
     is open to the internet. The shared secret is the only thing standing
     between that and anyone spamming Ali's phone. Fail closed. */
  if (!NOTIFY_SECRET || req.headers.get("x-notify-secret") !== NOTIFY_SECRET) {
    console.warn("Rejected an unauthenticated notify request.");
    return new Response(JSON.stringify({ error: "Unauthorized" }), {
      status: 401,
      headers: { "Content-Type": "application/json" },
    });
  }

  let order: Order;
  try {
    const body = await req.json();
    order = body.order ?? body;
    if (!order?.code) throw new Error("no order code");
  } catch (e) {
    return new Response(JSON.stringify({ error: `Bad request: ${e.message}` }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  const text = buildMessage(order);

  /* Both channels are attempted independently: if WhatsApp's token has expired
     — which it does, Meta's tokens are short-lived — the Telegram message must
     still arrive. An order notification is not worth losing to a partial
     failure. */
  const results = await Promise.allSettled([sendTelegram(text), sendWhatsApp(order)]);

  const detail = results.map((r) =>
    r.status === "fulfilled" ? r.value : { error: String(r.reason?.message ?? r.reason) },
  );
  const delivered = results.some((r) => r.status === "fulfilled" && "sent" in r.value);

  if (!delivered) console.error("No notification channel delivered", detail);

  /* Always 200. The trigger runs inside the transaction that created the order;
     a non-2xx here must never be able to roll back a real customer's order just
     because a chat API was briefly down. */
  return new Response(JSON.stringify({ delivered, detail }), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
});
