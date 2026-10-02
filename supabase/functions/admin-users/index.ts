// Next Level MC · admin-users
// Opretter, sletter og ændrer brugere. Kun admins må kalde den.
// "Verify JWT" skal være slået FRA for funktionen – adgangen tjekkes herunder.

import { createClient } from "npm:@supabase/supabase-js@2";

const AUTH_DOMAIN = "nextlevelmc.local";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function cleanUsername(value: unknown) {
  return String(value || "").trim().toLowerCase().replace(/\s+/g, "");
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ message: "Kun POST." }, 405);

  const admin = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    { auth: { persistSession: false, autoRefreshToken: false } },
  );

  const token = (req.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "");
  const { data: userData, error: userError } = await admin.auth.getUser(token);
  if (userError || !userData?.user) return json({ message: "Du er ikke logget ind." }, 401);

  const callerId = userData.user.id;
  const { data: callerProfile } = await admin
    .from("profiles")
    .select("role")
    .eq("id", callerId)
    .maybeSingle();

  if (callerProfile?.role !== "admin") return json({ message: "Kun admins har adgang." }, 403);

  let body: Record<string, unknown> = {};
  try {
    body = await req.json();
  } catch (_error) {
    return json({ message: "Ugyldig forespørgsel." }, 400);
  }

  const action = String(body.action || "");
  const userId = String(body.user_id || "");

  if (action === "create") {
    const username = cleanUsername(body.username);
    const displayName = String(body.display_name || "").trim();
    const password = String(body.password || "");
    const role = body.role === "admin" ? "admin" : "member";

    if (!/^[a-z0-9._-]{2,30}$/.test(username)) {
      return json({ message: "Brugernavn må kun indeholde bogstaver (a-z), tal, punktum, - og _." }, 400);
    }
    if (!displayName) return json({ message: "Navn mangler." }, 400);
    if (password.length < 6) return json({ message: "Adgangskoden skal være mindst 6 tegn." }, 400);

    const { data: existing } = await admin
      .from("profiles")
      .select("id")
      .eq("username", username)
      .maybeSingle();
    if (existing) return json({ message: "Brugernavnet er allerede i brug." }, 409);

    const { data: created, error: createError } = await admin.auth.admin.createUser({
      email: `${username}@${AUTH_DOMAIN}`,
      password,
      email_confirm: true,
    });
    if (createError || !created?.user) {
      return json({ message: createError?.message || "Brugeren kunne ikke oprettes." }, 400);
    }

    const { error: profileError } = await admin.from("profiles").insert({
      id: created.user.id,
      username,
      display_name: displayName,
      role,
    });
    if (profileError) {
      await admin.auth.admin.deleteUser(created.user.id);
      return json({ message: profileError.message }, 400);
    }

    return json({ message: `${displayName} er oprettet.` });
  }

  if (!userId) return json({ message: "Bruger mangler." }, 400);

  if (action === "delete") {
    if (userId === callerId) return json({ message: "Du kan ikke slette dig selv." }, 400);

    const { error } = await admin.auth.admin.deleteUser(userId);
    if (error) return json({ message: error.message }, 400);
    return json({ message: "Brugeren er slettet." });
  }

  if (action === "set_role") {
    const role = body.role === "admin" ? "admin" : "member";
    if (userId === callerId && role !== "admin") {
      return json({ message: "Du kan ikke fjerne din egen admin-rettighed." }, 400);
    }

    const { error } = await admin.from("profiles").update({ role }).eq("id", userId);
    if (error) return json({ message: error.message }, 400);
    return json({ message: role === "admin" ? "Brugeren er nu admin." : "Brugeren er nu almindeligt medlem." });
  }

  if (action === "set_password") {
    const password = String(body.password || "");
    if (password.length < 6) return json({ message: "Adgangskoden skal være mindst 6 tegn." }, 400);

    const { error } = await admin.auth.admin.updateUserById(userId, { password });
    if (error) return json({ message: error.message }, 400);
    return json({ message: "Adgangskoden er ændret." });
  }

  if (action === "rename") {
    const displayName = String(body.display_name || "").trim();
    if (!displayName) return json({ message: "Navn mangler." }, 400);

    const { error } = await admin.from("profiles").update({ display_name: displayName }).eq("id", userId);
    if (error) return json({ message: error.message }, 400);
    return json({ message: "Navnet er ændret." });
  }

  return json({ message: "Ukendt handling." }, 400);
});
