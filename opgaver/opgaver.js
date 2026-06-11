import { supabase, isSupabaseConfigured } from "../shared/supabase-client.js";
import { loginWithUsername, logout, requireLogin } from "../shared/auth.js";

const els = {
  setupWarning: document.querySelector("#setupWarning"),
  loginPanel: document.querySelector("#loginPanel"),
  loginForm: document.querySelector("#loginForm"),
  username: document.querySelector("#username"),
  password: document.querySelector("#password"),
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

function renderAssignment(assignment) {
  const task = assignment.tasks || {};
  const isDone = assignment.status === "done";
  const card = document.createElement("article");
  card.className = `item-card ${isDone ? "done" : ""}`;

  card.innerHTML = `
    <div class="item-topline">
      <div>
        <h3>${escapeHtml(task.title || "Opgave")}</h3>
        <p>${escapeHtml(taskDescription(task.description))}</p>
      </div>
      <span class="badge ${isDone ? "ok" : ""}">${isDone ? "Udført" : "Mangler"}</span>
    </div>
    <div class="actions">
      <span class="badge">Vægt ${Number(task.weight || 1)}</span>
      <button class="btn gold mark-done" type="button" ${isDone ? "disabled" : ""}>Marker som udført</button>
    </div>
  `;

  const button = card.querySelector(".mark-done");
  button.addEventListener("click", () => markAssignmentDone(assignment.id, button));

  return card;
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
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
    .select("id, month, status, completed_at, tasks(title, description, weight)")
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

async function markAssignmentDone(assignmentId, button) {
  button.disabled = true;
  button.textContent = "Gemmer...";

  const { error } = await supabase
    .from("assignments")
    .update({ status: "done", completed_at: new Date().toISOString() })
    .eq("id", assignmentId);

  if (error) {
    setStatus(els.dashboardStatus, error.message, "error");
    button.disabled = false;
    button.textContent = "Marker som udført";
    return;
  }

  await loadMyAssignments();
}

async function init() {
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
    els.password.value = "";
    setStatus(els.loginStatus, "", "success");
    await loadMyAssignments();
  } catch (error) {
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
