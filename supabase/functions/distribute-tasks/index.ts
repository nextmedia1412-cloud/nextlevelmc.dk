import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

type Profile = {
  id: string;
  username: string;
  display_name: string;
  role: string;
  active: boolean;
};

type Task = {
  id: string;
  title: string;
  description: string | null;
  weight: number;
  active: boolean;
  created_at: string;
};

type HistoryRow = {
  task_id: string;
  user_id: string;
  month: string;
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
    return { ok: false as const, response: jsonResponse({ error: "Kun admin må fordele opgaver." }, 403) };
  }

  return { ok: true as const, user: userData.user, adminClient };
}

function currentMonthCopenhagen() {
  return new Intl.DateTimeFormat("sv-SE", {
    timeZone: "Europe/Copenhagen",
    year: "numeric",
    month: "2-digit",
  }).format(new Date());
}

function monthDiff(fromMonth: string, toMonth: string) {
  const [fromYear, fromM] = fromMonth.split("-").map(Number);
  const [toYear, toM] = toMonth.split("-").map(Number);
  return (toYear - fromYear) * 12 + (toM - fromM);
}

function compareText(a: string, b: string) {
  return a.localeCompare(b, "da-DK", { sensitivity: "base" });
}

function chooseAssignments(users: Profile[], tasks: Task[], history: HistoryRow[], allTaskWeights: Map<string, number>, month: string) {
  const currentWeights = new Map<string, number>();
  const totalHistoricalWeights = new Map<string, number>();

  for (const user of users) {
    currentWeights.set(user.id, 0);
    totalHistoricalWeights.set(user.id, 0);
  }

  const historyByTaskUser = new Map<string, string[]>();

  for (const row of history) {
    const key = `${row.task_id}:${row.user_id}`;
    if (!historyByTaskUser.has(key)) historyByTaskUser.set(key, []);
    historyByTaskUser.get(key)!.push(row.month);

    const weight = allTaskWeights.get(row.task_id) || 1;
    totalHistoricalWeights.set(row.user_id, (totalHistoricalWeights.get(row.user_id) || 0) + weight);
  }

  const sortedTasks = [...tasks].sort((a, b) => {
    if (b.weight !== a.weight) return b.weight - a.weight;
    return compareText(a.title, b.title);
  });

  const result: Array<{
    task: Task;
    user: Profile;
    reason: {
      neverHadTask: boolean;
      monthsSinceSameTask: number | null;
      currentMonthWeightBefore: number;
      totalHistoricalWeight: number;
    };
  }> = [];

  for (const task of sortedTasks) {
    const candidates = users.map((user) => {
      const key = `${task.id}:${user.id}`;
      const months = historyByTaskUser.get(key) || [];
      const lastMonth = months.sort().at(-1) || null;
      const neverHadTask = !lastMonth;
      const monthsSinceSameTask = lastMonth ? monthDiff(lastMonth, month) : null;

      return {
        user,
        neverHadTask,
        monthsSinceSameTask,
        currentMonthWeight: currentWeights.get(user.id) || 0,
        totalHistoricalWeight: totalHistoricalWeights.get(user.id) || 0,
      };
    });

    candidates.sort((a, b) => {
      if (a.neverHadTask !== b.neverHadTask) return a.neverHadTask ? -1 : 1;

      const aMonths = a.monthsSinceSameTask ?? Number.POSITIVE_INFINITY;
      const bMonths = b.monthsSinceSameTask ?? Number.POSITIVE_INFINITY;
      if (bMonths !== aMonths) return bMonths - aMonths;

      if (a.currentMonthWeight !== b.currentMonthWeight) {
        return a.currentMonthWeight - b.currentMonthWeight;
      }

      if (a.totalHistoricalWeight !== b.totalHistoricalWeight) {
        return a.totalHistoricalWeight - b.totalHistoricalWeight;
      }

      return compareText(a.user.display_name || a.user.username, b.user.display_name || b.user.username);
    });

    const selected = candidates[0];
    currentWeights.set(selected.user.id, (currentWeights.get(selected.user.id) || 0) + task.weight);

    result.push({
      task,
      user: selected.user,
      reason: {
        neverHadTask: selected.neverHadTask,
        monthsSinceSameTask: selected.monthsSinceSameTask,
        currentMonthWeightBefore: selected.currentMonthWeight,
        totalHistoricalWeight: selected.totalHistoricalWeight,
      },
    });
  }

  return result;
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

    const body = await req.json().catch(() => ({}));
    const force = body.force === true;
    const month = typeof body.month === "string" && /^\d{4}-\d{2}$/.test(body.month)
      ? body.month
      : currentMonthCopenhagen();

    const { data: existingRound, error: existingError } = await guard.adminClient
      .from("assignment_rounds")
      .select("id, month")
      .eq("month", month)
      .maybeSingle();

    if (existingError) {
      return jsonResponse({ error: existingError.message }, 500);
    }

    if (existingRound && !force) {
      return jsonResponse({
        error: "Der findes allerede en fordeling for denne måned.",
        month,
      }, 409);
    }

    if (existingRound && force) {
      const { error: deleteError } = await guard.adminClient
        .from("assignment_rounds")
        .delete()
        .eq("id", existingRound.id);

      if (deleteError) {
        return jsonResponse({ error: deleteError.message }, 500);
      }
    }

    const { data: users, error: usersError } = await guard.adminClient
      .from("profiles")
      .select("id, username, display_name, role, active")
      .eq("active", true)
      .order("display_name", { ascending: true });

    if (usersError) return jsonResponse({ error: usersError.message }, 500);
    if (!users || users.length === 0) {
      return jsonResponse({ error: "Der er ingen aktive brugere." }, 400);
    }

    const { data: tasks, error: tasksError } = await guard.adminClient
      .from("tasks")
      .select("id, title, description, weight, active, created_at")
      .eq("active", true)
      .order("created_at", { ascending: true });

    if (tasksError) return jsonResponse({ error: tasksError.message }, 500);
    if (!tasks || tasks.length === 0) {
      return jsonResponse({ error: "Der er ingen aktive opgaver." }, 400);
    }

    const { data: allTasks, error: allTasksError } = await guard.adminClient
      .from("tasks")
      .select("id, weight");

    if (allTasksError) return jsonResponse({ error: allTasksError.message }, 500);

    const allTaskWeights = new Map<string, number>();
    for (const task of allTasks || []) {
      allTaskWeights.set(task.id, Number(task.weight || 1));
    }

    const { data: history, error: historyError } = await guard.adminClient
      .from("assignments")
      .select("task_id, user_id, month")
      .lt("month", month)
      .limit(10000);

    if (historyError) return jsonResponse({ error: historyError.message }, 500);

    const chosen = chooseAssignments(
      users as Profile[],
      tasks as Task[],
      (history || []) as HistoryRow[],
      allTaskWeights,
      month,
    );

    const { data: round, error: roundError } = await guard.adminClient
      .from("assignment_rounds")
      .insert({
        month,
        created_by: guard.user.id,
      })
      .select("id, month")
      .single();

    if (roundError || !round) {
      return jsonResponse({ error: roundError?.message || "Fordelingsrunde kunne ikke oprettes." }, 500);
    }

    const rows = chosen.map((item) => ({
      round_id: round.id,
      month,
      task_id: item.task.id,
      user_id: item.user.id,
      status: "pending",
    }));

    const { error: insertError } = await guard.adminClient.from("assignments").insert(rows);

    if (insertError) {
      await guard.adminClient.from("assignment_rounds").delete().eq("id", round.id);
      return jsonResponse({ error: insertError.message }, 500);
    }

    return jsonResponse({
      success: true,
      message: "Opgaver fordelt.",
      month,
      round_id: round.id,
      assignments: chosen.map((item) => ({
        task_id: item.task.id,
        task_title: item.task.title,
        task_weight: item.task.weight,
        user_id: item.user.id,
        username: item.user.username,
        display_name: item.user.display_name,
        reason: item.reason,
      })),
    });
  } catch (error) {
    return jsonResponse({ error: error instanceof Error ? error.message : "Ukendt fejl." }, 500);
  }
});
