import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function jsonResponse(body: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      ...corsHeaders,
      "Content-Type": "application/json",
    },
  });
}

function cleanUsername(value: unknown) {
  return String(value || "").trim().toLowerCase().replace(/\s+/g, "");
}

async function getCallerAndAssertAdmin(authHeader: string) {
  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const supabaseAnonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
  const supabaseServiceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

  const userClient = createClient(supabaseUrl, supabaseAnonKey, {
    global: { headers: { Authorization: authHeader } },
    auth: { persistSession: false },
  });

  const adminClient = createClient(supabaseUrl, supabaseServiceRoleKey, {
    auth: { persistSession: false },
  });

  const { data: userData, error: userError } = await userClient.auth.getUser();
  if (userError || !userData?.user) {
    return { ok: false as const, response: jsonResponse({ error: "Ikke logget ind." }, 401) };
  }

  const { data: profile, error: profileError } = await adminClient
    .from("profiles")
    .select("id, role, active")
    .eq("id", userData.user.id)
    .single();

  if (profileError || !profile || profile.role !== "admin" || profile.active !== true) {
    return { ok: false as const, response: jsonResponse({ error: "Kun admin må oprette brugere." }, 403) };
  }

  return { ok: true as const, user: userData.user, adminClient };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  if (req.method !== "POST") {
    return jsonResponse({ error: "Kun POST er tilladt." }, 405);
  }

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return jsonResponse({ error: "Authorization header mangler." }, 401);
    }

    const guard = await getCallerAndAssertAdmin(authHeader);
    if (!guard.ok) return guard.response;

    const body = await req.json();
    const username = cleanUsername(body.username);
    const displayName = String(body.display_name || "").trim();
    const password = String(body.password || "");
    const role = String(body.role || "member").trim().toLowerCase();
    const active = typeof body.active === "boolean" ? body.active : true;

    if (!/^[a-z0-9_-]{2,32}$/.test(username)) {
      return jsonResponse({ error: "Brugernavn må kun indeholde a-z, 0-9, _ og -. Minimum 2 tegn." }, 400);
    }

    if (!displayName || displayName.length > 80) {
      return jsonResponse({ error: "Visningsnavn mangler eller er for langt." }, 400);
    }

    if (password.length < 6) {
      return jsonResponse({ error: "Adgangskode skal være mindst 6 tegn." }, 400);
    }

    if (!["member", "admin"].includes(role)) {
      return jsonResponse({ error: "Rolle skal være member eller admin." }, 400);
    }

    const email = `${username}@nextlevelmc.local`;

    const { data: authData, error: authError } = await guard.adminClient.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      user_metadata: {
        username,
        display_name: displayName,
      },
    });

    if (authError || !authData.user) {
      return jsonResponse({ error: authError?.message || "Auth-bruger kunne ikke oprettes." }, 400);
    }

    const { error: profileError } = await guard.adminClient.from("profiles").insert({
      id: authData.user.id,
      username,
      display_name: displayName,
      role,
      active,
    });

    if (profileError) {
      await guard.adminClient.auth.admin.deleteUser(authData.user.id);
      return jsonResponse({ error: profileError.message }, 400);
    }

    return jsonResponse({
      success: true,
      message: "Bruger oprettet.",
      user: {
        id: authData.user.id,
        username,
        display_name: displayName,
        role,
        active,
      },
    });
  } catch (error) {
    return jsonResponse({ error: error instanceof Error ? error.message : "Ukendt fejl." }, 500);
  }
});
