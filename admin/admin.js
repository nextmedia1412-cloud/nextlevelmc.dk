import { supabase, isSupabaseConfigured } from "../shared/supabase-client.js";
import {
  loginWithUsername,
  logout,
  requireAdmin,
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
  accessDenied: document.querySelector("#accessDenied"),
  adminPanel: document.querySelector("#adminPanel"),
  adminIntro: document.querySelector("#adminIntro"),
  logoutBtn: document.querySelector("#logoutBtn"),

  addUserForm: document.querySelector("#addUserForm"),
  newUsername: document.querySelector("#newUsername"),
  newDisplayName: document.querySelector("#newDisplayName"),
  newPassword: document.querySelector("#newPassword"),
  newRole: document.querySelector("#newRole"),
  newActive: document.querySelector("#newActive"),
  addUserStatus: document.querySelector("#addUserStatus"),

  addTaskForm: document.querySelector("#addTaskForm"),
  taskTitle: document.querySelector("#taskTitle"),
  taskDescription: document.querySelector("#taskDescription"),
  taskWeight: document.querySelector("#taskWeight"),
  taskActive: document.querySelector("#taskActive"),
  addTaskStatus: document.querySelector("#addTaskStatus"),

  refreshUsersBtn: document.querySelector("#refreshUsersBtn"),
  usersTable: document.querySelector("#usersTable"),
  usersStatus: document.querySelector("#usersStatus"),
  refreshTasksBtn: document.querySelector("#refreshTasksBtn"),
  tasksTable: document.querySelector("#tasksTable"),
  tasksStatus: document.querySelector("#tasksStatus"),

  monthLabel: document.querySelector("#monthLabel"),
  forceDistribution: document.querySelector("#forceDistribution"),
  distributeBtn: document.querySelector("#distributeBtn"),
  refreshDistributionBtn: document.querySelector("#refreshDistributionBtn"),
  distributionList: document.querySelector("#distributionList"),
  distributionStatus: document.querySelector("#distributionStatus"),
};

let currentAdminId = null;

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

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function formatDate(value) {
  if (!value) return "-";
  return new Date(value).toLocaleDateString("da-DK", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
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

function showLoggedOut() {
  els.loginPanel.classList.remove("hidden");
  els.adminPanel.classList.add("hidden");
  els.accessDenied.classList.add("hidden");
  els.logoutBtn.classList.add("hidden");
}

function showDenied() {
  els.loginPanel.classList.add("hidden");
  els.adminPanel.classList.add("hidden");
  els.accessDenied.classList.remove("hidden");
  els.logoutBtn.classList.remove("hidden");
}

function showAdmin(profile) {
  currentAdminId = profile.id;
  els.loginPanel.classList.add("hidden");
  els.accessDenied.classList.add("hidden");
  els.adminPanel.classList.remove("hidden");
  els.logoutBtn.classList.remove("hidden");
  els.adminIntro.textContent = `Logget ind som ${profile.display_name}`;
}

async function assertAdminAndRender() {
  const authState = await requireAdmin();
  if (!authState) {
    showLoggedOut();
    return false;
  }

  if (!authState.isAdmin) {
    showDenied();
    return false;
  }

  showAdmin(authState.profile);
  return true;
}

function userStatus(user) {
  if (user.deleted_at) return `<span class="badge danger">Slettet</span>`;
  return user.active ? `<span class="badge ok">Ja</span>` : `<span class="badge danger">Nej</span>`;
}

async function loadUsers() {
  setStatus(els.usersStatus, "Henter brugere...");
  els.usersTable.innerHTML = "";

  const { data, error } = await supabase
    .from("profiles")
    .select("id, username, display_name, role, active, created_at, deleted_at")
    .order("created_at", { ascending: true });

  if (error) {
    setStatus(els.usersStatus, error.message, "error");
    return;
  }

  els.usersTable.innerHTML = (data || [])
    .map((user) => {
      const isSelf = user.id === currentAdminId;
      const isDeleted = Boolean(user.deleted_at);
      return `
        <tr>
          <td>${escapeHtml(user.username)}</td>
          <td>${escapeHtml(user.display_name)}</td>
          <td><span class="badge">${escapeHtml(user.role)}</span></td>
          <td>${userStatus(user)}</td>
          <td>${formatDate(user.created_at)}</td>
          <td>
            <button
              class="btn danger mini delete-user-btn"
              type="button"
              data-user-id="${escapeHtml(user.id)}"
              data-username="${escapeHtml(user.username)}"
              ${isSelf || isDeleted ? "disabled" : ""}
            >
              ${isSelf ? "Dig" : isDeleted ? "Slettet" : "Slet"}
            </button>
          </td>
        </tr>
      `;
    })
    .join("");

  els.usersTable.querySelectorAll(".delete-user-btn").forEach((button) => {
    button.addEventListener("click", () => deleteUser(button.dataset.userId, button.dataset.username));
  });

  setStatus(els.usersStatus, data?.length ? "" : "Ingen brugere fundet.");
}

async function deleteUser(userId, username) {
  if (!userId) return;

  const confirmed = window.confirm(
    `Slet bruger '${username}'?\n\nBrugeren bliver deaktiveret og kan ikke længere bruge systemet. Historiske opgaver bevares.`
  );

  if (!confirmed) return;

  setStatus(els.usersStatus, `Sletter ${username}...`);

  const { data, error } = await supabase.functions.invoke("delete-member", {
    body: { user_id: userId },
  });

  if (error) {
    setStatus(els.usersStatus, error.message, "error");
    return;
  }

  setStatus(els.usersStatus, data?.message || "Bruger slettet.", "success");
  await loadUsers();
}

async function loadTasks() {
  setStatus(els.tasksStatus, "Henter opgaver...");
  els.tasksTable.innerHTML = "";

  const { data, error } = await supabase
    .from("tasks")
    .select("id, title, description, weight, active, created_at")
    .order("created_at", { ascending: true });

  if (error) {
    setStatus(els.tasksStatus, error.message, "error");
    return;
  }

  els.tasksTable.innerHTML = (data || [])
    .map(
      (task) => `
        <tr>
          <td>${escapeHtml(task.title)}</td>
          <td>${escapeHtml(task.description || "-")}</td>
          <td>${Number(task.weight || 1)}</td>
          <td>${task.active ? "Ja" : "Nej"}</td>
          <td>${formatDate(task.created_at)}</td>
        </tr>
      `,
    )
    .join("");

  setStatus(els.tasksStatus, data?.length ? "" : "Ingen opgaver fundet.");
}

function normalizeWeeks(weeks = []) {
  const byNumber = new Map((weeks || []).map((week) => [Number(week.week_number), week]));

  return [1, 2, 3, 4].map((weekNumber) => {
    return byNumber.get(weekNumber) || {
      week_number: weekNumber,
      status: "pending",
      completed_at: null,
    };
  });
}

function renderWeekBadges(weeks = []) {
  return normalizeWeeks(weeks)
    .map((week) => {
      const isDone = week.status === "done";
      const title = week.completed_at ? ` title="${escapeHtml(formatDateTime(week.completed_at))}"` : "";
      return `<span class="badge ${isDone ? "ok" : "danger"}"${title}>U${week.week_number}: ${isDone ? "OK" : "Mangler"}</span>`;
    })
    .join("");
}

function renderDistributionCard(assignment) {
  const task = assignment.tasks || {};
  const profile = assignment.profiles || {};
  const weeks = normalizeWeeks(assignment.assignment_weeks || []);
  const isDone = weeks.every((week) => week.status === "done");
  const card = document.createElement("article");
  card.className = `item-card ${isDone ? "done" : ""}`;
  card.innerHTML = `
    <div class="item-topline">
      <div>
        <h3>${escapeHtml(task.title || "Opgave")}</h3>
        <p>${escapeHtml(task.description || "Ingen beskrivelse.")}</p>
      </div>
      <span class="badge ${isDone ? "ok" : ""}">${isDone ? "Alle uger udført" : "Mangler"}</span>
    </div>
    <div class="actions">
      <span class="badge">${escapeHtml(profile.display_name || profile.username || "Ukendt")}</span>
      <span class="badge">Vægt ${Number(task.weight || 1)}</span>
    </div>
    <div class="week-badges">
      ${renderWeekBadges(weeks)}
    </div>
  `;
  return card;
}

async function loadDistribution() {
  const month = getCurrentMonthKey();
  els.monthLabel.textContent = `Aktuel måned: ${month}`;
  setStatus(els.distributionStatus, "Henter fordeling...");
  els.distributionList.innerHTML = "";

  const { data, error } = await supabase
    .from("assignments")
    .select("id, month, status, completed_at, profiles(username, display_name), tasks(title, description, weight), assignment_weeks(id, week_number, status, completed_at)")
    .eq("month", month)
    .order("created_at", { ascending: true });

  if (error) {
    setStatus(els.distributionStatus, error.message, "error");
    return;
  }

  for (const assignment of data || []) {
    els.distributionList.appendChild(renderDistributionCard(assignment));
  }

  setStatus(els.distributionStatus, data?.length ? "" : "Ingen fordeling for måneden endnu.");
}

async function refreshAll() {
  await Promise.all([loadUsers(), loadTasks(), loadDistribution()]);
}

async function init() {
  hydrateRememberedLogin(els.username, els.rememberLogin);

  if (!isSupabaseConfigured()) {
    els.setupWarning.classList.remove("hidden");
    return;
  }

  const ok = await assertAdminAndRender();
  if (ok) await refreshAll();
}

els.loginForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  setStatus(els.loginStatus, "Logger ind...");

  try {
    await loginWithUsername(els.username.value, els.password.value);
    handleRememberLogin(els.username.value, els.rememberLogin.checked);
    els.password.value = "";
    setStatus(els.loginStatus, "", "success");
    const ok = await assertAdminAndRender();
    if (ok) await refreshAll();
  } catch (_error) {
    setStatus(els.loginStatus, "Forkert brugernavn eller adgangskode.", "error");
  }
});

els.logoutBtn.addEventListener("click", async () => {
  await logout();
  showLoggedOut();
});

els.addUserForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  setStatus(els.addUserStatus, "Opretter bruger...");

  const payload = {
    username: els.newUsername.value,
    display_name: els.newDisplayName.value,
    password: els.newPassword.value,
    role: els.newRole.value,
    active: els.newActive.checked,
  };

  const { data, error } = await supabase.functions.invoke("create-member", {
    body: payload,
  });

  if (error) {
    setStatus(els.addUserStatus, error.message, "error");
    return;
  }

  setStatus(els.addUserStatus, data?.message || "Bruger oprettet.", "success");
  els.addUserForm.reset();
  els.newActive.checked = true;
  await loadUsers();
});

els.addTaskForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  setStatus(els.addTaskStatus, "Opretter opgave...");

  const { error } = await supabase.from("tasks").insert({
    title: els.taskTitle.value.trim(),
    description: els.taskDescription.value.trim() || null,
    weight: Number(els.taskWeight.value),
    active: els.taskActive.checked,
  });

  if (error) {
    setStatus(els.addTaskStatus, error.message, "error");
    return;
  }

  setStatus(els.addTaskStatus, "Opgave oprettet.", "success");
  els.addTaskForm.reset();
  els.taskActive.checked = true;
  await loadTasks();
});

els.distributeBtn.addEventListener("click", async () => {
  setStatus(els.distributionStatus, "Fordeler opgaver...");
  els.distributeBtn.disabled = true;

  const { data, error } = await supabase.functions.invoke("distribute-tasks", {
    body: {
      force: els.forceDistribution.checked,
    },
  });

  els.distributeBtn.disabled = false;

  if (error) {
    const message = error.context?.status === 409
      ? "Der findes allerede en fordeling for denne måned. Sæt flueben i 'Overskriv måned', hvis den skal laves om."
      : error.message;
    setStatus(els.distributionStatus, message, "error");
    return;
  }

  setStatus(els.distributionStatus, data?.message || "Opgaver fordelt.", "success");
  await loadDistribution();
});

els.refreshUsersBtn.addEventListener("click", loadUsers);
els.refreshTasksBtn.addEventListener("click", loadTasks);
els.refreshDistributionBtn.addEventListener("click", loadDistribution);

supabase.auth.onAuthStateChange((_event, session) => {
  if (!session) showLoggedOut();
});

init();
