/* Wires up order alerts.
 *
 * Telegram will not tell you your own chat id until you have sent the bot a
 * message — there is no API for "who owns this bot". So: message the bot once,
 * run this, and it finds the id and prints the two commands that finish the
 * setup.
 *
 * Usage:
 *   node scripts/setup-telegram.mjs <bot-token>
 *
 * The token is read from the command line and never written anywhere. It
 * belongs in Supabase secrets, which is server-side; it must NEVER become a
 * VITE_ variable, because Vite inlines those into the browser bundle and the
 * bot would then be controllable by anyone who views source.
 */
const token = process.argv[2] || process.env.TELEGRAM_BOT_TOKEN;

if (!token) {
  console.error(`
Usage: node scripts/setup-telegram.mjs <bot-token>

Get a token from @BotFather in Telegram: /newbot, then copy the line that
looks like 1234567890:AAE...
`);
  process.exit(1);
}

const api = (method) => `https://api.telegram.org/bot${token}/${method}`;

const me = await fetch(api("getMe")).then((r) => r.json());
if (!me.ok) {
  console.error("That token was rejected by Telegram:", me.description);
  process.exit(1);
}
console.log(`Bot: @${me.result.username} (${me.result.first_name})\n`);

const updates = await fetch(api("getUpdates")).then((r) => r.json());
const chats = new Map();
for (const u of updates.result || []) {
  const chat = u.message?.chat ?? u.channel_post?.chat ?? u.my_chat_member?.chat;
  if (chat) chats.set(chat.id, chat);
}

if (chats.size === 0) {
  console.error(`No messages yet, so there is no chat id to find.

  1. Open Telegram and search for  @${me.result.username}
  2. Open the chat and press START (or send it any message)
  3. Run this command again

If you would rather the alerts went to a group, add the bot to the group and
send a message there instead — the id will be negative, which is normal.
`);
  process.exit(1);
}

console.log("Found:\n");
for (const [id, chat] of chats) {
  const who = chat.title || [chat.first_name, chat.last_name].filter(Boolean).join(" ") || chat.username;
  console.log(`  ${id}   ${who}  (${chat.type})`);
}

const [chatId] = [...chats.keys()];

/* A send-to-self proves the whole path works before an order depends on it. */
const test = await fetch(api("sendMessage"), {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({
    chat_id: chatId,
    text: "✅ <b>Asmar Store</b>\nOrder alerts are connected. New orders will arrive here.",
    parse_mode: "HTML",
  }),
}).then((r) => r.json());

console.log(
  test.ok
    ? `\nSent a test message to ${chatId}. Check your phone.\n`
    : `\nCould not send a test message: ${test.description}\n`,
);

/* Generated here rather than pasted by hand: the same value has to end up in
   two places and a mismatch fails silently. */
const secret = [...crypto.getRandomValues(new Uint8Array(32))]
  .map((b) => b.toString(16).padStart(2, "0"))
  .join("");

console.log(`Now run these, in order.

1. Deploy the function and give it the secrets:

   supabase functions deploy notify-order --no-verify-jwt
   supabase secrets set NOTIFY_SECRET=${secret}
   supabase secrets set TELEGRAM_BOT_TOKEN=${token}
   supabase secrets set TELEGRAM_CHAT_ID=${chatId}

2. Point the database trigger at it — Supabase SQL Editor, after running
   supabase/notify.sql. Replace <project-ref> with your project's ref:

   update public.notify_config set
     url    = 'https://<project-ref>.functions.supabase.co/notify-order',
     secret = '${secret}'
   where id = 1;

3. Check it in the admin: Diagnostics -> "Order alerts wiring" should be green.
`);
