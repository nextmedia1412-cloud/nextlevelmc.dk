// Next Level MC · push
// Sender push-notifikationer: ved nyt event (kaldt af admin fra siden) og som
// påmindelser (kaldt hver time af pg_cron med {"action": "cron"}).
// "Verify JWT" skal være slået FRA for funktionen. Cron-kaldet er åbent, men ufarligt:
// det sender kun påmindelser, der er forfaldne, og hver påmindelse kun én gang.
// Kræver secrets: VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY, VAPID_SUBJECT.

import { createClient, type SupabaseClient } from "npm:@supabase/supabase-js@2";
import webpush from "npm:web-push@3.6.7";

const HOUR = 3600000;
// Påmindelse til alle, der ikke har meldt fra, når der er under så mange timer til start.
const DAY_BEFORE_HOURS = 24;
// Påmindelse til dem, der ikke har svaret, når der er under så mange timer til start.
const RSVP_REMINDER_HOURS = 72;
// Helt nye events får ingen påmindelse lige oven i "Nyt event"-notifikationen.
const QUIET_HOURS_AFTER_CREATE = 6;

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

type EventRow = { id: string; title: string; starts_at: string; location: string };
type Payload = { title: string; body: string; url: string; tag: string };

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function formatWhen(startsAt: string) {
  return new Intl.DateTimeFormat("da-DK", {
    weekday: "long",
    day: "numeric",
    month: "long",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "Europe/Copenhagen",
  }).format(new Date(startsAt));
}

// userIds = null sender til alle tilmeldte telefoner.
async function sendToUsers(admin: SupabaseClient, userIds: string[] | null, payload: Payload) {
  if (userIds && !userIds.length) return 0;

  let query = admin.from("push_subscriptions").select("id, endpoint, p256dh, auth");
  if (userIds) query = query.in("user_id", userIds);

  const { data: subscriptions, error } = await query;
  if (error) throw new Error(error.message);

  let sent = 0;
  await Promise.all((subscriptions || []).map(async (subscription) => {
    try {
      await webpush.sendNotification(
        { endpoint: subscription.endpoint, keys: { p256dh: subscription.p256dh, auth: subscription.auth } },
        JSON.stringify(payload),
      );
      sent += 1;
    } catch (error) {
      // 404/410 betyder, at telefonen har afmeldt sig – ryd op.
      const statusCode = (error as { statusCode?: number })?.statusCode;
      if (statusCode === 404 || statusCode === 410) {
        await admin.from("push_subscriptions").delete().eq("id", subscription.id);
      }
    }
  }));

  return sent;
}

async function getRecipients(admin: SupabaseClient, eventId: string) {
  const [{ data: profiles }, { data: responses }] = await Promise.all([
    admin.from("profiles").select("id"),
    admin.from("event_responses").select("user_id, status").eq("event_id", eventId),
  ]);

  const statusByUser = new Map((responses || []).map((row) => [row.user_id, row.status]));
  const allIds = (profiles || []).map((profile) => profile.id);

  return {
    coming: allIds.filter((id) => statusByUser.get(id) === "yes"),
    unanswered: allIds.filter((id) => !statusByUser.has(id)),
  };
}

// Markerer påmindelsen som sendt. Returnerer false, hvis et andet kald kom først.
async function claimReminder(admin: SupabaseClient, eventId: string, column: string) {
  const { data } = await admin
    .from("events")
    .update({ [column]: new Date().toISOString() })
    .eq("id", eventId)
    .is(column, null)
    .select("id");

  return Boolean(data?.length);
}

async function runReminders(admin: SupabaseClient) {
  const now = Date.now();
  const createdBefore = new Date(now - QUIET_HOURS_AFTER_CREATE * HOUR).toISOString();
  let sent = 0;

  const { data: dayBefore } = await admin
    .from("events")
    .select("id, title, starts_at, location")
    .gt("starts_at", new Date(now).toISOString())
    .lte("starts_at", new Date(now + DAY_BEFORE_HOURS * HOUR).toISOString())
    .lt("created_at", createdBefore)
    .is("reminder_day_before_sent_at", null);

  for (const event of (dayBefore || []) as EventRow[]) {
    if (!(await claimReminder(admin, event.id, "reminder_day_before_sent_at"))) continue;

    const { coming, unanswered } = await getRecipients(admin, event.id);
    const when = `${formatWhen(event.starts_at)} · ${event.location}`;

    sent += await sendToUsers(admin, coming, {
      title: `Husk: ${event.title}`,
      body: when,
      url: "/member/",
      tag: `event-${event.id}`,
    });
    sent += await sendToUsers(admin, unanswered, {
      title: `Husk: ${event.title}`,
      body: `${when}. Du har ikke svaret endnu – kommer du?`,
      url: "/member/",
      tag: `event-${event.id}`,
    });
  }

  const { data: rsvp } = await admin
    .from("events")
    .select("id, title, starts_at, location")
    .gt("starts_at", new Date(now + DAY_BEFORE_HOURS * HOUR).toISOString())
    .lte("starts_at", new Date(now + RSVP_REMINDER_HOURS * HOUR).toISOString())
    .lt("created_at", createdBefore)
    .is("reminder_rsvp_sent_at", null);

  for (const event of (rsvp || []) as EventRow[]) {
    if (!(await claimReminder(admin, event.id, "reminder_rsvp_sent_at"))) continue;

    const { unanswered } = await getRecipients(admin, event.id);
    sent += await sendToUsers(admin, unanswered, {
      title: `Kommer du? ${event.title}`,
      body: `Du har ikke svaret endnu. ${formatWhen(event.starts_at)} · ${event.location}`,
      url: "/member/",
      tag: `event-${event.id}`,
    });
  }

  return sent;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ message: "Kun POST." }, 405);

  const vapidPublic = Deno.env.get("VAPID_PUBLIC_KEY");
  const vapidPrivate = Deno.env.get("VAPID_PRIVATE_KEY");
  if (!vapidPublic || !vapidPrivate) return json({ message: "VAPID-nøgler mangler i secrets." }, 500);

  webpush.setVapidDetails(
    Deno.env.get("VAPID_SUBJECT") || "mailto:admin@nextlevelmc.dk",
    vapidPublic,
    vapidPrivate,
  );

  const admin = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    { auth: { persistSession: false, autoRefreshToken: false } },
  );

  let body: Record<string, unknown> = {};
  try {
    body = await req.json();
  } catch (_error) {
    return json({ message: "Ugyldig forespørgsel." }, 400);
  }

  try {
    if (body.action === "cron") {
      return json({ sent: await runReminders(admin) });
    }

    // Alt andet end cron kræver, at man er logget ind.
    const token = (req.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "");
    const { data: userData, error: userError } = await admin.auth.getUser(token);
    if (userError || !userData?.user) return json({ message: "Du er ikke logget ind." }, 401);

    // Sender en prøve-notifikation til ens egne telefoner.
    if (body.action === "test") {
      const sent = await sendToUsers(admin, [userData.user.id], {
        title: "Next Level MC",
        body: "Notifikationer virker på denne telefon.",
        url: "/member/",
        tag: "test",
      });
      return json({ sent });
    }

    if (body.action === "new_event") {
      const { data: callerProfile } = await admin
        .from("profiles")
        .select("role")
        .eq("id", userData.user.id)
        .maybeSingle();
      if (callerProfile?.role !== "admin") return json({ message: "Kun admins har adgang." }, 403);

      const { data: event } = await admin
        .from("events")
        .select("id, title, starts_at, location")
        .eq("id", String(body.event_id || ""))
        .maybeSingle();
      if (!event) return json({ message: "Eventet blev ikke fundet." }, 404);

      const sent = await sendToUsers(admin, null, {
        title: `Nyt event: ${event.title}`,
        body: `${formatWhen(event.starts_at)} · ${event.location}. Svar om du kommer.`,
        url: "/member/",
        tag: `event-${event.id}`,
      });
      return json({ sent });
    }

    return json({ message: "Ukendt handling." }, 400);
  } catch (error) {
    return json({ message: (error as Error).message || "Noget gik galt." }, 500);
  }
});
