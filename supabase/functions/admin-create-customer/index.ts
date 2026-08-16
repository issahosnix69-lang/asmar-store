/* Creates a customer login from the admin panel.
 *
 * Customers cannot sign themselves up — they message the owner, he makes the
 * account here and sends them the password. Creating a user needs the
 * service_role key, which must never reach a browser, so it happens here.
 *
 * Deploy:
 *   supabase functions deploy admin-create-customer
 * Secrets it needs (SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are provided by
 * the platform automatically — you do not set those yourself).
 */
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...cors, "Content-Type": "application/json" },
  });

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ error: "Method not allowed." }, 405);

  const url = Deno.env.get("SUPABASE_URL")!;
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;

  /* Who is asking? The caller's own JWT is checked against the admins table
     before the service key is used for anything. Without this, knowing the
     function URL would be enough to mint accounts. */
  const authHeader = req.headers.get("Authorization") ?? "";
  if (!authHeader.startsWith("Bearer ")) return json({ error: "Not signed in." }, 401);

  const asCaller = createClient(url, anonKey, {
    global: { headers: { Authorization: authHeader } },
  });

  const { data: isAdmin, error: adminErr } = await asCaller.rpc("is_admin");
  if (adminErr) return json({ error: adminErr.message }, 500);
  if (!isAdmin) return json({ error: "Not allowed." }, 403);

  let body: { email?: string; password?: string; name?: string; phone?: string };
  try {
    body = await req.json();
  } catch {
    return json({ error: "Bad request." }, 400);
  }

  const email = String(body.email ?? "").trim().toLowerCase();
  const password = String(body.password ?? "");
  const name = String(body.name ?? "").trim().slice(0, 120);
  const phone = String(body.phone ?? "").trim().slice(0, 40);

  if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) {
    return json({ error: "That email does not look right." }, 400);
  }
  if (password.length < 8) {
    return json({ error: "Use a password of at least 8 characters." }, 400);
  }

  const admin = createClient(url, serviceKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  /* email_confirm: the owner is vouching for the address by creating the
     account by hand, and a confirmation mail the customer never opens would
     just leave the login dead. */
  const { data, error } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: { name, phone },
  });

  if (error) {
    const already = /already|registered|exists/i.test(error.message);
    return json({ error: already ? "There is already an account with that email." : error.message },
      already ? 409 : 400);
  }

  /* The trigger in accounts.sql has already made the profile row; this fills in
     details the trigger could not see if metadata arrived late. */
  await admin.from("customers")
    .update({ name, phone, email })
    .eq("id", data.user!.id);

  return json({ id: data.user!.id, email });
});
