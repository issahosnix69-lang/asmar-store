/* Wires up the shop alerts, and adds people to them.
 *
 * Telegram will not tell you a chat id until that chat has messaged the bot —
 * there is no API for "who owns this bot", and none for "who should get this".
 * So: everyone who wants alerts presses Start in the bot once, then this runs,
 * finds every chat that has spoken to it, sends each a test, and prints the
 * single command that puts them all in the config.
 *
 * That is also how a second person is added later. They press Start, this runs
 * again, and the generated command carries both ids.
 *
 * Usage:
 *   node scripts/setup-telegram.mjs <bot-token>
 *
 * The token is read from the command line and never written to disk by this
 * script. It lives in notify_config, which has row-level security enabled and
 * no policies at all, so the anon key cannot read it — only the service role
 * and the security-definer functions can.
 *
 * It must NEVER become a VITE_ variable. Vite inlines those into the browser
 * bundle, and the bot would then be controllable by anyone who views source.
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

console.log("Found these chats:\n");
const ids = [];
for (const [id, chat] of chats) {
  const who =
    chat.title ||
    [chat.first_name, chat.last_name].filter(Boolean).join(" ") ||
    chat.username ||
    "(no name)";
  const kind = chat.type === "private" ? "person" : chat.type;
  console.log(`  ${String(id).padEnd(16)} ${who}  (${kind})`);
  ids.push(String(id));
}

/* Every chat that has spoken to the bot, not just the first one.
 *
 * This used to take `const [chatId] = chats.keys()` and quietly ignore the
 * rest, which is exactly backwards: a second chat in this list is somebody who
 * deliberately opened the bot and pressed Start, and the only reason to do
 * that is to be told about orders. Ali adding his partner meant re-running
 * this and wondering why only one id came out. */
console.log(`\nSending a test message to all ${ids.length}…\n`);

for (const id of ids) {
  const test = await fetch(api("sendMessage"), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      chat_id: id,
      text: "✅ Asmar Store — alerts are connected. Orders, account requests and top-ups will arrive here.",
      disable_web_page_preview: true,
    }),
  }).then((r) => r.json());

  console.log(
    test.ok
      ? `  ${id}  delivered`
      : `  ${id}  FAILED — ${test.description}`,
  );
}

/* Anyone who did not receive it is not going to receive an order alert either,
   so they are left out of the generated command rather than written into the
   config to fail silently forever. */
console.log(`
Now paste this into the Supabase SQL Editor:

  update public.notify_config
     set enabled          = true,
         telegram_token   = '${token}',
         telegram_chat_id = '${ids.join(",")}'
   where id = 1;

Everyone in that list gets every alert. To add someone later, have them press
Start in the bot, run this script again, and paste the new command.

Then check the whole path end to end, without waiting for a real order:

  select public.send_telegram('test');

If nothing arrives, pg_net's background worker is the usual cause:

  select count(*) from net.http_request_queue;   -- queued but unsent
  select net.worker_restart();
`);

/* A reminder rather than an instruction: supabase/notify-direct.sql posts to
   Telegram straight from Postgres with pg_net, and supabase/alerts-all.sql
   adds the account-request and top-up triggers on top. Neither needs an Edge
   Function, a deploy, or the CLI — this script used to print all three, which
   was setup nobody here has to do. */
console.log(`Requires supabase/notify-direct.sql and supabase/alerts-all.sql to have been run.\n`);
