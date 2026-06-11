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
  editTaskId: document.querySelector("#editTaskId"),
  taskTitle: document.querySelector("#taskTitle"),
  taskDescription: document.querySelector("#taskDescription"),
  taskWeight: document.querySelector("#taskWeight"),
  taskActive: document.querySelector("#taskActive"),
  taskExcludedUsers: document.querySelector("#taskExcludedUsers"),
  taskSubmitBtn: document.querySelector("#taskSubmitBtn"),
  cancelEditTaskBtn: document.querySelector("#cancelEditTaskBtn"),
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
let cachedUsers = [];
let cachedTasks = [];

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

function getEligibleExclusionUsers() {
  return cachedUsers.filter((user) => user.active && !user.deleted_at);
}

function renderTaskExcludedUserChecklist() {
  if (!els.taskExcludedUsers) return;

  const users = getEligibleExclusionUsers();

  if (!users.length) {
    els.taskExcludedUsers.innerHTML = `<p class="small muted">Ingen aktive brugere at undlade.</p>`;
    return;
  }

  els.taskExcludedUsers.innerHTML = users
    .map((user) => `
      <label class="checkbox-row">
        <input class="task-excluded-user" type="checkbox" value="${escapeHtml(user.id)}" />
        ${escapeHtml(user.display_name || user.username)} <span class="muted">@${escapeHtml(user.username)}</span>
      </label>
    `)
    .join("");
}

function getSelectedExcludedUserIds() {
  if (!els.taskExcludedUsers) return [];

  return [...els.taskExcludedUsers.querySelectorAll(".task-excluded-user:checked")]
    .map((input) => input.value)
    .filter(Boolean);
}

function setSelectedExcludedUserIds(userIds = []) {
  if (!els.taskExcludedUsers) return;

  const selected = new Set(userIds);

  els.taskExcludedUsers.querySelectorAll(".task-excluded-user").forEach((input) => {
    input.checked = selected.has(input.value);
  });
}

function renderExcludedUsers(exclusions = []) {
  if (!exclusions.length) return `<span class="muted">Ingen</span>`;

  return `
    <div class="exclusion-badges">
      ${exclusions.map((item) => {
        const profile = item.profiles || {};
        const label = profile.display_name || profile.username || item.user_id;
        return `<span class="badge danger">${escapeHtml(label)}</span>`;
      }).join("")}
    </div>
  `;
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

  cachedUsers = data || [];
  renderTaskExcludedUserChecklist();

  els.usersTable.innerHTML = cachedUsers
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

  setStatus(els.usersStatus, cachedUsers.length ? "" : "Ingen brugere fundet.");
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

function resetTaskFormMode() {
  els.editTaskId.value = "";
  els.addTaskForm.reset();
  els.taskActive.checked = true;
  setSelectedExcludedUserIds([]);
  els.taskSubmitBtn.textContent = "Tilføj opgave";
  els.cancelEditTaskBtn.classList.add("hidden");
}

function getTaskPayload() {
  return {
    title: els.taskTitle.value.trim(),
    description: els.taskDescription.value.trim() || null,
    weight: Number(els.taskWeight.value),
    active: els.taskActive.checked,
  };
}

function activeBadge(active) {
  return active
    ? `<span class="badge ok">Ja</span>`
    : `<span class="badge danger">Nej</span>`;
}

async function loadTasks() {
  setStatus(els.tasksStatus, "Henter opgaver...");
  els.tasksTable.innerHTML = "";

  const { data, error } = await supabase
    .from("tasks")
    .select("id, title, description, weight, active, created_at, task_excluded_users(user_id, profiles(username, display_name))")
    .order("created_at", { ascending: true });

  if (error) {
    setStatus(els.tasksStatus, error.message, "error");
    return;
  }

  cachedTasks = data || [];

  els.tasksTable.innerHTML = cachedTasks
    .map((task) => {
      const isActive = Boolean(task.active);
      return `
        <tr>
          <td>${escapeHtml(task.title)}</td>
          <td>${escapeHtml(task.description || "-")}</td>
          <td>${Number(task.weight || 1)}</td>
          <td>${renderExcludedUsers(task.task_excluded_users || [])}</td>
          <td>${activeBadge(isActive)}</td>
          <td>${formatDate(task.created_at)}</td>
          <td>
            <div class="table-actions">
              <button
                class="btn secondary mini edit-task-btn"
                type="button"
                data-task-id="${escapeHtml(task.id)}"
              >
                Rediger
              </button>
              <button
                class="btn ${isActive ? "danger" : "secondary"} mini toggle-task-btn"
                type="button"
                data-task-id="${escapeHtml(task.id)}"
                data-next-active="${isActive ? "false" : "true"}"
              >
                ${isActive ? "Slet" : "Gendan"}
              </button>
            </div>
          </td>
        </tr>
      `;
    })
    .join("");

  els.tasksTable.querySelectorAll(".edit-task-btn").forEach((button) => {
    button.addEventListener("click", () => startEditTask(button.dataset.taskId));
  });

  els.tasksTable.querySelectorAll(".toggle-task-btn").forEach((button) => {
    button.addEventListener("click", () => {
      toggleTaskActive(button.dataset.taskId, button.dataset.nextActive === "true");
    });
  });

  setStatus(els.tasksStatus, cachedTasks.length ? "" : "Ingen opgaver fundet.");
}

function startEditTask(taskId) {
  const task = cachedTasks.find((item) => item.id === taskId);

  if (!task) {
    setStatus(els.addTaskStatus, "Opgaven blev ikke fundet. Tryk Opdater og prøv igen.", "error");
    return;
  }

  els.editTaskId.value = task.id;
  els.taskTitle.value = task.title || "";
  els.taskDescription.value = task.description || "";
  els.taskWeight.value = String(task.weight || 1);
  els.taskActive.checked = Boolean(task.active);
  setSelectedExcludedUserIds((task.task_excluded_users || []).map((item) => item.user_id));
  els.taskSubmitBtn.textContent = "Gem ændringer";
  els.cancelEditTaskBtn.classList.remove("hidden");
  setStatus(els.addTaskStatus, `Redigerer: ${task.title}`);
  els.addTaskForm.scrollIntoView({ behavior: "smooth", block: "center" });
  els.taskTitle.focus();
}

async function saveTaskExclusions(taskId) {
  const selectedUserIds = getSelectedExcludedUserIds();

  const { error: deleteError } = await supabase
    .from("task_excluded_users")
    .delete()
    .eq("task_id", taskId);

  if (deleteError) {
    throw new Error(deleteError.message);
  }

  if (!selectedUserIds.length) return;

  const rows = selectedUserIds.map((userId) => ({
    task_id: taskId,
    user_id: userId,
  }));

  const { error: insertError } = await supabase
    .from("task_excluded_users")
    .insert(rows);

  if (insertError) {
    throw new Error(insertError.message);
  }
}

async function saveTask() {
  const taskId = els.editTaskId.value;
  const payload = getTaskPayload();

  if (!payload.title) {
    setStatus(els.addTaskStatus, "Titel mangler.", "error");
    return;
  }

  if (![1, 2, 3].includes(payload.weight)) {
    setStatus(els.addTaskStatus, "Vægt skal være 1, 2 eller 3.", "error");
    return;
  }

  setStatus(els.addTaskStatus, taskId ? "Gemmer ændringer..." : "Opretter opgave...");

  try {
    let savedTaskId = taskId;

    if (taskId) {
      const { error } = await supabase
        .from("tasks")
        .update(payload)
        .eq("id", taskId);

      if (error) throw new Error(error.message);
    } else {
      const { data, error } = await supabase
        .from("tasks")
        .insert(payload)
        .select("id")
        .single();

      if (error) throw new Error(error.message);
      savedTaskId = data.id;
    }

    await saveTaskExclusions(savedTaskId);

    setStatus(els.addTaskStatus, taskId ? "Opgave opdateret." : "Opgave oprettet.", "success");
    resetTaskFormMode();
    await loadTasks();
    await loadDistribution();
  } catch (error) {
    setStatus(els.addTaskStatus, error.message || "Opgaven kunne ikke gemmes.", "error");
  }
}

async function toggleTaskActive(taskId, nextActive) {
  const task = cachedTasks.find((item) => item.id === taskId);

  if (!task) return;

  if (!nextActive) {
    const confirmed = window.confirm(
      `Slet opgaven '${task.title}'?\n\nDen bliver deaktiveret, så den ikke kommer med i nye fordelinger. Historiske fordelinger bevares.`
    );

    if (!confirmed) return;
  }

  setStatus(els.tasksStatus, nextActive ? "Gendanner opgave..." : "Sletter opgave...");

  const { error } = await supabase
    .from("tasks")
    .update({ active: nextActive })
    .eq("id", taskId);

  if (error) {
    setStatus(els.tasksStatus, error.message, "error");
    return;
  }

  if (els.editTaskId.value === taskId) {
    resetTaskFormMode();
  }

  setStatus(els.tasksStatus, nextActive ? "Opgave gendannet." : "Opgave slettet/deaktiveret.", "success");
  await loadTasks();
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
  await saveTask();
});

els.cancelEditTaskBtn.addEventListener("click", () => {
  resetTaskFormMode();
  setStatus(els.addTaskStatus, "Redigering annulleret.");
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
