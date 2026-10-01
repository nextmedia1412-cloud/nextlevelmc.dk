import { supabase, isSupabaseConfigured } from "../shared/supabase-client.js";
import {
  login,
  logout,
  getCurrentUser,
  isCurrentUserAdmin,
  hydrateRememberedLogin,
  handleRememberLogin,
} from "../shared/auth.js";

// Events bliver stående på listen så længe efter starttidspunktet.
const KEEP_AFTER_START_HOURS = 6;

const els = {
  setupWarning: document.querySelector("#setupWarning"),
  loginPanel: document.querySelector("#loginPanel"),
  loginForm: document.querySelector("#loginForm"),
  email: document.querySelector("#email"),
  password: document.querySelector("#password"),
  rememberLogin: document.querySelector("#rememberLogin"),
  loginStatus: document.querySelector("#loginStatus"),

  eventsPanel: document.querySelector("#eventsPanel"),
  eventList: document.querySelector("#eventList"),
  eventsStatus: document.querySelector("#eventsStatus"),
  addEventBtn: document.querySelector("#addEventBtn"),

  eventFormCard: document.querySelector("#eventFormCard"),
  eventFormTitle: document.querySelector("#eventFormTitle"),
  eventForm: document.querySelector("#eventForm"),
  editEventId: document.querySelector("#editEventId"),
  eventTitle: document.querySelector("#eventTitle"),
  eventDate: document.querySelector("#eventDate"),
  eventTime: document.querySelector("#eventTime"),
  eventLocation: document.querySelector("#eventLocation"),
  eventDescription: document.querySelector("#eventDescription"),
  eventSubmitBtn: document.querySelector("#eventSubmitBtn"),
  cancelEventBtn: document.querySelector("#cancelEventBtn"),
  eventFormStatus: document.querySelector("#eventFormStatus"),

  showLoginBtn: document.querySelector("#showLoginBtn"),
  logoutBtn: document.querySelector("#logoutBtn"),
};

let isAdmin = false;
let cachedEvents = [];

function setStatus(element, message = "", type = "") {
  element.textContent = message;
  element.className = `member-status ${type}`.trim();
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function pad(value) {
  return String(value).padStart(2, "0");
}

function toDateInputValue(date) {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

function toTimeInputValue(date) {
  return `${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function formatParts(date) {
  const clean = (text) => text.replace(".", "");
  return {
    weekdayShort: clean(date.toLocaleDateString("da-DK", { weekday: "short" })),
    day: date.getDate(),
    monthShort: clean(date.toLocaleDateString("da-DK", { month: "short" })),
    fullDate: date.toLocaleDateString("da-DK", { weekday: "long", day: "numeric", month: "long" }),
    time: date.toLocaleTimeString("da-DK", { hour: "2-digit", minute: "2-digit" }).replace(".", ":"),
  };
}

function countdownLabel(date) {
  const now = new Date();
  if (date <= now) return "I gang nu";

  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const startOfEventDay = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  const days = Math.round((startOfEventDay - startOfToday) / 86400000);

  if (days === 0) return "I dag";
  if (days === 1) return "I morgen";
  if (days < 14) return `Om ${days} dage`;
  return `Om ${Math.floor(days / 7)} uger`;
}

function mapsUrl(location) {
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(location)}`;
}

// Sætter admin-knapperne efter om der er logget ind. Returnerer om brugeren er logget ind.
async function refreshAuthUi() {
  const user = await getCurrentUser();
  isAdmin = user ? await isCurrentUserAdmin() : false;

  els.showLoginBtn.classList.toggle("hidden", Boolean(user));
  els.logoutBtn.classList.toggle("hidden", !user);
  els.addEventBtn.classList.toggle("hidden", !isAdmin);
  if (user) els.loginPanel.classList.add("hidden");
  if (!isAdmin) els.eventFormCard.classList.add("hidden");

  return Boolean(user);
}

function renderEvent(event, index) {
  const date = new Date(event.starts_at);
  const parts = formatParts(date);
  const description = String(event.description || "").trim();
  const article = document.createElement("article");
  article.className = "event";
  article.style.setProperty("--i", index);

  article.innerHTML = `
    <button class="glass-button event-button ${index === 0 ? "glass-button--gold" : ""}" type="button" aria-expanded="false">
      <span class="event-date">
        <small>${escapeHtml(parts.weekdayShort)}</small>
        <strong>${parts.day}</strong>
        <small>${escapeHtml(parts.monthShort)}</small>
      </span>
      <span class="button-text">
        <span class="event-countdown">${index === 0 ? "Næste event · " : ""}${escapeHtml(countdownLabel(date))}</span>
        <strong>${escapeHtml(event.title)}</strong>
        <span class="event-meta">
          <span>${escapeHtml(parts.fullDate)}</span>
          <span><b>kl.</b> ${escapeHtml(parts.time)}</span>
          <span><b>⌖</b> ${escapeHtml(event.location)}</span>
        </span>
      </span>
      <span class="button-arrow event-chevron">⌄</span>
    </button>
    <div class="event-details hidden">
      <p class="${description ? "" : "is-empty"}">${escapeHtml(description || "Ingen yderligere info endnu.")}</p>
      <div class="event-actions">
        <a class="member-btn member-btn--ghost member-btn--small" href="${escapeHtml(mapsUrl(event.location))}" target="_blank" rel="noopener noreferrer">Åbn i Maps ↗</a>
        ${isAdmin ? `
          <button class="member-btn member-btn--ghost member-btn--small edit-event-btn" type="button">Rediger</button>
          <button class="member-btn member-btn--danger member-btn--small delete-event-btn" type="button">Slet</button>
        ` : ""}
      </div>
    </div>
  `;

  const button = article.querySelector(".event-button");
  const details = article.querySelector(".event-details");

  button.addEventListener("click", () => {
    const isOpen = button.getAttribute("aria-expanded") === "true";
    button.setAttribute("aria-expanded", String(!isOpen));
    details.classList.toggle("hidden", isOpen);
  });

  article.querySelector(".edit-event-btn")?.addEventListener("click", () => startEditEvent(event.id));
  article.querySelector(".delete-event-btn")?.addEventListener("click", () => deleteEvent(event.id));

  return article;
}

async function loadEvents() {
  setStatus(els.eventsStatus, cachedEvents.length ? "" : "Henter events...");

  const since = new Date(Date.now() - KEEP_AFTER_START_HOURS * 3600000).toISOString();
  const { data, error } = await supabase
    .from("events")
    .select("id, title, starts_at, location, description")
    .gte("starts_at", since)
    .order("starts_at", { ascending: true });

  if (error) {
    setStatus(els.eventsStatus, error.message, "error");
    return;
  }

  cachedEvents = data || [];
  els.eventList.innerHTML = "";

  if (!cachedEvents.length) {
    els.eventList.innerHTML = `
      <div class="event-empty">
        <strong>Ingen events lige nu</strong>
        Der er ikke planlagt noget endnu – kig forbi igen snart.
      </div>
    `;
  }

  cachedEvents.forEach((event, index) => {
    els.eventList.appendChild(renderEvent(event, index));
  });

  setStatus(els.eventsStatus, "");
}

function openEventForm() {
  els.eventFormCard.classList.remove("hidden");
  els.addEventBtn.classList.add("hidden");
  els.eventFormCard.scrollIntoView({ behavior: "smooth", block: "center" });
  els.eventTitle.focus({ preventScroll: true });
}

function closeEventForm() {
  els.eventForm.reset();
  els.editEventId.value = "";
  els.eventFormTitle.textContent = "Nyt event";
  els.eventSubmitBtn.textContent = "Gem event";
  setStatus(els.eventFormStatus, "");
  els.eventFormCard.classList.add("hidden");
  els.addEventBtn.classList.toggle("hidden", !isAdmin);
}

function startEditEvent(eventId) {
  const event = cachedEvents.find((item) => item.id === eventId);
  if (!event) return;

  const date = new Date(event.starts_at);
  els.editEventId.value = event.id;
  els.eventTitle.value = event.title || "";
  els.eventDate.value = toDateInputValue(date);
  els.eventTime.value = toTimeInputValue(date);
  els.eventLocation.value = event.location || "";
  els.eventDescription.value = event.description || "";
  els.eventFormTitle.textContent = "Rediger event";
  els.eventSubmitBtn.textContent = "Gem ændringer";
  setStatus(els.eventFormStatus, "");
  openEventForm();
}

async function saveEvent() {
  const eventId = els.editEventId.value;
  const startsAt = new Date(`${els.eventDate.value}T${els.eventTime.value}`);

  if (Number.isNaN(startsAt.getTime())) {
    setStatus(els.eventFormStatus, "Dato eller klokkeslæt er ugyldigt.", "error");
    return;
  }

  const payload = {
    title: els.eventTitle.value.trim(),
    starts_at: startsAt.toISOString(),
    location: els.eventLocation.value.trim(),
    description: els.eventDescription.value.trim() || null,
  };

  if (!payload.title || !payload.location) {
    setStatus(els.eventFormStatus, "Navn og sted skal udfyldes.", "error");
    return;
  }

  setStatus(els.eventFormStatus, "Gemmer...");
  els.eventSubmitBtn.disabled = true;

  const { error } = eventId
    ? await supabase.from("events").update(payload).eq("id", eventId)
    : await supabase.from("events").insert(payload);

  els.eventSubmitBtn.disabled = false;

  if (error) {
    setStatus(els.eventFormStatus, error.message, "error");
    return;
  }

  closeEventForm();
  await loadEvents();
  setStatus(els.eventsStatus, eventId ? "Event opdateret." : "Event tilføjet.", "success");
}

async function deleteEvent(eventId) {
  const event = cachedEvents.find((item) => item.id === eventId);
  if (!event) return;

  const confirmed = window.confirm(`Slet eventet '${event.title}'?\n\nDet kan ikke fortrydes.`);
  if (!confirmed) return;

  setStatus(els.eventsStatus, "Sletter event...");

  const { error } = await supabase.from("events").delete().eq("id", eventId);

  if (error) {
    setStatus(els.eventsStatus, error.message, "error");
    return;
  }

  if (els.editEventId.value === eventId) closeEventForm();
  await loadEvents();
  setStatus(els.eventsStatus, "Event slettet.", "success");
}

async function init() {
  if (!isSupabaseConfigured()) {
    els.setupWarning.classList.remove("hidden");
    return;
  }

  hydrateRememberedLogin(els.email, els.rememberLogin);
  els.eventsPanel.classList.remove("hidden");

  await refreshAuthUi();
  await loadEvents();
}

els.showLoginBtn.addEventListener("click", () => {
  const isHidden = els.loginPanel.classList.toggle("hidden");
  if (isHidden) return;

  els.loginPanel.scrollIntoView({ behavior: "smooth", block: "center" });
  (els.email.value ? els.password : els.email).focus({ preventScroll: true });
});

els.loginForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  setStatus(els.loginStatus, "Logger ind...");

  try {
    await login(els.email.value, els.password.value);
  } catch (_error) {
    setStatus(els.loginStatus, "Forkert email eller adgangskode.", "error");
    return;
  }

  handleRememberLogin(els.email.value, els.rememberLogin.checked);
  els.password.value = "";
  setStatus(els.loginStatus, "");

  await refreshAuthUi();
  await loadEvents();
  setStatus(
    els.eventsStatus,
    isAdmin ? "Du er logget ind som admin." : "Du er logget ind, men din bruger er ikke admin.",
    isAdmin ? "success" : "error"
  );
});

els.logoutBtn.addEventListener("click", async () => {
  await logout();
  await refreshAuthUi();
  await loadEvents();
});

els.addEventBtn.addEventListener("click", () => {
  closeEventForm();
  openEventForm();
});

els.cancelEventBtn.addEventListener("click", closeEventForm);

els.eventForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  await saveEvent();
});

init();
