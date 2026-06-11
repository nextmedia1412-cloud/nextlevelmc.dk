import { supabase, isSupabaseConfigured } from "../shared/supabase-client.js";
import {
  loginWithUsername,
  logout,
  requireLogin,
  hydrateRememberedLogin,
  handleRememberLogin,
} from "../shared/auth.js";

const els = {
  setupWarning: document.querySelector("#setupWarning"),
  loginPanel: document.querySelector("#loginPanel"),
  loginForm: document.querySelector("#loginForm"),
  username: document.querySelector("#username"),
  password: document.querySelector("#password"),
  rememberLogin: document.querySelector("#rememberLogin"),
  loginStatus: document.querySelector("#loginStatus"),
  dashboard: document.querySelector("#dashboard"),
  memberIntro: document.querySelector("#memberIntro"),
  taskList: document.querySelector("#taskList"),
  dashboardStatus: document.querySelector("#dashboardStatus"),
  logoutBtn: document.querySelector("#logoutBtn"),
};

function getCurrentMonthKey() {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  return `${year}-${month}`;
}

function setStatus(element, message = "", type = "") {
  element.textContent = message;
  element.className = `status-line ${type}`.trim();
}

function showLoggedOut() {
  els.loginPanel.classList.remove("hidden");
  els.dashboard.classList.add("hidden");
  els.logoutBtn.classList.add("hidden");
}

function showLoggedIn() {
  els.loginPanel.classList.add("hidden");
  els.dashboard.classList.remove("hidden");
  els.logoutBtn.classList.remove("hidden");
}

function taskDescription(description) {
  const text = String(description || "").trim();
  return text || "Ingen beskrivelse.";
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function formatDateTime(value) {
  if (!value) return "";
  return new Date(value).toLocaleString("da-DK", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function normalizeWeeks(weeks = []) {
  const byNumber = new Map((weeks || []).map((week) => [Number(week.week_number), week]));

  return [1, 2, 3, 4].map((weekNumber) => {
    return byNumber.get(weekNumber) || {
      id: null,
      week_number: weekNumber,
      status: "pending",
      completed_at: null,
    };
  });
}

function allWeeksDone(weeks) {
  return normalizeWeeks(weeks).every((week) => week.status === "done");
}

function renderWeekButton(week) {
  const isDone = week.status === "done";
  const doneText = week.completed_at ? ` · ${formatDateTime(week.completed_at)}` : "";

  if (isDone) {
    return `
      <div class="week-row done">
        <span class="week-label">Uge ${week.week_number}</span>
        <span class="badge ok">Udført${escapeHtml(doneText)}</span>
      </div>
    `;
  }

  return `
    <div class="week-row">
      <span class="week-label">Uge ${week.week_number}</span>
      <button class="btn gold week-done-btn" type="button" data-week-id="${escapeHtml(week.id)}" ${week.id ? "" : "disabled"}>
        Marker uge ${week.week_number} som udført
      </button>
    </div>
  `;
}

function renderAssignment(assignment) {
  const task = assignment.tasks || {};
  const weeks = normalizeWeeks(assignment.assignment_weeks || []);
  const isDone = allWeeksDone(weeks);
  const card = document.createElement("article");
  card.className = `item-card ${isDone ? "done" : ""}`;

  card.innerHTML = `
    <div class="item-topline">
      <div>
        <h3>${escapeHtml(task.title || "Opgave")}</h3>
        <p>${escapeHtml(taskDescription(task.description))}</p>
      </div>
      <span class="badge ${isDone ? "ok" : ""}">${isDone ? "Alle uger udført" : "Mangler uger"}</span>
    </div>
    <div class="actions">
      <span class="badge">Vægt ${Number(task.weight || 1)}</span>
    </div>
    <div class="week-grid">
      ${weeks.map(renderWeekButton).join("")}
    </div>
  `;

  card.querySelectorAll(".week-done-btn").forEach((button) => {
    button.addEventListener("click", () => markWeekDone(button.dataset.weekId, button));
  });

  return card;
}

async function loadMyAssignments() {
  setStatus(els.dashboardStatus, "Henter opgaver...");
  els.taskList.innerHTML = "";

  const authState = await requireLogin();
  if (!authState) {
    showLoggedOut();
    return;
  }

  showLoggedIn();
  const month = getCurrentMonthKey();
  els.memberIntro.textContent = `${authState.profile.display_name} · ${month}`;

  const { data, error } = await supabase
    .from("assignments")
    .select("id, month, status, completed_at, tasks(title, description, weight), assignment_weeks(id, week_number, status, completed_at)")
    .eq("month", month)
    .order("created_at", { ascending: true });

  if (error) {
    setStatus(els.dashboardStatus, error.message, "error");
    return;
  }

  for (const assignment of data || []) {
    els.taskList.appendChild(renderAssignment(assignment));
  }

  setStatus(els.dashboardStatus, data?.length ? "" : "Der er ikke fordelt opgaver til dig endnu.");
}

async function markWeekDone(weekId, button) {
  if (!weekId) return;

  button.disabled = true;
  button.textContent = "Gemmer...";

  const { error } = await supabase
    .from("assignment_weeks")
    .update({ status: "done", completed_at: new Date().toISOString() })
    .eq("id", weekId);

  if (error) {
    setStatus(els.dashboardStatus, error.message, "error");
    button.disabled = false;
    button.textContent = "Marker som udført";
    return;
  }

  await loadMyAssignments();
}

async function init() {
  hydrateRememberedLogin(els.username, els.rememberLogin);

  if (!isSupabaseConfigured()) {
    els.setupWarning.classList.remove("hidden");
    return;
  }

  const authState = await requireLogin();
  if (authState) {
    showLoggedIn();
    await loadMyAssignments();
  } else {
    showLoggedOut();
  }
}

els.loginForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  setStatus(els.loginStatus, "Logger ind...");

  try {
    await loginWithUsername(els.username.value, els.password.value);
    handleRememberLogin(els.username.value, els.rememberLogin.checked);
    els.password.value = "";
    setStatus(els.loginStatus, "", "success");
    await loadMyAssignments();
  } catch (_error) {
    setStatus(els.loginStatus, "Forkert brugernavn eller adgangskode.", "error");
  }
});

els.logoutBtn.addEventListener("click", async () => {
  await logout();
  showLoggedOut();
});

supabase.auth.onAuthStateChange((_event, session) => {
  if (!session) showLoggedOut();
});

init();
