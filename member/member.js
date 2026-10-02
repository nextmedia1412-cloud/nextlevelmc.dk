import { supabase, isSupabaseConfigured } from "../shared/supabase-client.js";
import {
  login,
  logout,
  getCurrentUser,
  getMyProfile,
  hydrateRememberedLogin,
  handleRememberLogin,
} from "../shared/auth.js";

// Events bliver stående på listen så længe efter starttidspunktet.
const KEEP_AFTER_START_HOURS = 6;

// Offentlig nøgle til push. Den private ligger som secret på edge function "push".
const VAPID_PUBLIC_KEY = "BILwW9ABpSlAf7Y3HRmOdIV4w2H6CF0gh6ydXpi8eN86NKu4O2lz7AZoR3JKBhr7IKGk0LvwK_U7jio3RLlXjv4";
const SERVICE_WORKER_URL = new URL("../sw.js", import.meta.url);

const els = {
  setupWarning: document.querySelector("#setupWarning"),
  memberGreeting: document.querySelector("#memberGreeting"),
  loginPanel: document.querySelector("#loginPanel"),
  loginForm: document.querySelector("#loginForm"),
  loginName: document.querySelector("#loginName"),
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

  pushPanel: document.querySelector("#pushPanel"),
  pushHint: document.querySelector("#pushHint"),
  pushToggleBtn: document.querySelector("#pushToggleBtn"),
  pushTestBtn: document.querySelector("#pushTestBtn"),
  pushStatus: document.querySelector("#pushStatus"),

  adminPanel: document.querySelector("#adminPanel"),
  userList: document.querySelector("#userList"),
  userStatus: document.querySelector("#userStatus"),
  userForm: document.querySelector("#userForm"),
  newDisplayName: document.querySelector("#newDisplayName"),
  newUsername: document.querySelector("#newUsername"),
  newPassword: document.querySelector("#newPassword"),
  newRole: document.querySelector("#newRole"),
  userSubmitBtn: document.querySelector("#userSubmitBtn"),

  showLoginBtn: document.querySelector("#showLoginBtn"),
  logoutBtn: document.querySelector("#logoutBtn"),
};

// Egen profil, når man er logget ind som medlem. null for besøgende.
let myProfile = null;
let isAdmin = false;
let cachedEvents = [];
let cachedProfiles = [];
// event-id → [{ user_id, status }]
let responsesByEvent = new Map();
// Husker hvad der er foldet ud, så listen kan tegnes igen uden at klappe sammen.
const openEventIds = new Set();
const openAttendeeIds = new Set();

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

// Kalder en edge function og giver funktionens egen fejlbesked videre.
async function invokeFunction(name, body) {
  const { data, error } = await supabase.functions.invoke(name, { body });
  if (!error) return data;

  let message = error.message;
  try {
    const payload = await error.context.json();
    if (payload?.message) message = payload.message;
  } catch (_error) {
    // Behold standardbeskeden.
  }
  throw new Error(message);
}

// Sætter knapper og paneler efter hvem der er logget ind.
async function refreshAuthUi() {
  const user = await getCurrentUser();
  myProfile = user ? await getMyProfile() : null;
  isAdmin = myProfile?.role === "admin";

  els.showLoginBtn.classList.toggle("hidden", Boolean(user));
  els.logoutBtn.classList.toggle("hidden", !user);
  els.addEventBtn.classList.toggle("hidden", !isAdmin);
  els.adminPanel.classList.toggle("hidden", !isAdmin);
  if (user) els.loginPanel.classList.add("hidden");
  if (!isAdmin) els.eventFormCard.classList.add("hidden");

  els.memberGreeting.textContent = myProfile ? `Velkommen ${myProfile.display_name}` : "Danmark • 1412";

  await refreshPushUi();
  return Boolean(user);
}

/* ---------- Events og svar ---------- */

function attendeeGroups(eventId) {
  const statusByUser = new Map((responsesByEvent.get(eventId) || []).map((row) => [row.user_id, row.status]));
  const names = (status) =>
    cachedProfiles.filter((profile) => statusByUser.get(profile.id) === status).map((profile) => profile.display_name);

  return {
    mine: statusByUser.get(myProfile?.id) || null,
    yes: names("yes"),
    no: names("no"),
    missing: cachedProfiles.filter((profile) => !statusByUser.has(profile.id)).map((profile) => profile.display_name),
  };
}

function renderNameGroup(label, names, type) {
  return `
    <div class="attendee-group">
      <span class="attendee-label ${type}">${label} (${names.length})</span>
      <span class="attendee-names">${names.length ? escapeHtml(names.join(", ")) : "Ingen"}</span>
    </div>
  `;
}

function renderRsvp(event) {
  if (!myProfile) {
    return `<p class="rsvp-note">Log ind for at svare og se, hvem der kommer.</p>`;
  }

  const groups = attendeeGroups(event.id);

  return `
    <div class="rsvp">
      <div class="rsvp-buttons">
        <button class="member-btn member-btn--ghost rsvp-btn rsvp-btn--yes ${groups.mine === "yes" ? "is-active" : ""}" type="button" data-status="yes">✓ Jeg kommer</button>
        <button class="member-btn member-btn--ghost rsvp-btn rsvp-btn--no ${groups.mine === "no" ? "is-active" : ""}" type="button" data-status="no">✕ Kommer ikke</button>
      </div>
      <details class="attendees" ${openAttendeeIds.has(event.id) ? "open" : ""}>
        <summary>
          <span>Hvem kommer?</span>
          <span class="attendee-count">${groups.yes.length} kommer · ${groups.no.length} kommer ikke · ${groups.missing.length} mangler</span>
        </summary>
        ${renderNameGroup("Kommer", groups.yes, "ok")}
        ${renderNameGroup("Kommer ikke", groups.no, "danger")}
        ${renderNameGroup("Har ikke svaret", groups.missing, "")}
      </details>
    </div>
  `;
}

function myStatusChip(eventId) {
  if (!myProfile) return "";

  const mine = attendeeGroups(eventId).mine;
  if (mine === "yes") return `<span class="event-chip ok">✓ Du kommer</span>`;
  if (mine === "no") return `<span class="event-chip danger">✕ Du kommer ikke</span>`;
  return `<span class="event-chip">Svar mangler</span>`;
}

function renderEvent(event, index) {
  const date = new Date(event.starts_at);
  const parts = formatParts(date);
  const description = String(event.description || "").trim();
  const isOpen = openEventIds.has(event.id);
  const article = document.createElement("article");
  article.className = "event";
  article.style.setProperty("--i", index);

  article.innerHTML = `
    <button class="glass-button event-button ${index === 0 ? "glass-button--gold" : ""}" type="button" aria-expanded="${isOpen}">
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
        ${myStatusChip(event.id)}
      </span>
      <span class="button-arrow event-chevron">⌄</span>
    </button>
    <div class="event-details ${isOpen ? "" : "hidden"}">
      <p class="${description ? "" : "is-empty"}">${escapeHtml(description || "Ingen yderligere info endnu.")}</p>
      ${renderRsvp(event)}
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
    const wasOpen = button.getAttribute("aria-expanded") === "true";
    button.setAttribute("aria-expanded", String(!wasOpen));
    details.classList.toggle("hidden", wasOpen);
    if (wasOpen) openEventIds.delete(event.id);
    else openEventIds.add(event.id);
  });

  article.querySelectorAll(".rsvp-btn").forEach((rsvpButton) => {
    rsvpButton.addEventListener("click", () => saveResponse(event.id, rsvpButton.dataset.status));
  });

  article.querySelector(".attendees")?.addEventListener("toggle", (toggleEvent) => {
    if (toggleEvent.target.open) openAttendeeIds.add(event.id);
    else openAttendeeIds.delete(event.id);
  });

  article.querySelector(".edit-event-btn")?.addEventListener("click", () => startEditEvent(event.id));
  article.querySelector(".delete-event-btn")?.addEventListener("click", () => deleteEvent(event.id));

  return article;
}

function renderEvents() {
  // Kun første visning animeres ind – ellers hopper listen, hver gang man svarer.
  const isFirstRender = !els.eventList.children.length;
  els.eventList.classList.toggle("is-static", !isFirstRender);
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
}

async function loadMemberData() {
  cachedProfiles = [];
  responsesByEvent = new Map();
  if (!myProfile) return;

  const eventIds = cachedEvents.map((event) => event.id);
  const [profilesResult, responsesResult] = await Promise.all([
    supabase.from("profiles").select("id, username, display_name, role").order("display_name", { ascending: true }),
    eventIds.length
      ? supabase.from("event_responses").select("event_id, user_id, status").in("event_id", eventIds)
      : Promise.resolve({ data: [], error: null }),
  ]);

  if (profilesResult.error || responsesResult.error) {
    setStatus(els.eventsStatus, (profilesResult.error || responsesResult.error).message, "error");
    return;
  }

  cachedProfiles = profilesResult.data || [];
  for (const row of responsesResult.data || []) {
    if (!responsesByEvent.has(row.event_id)) responsesByEvent.set(row.event_id, []);
    responsesByEvent.get(row.event_id).push(row);
  }
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
  setStatus(els.eventsStatus, "");

  await loadMemberData();
  renderEvents();
  renderUsers();
}

async function saveResponse(eventId, status) {
  if (!myProfile) return;

  const { error } = await supabase.from("event_responses").upsert(
    { event_id: eventId, user_id: myProfile.id, status, updated_at: new Date().toISOString() },
    { onConflict: "event_id,user_id" }
  );

  if (error) {
    setStatus(els.eventsStatus, error.message, "error");
    return;
  }

  setStatus(els.eventsStatus, "");
  await loadMemberData();
  renderEvents();
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

  const { data, error } = eventId
    ? await supabase.from("events").update(payload).eq("id", eventId).select("id").single()
    : await supabase.from("events").insert(payload).select("id").single();

  els.eventSubmitBtn.disabled = false;

  if (error) {
    setStatus(els.eventFormStatus, error.message, "error");
    return;
  }

  closeEventForm();
  await loadEvents();

  if (eventId) {
    setStatus(els.eventsStatus, "Event opdateret.", "success");
    return;
  }

  try {
    const result = await invokeFunction("push", { action: "new_event", event_id: data.id });
    setStatus(els.eventsStatus, `Event tilføjet. Notifikation sendt til ${result?.sent ?? 0} enheder.`, "success");
  } catch (pushError) {
    setStatus(els.eventsStatus, `Event tilføjet, men notifikationen blev ikke sendt: ${pushError.message}`, "error");
  }
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

/* ---------- Notifikationer ---------- */

const pushSupported = "serviceWorker" in navigator && "PushManager" in window && "Notification" in window;
const isIos = /iphone|ipad|ipod/i.test(navigator.userAgent);
const isStandalone = window.matchMedia("(display-mode: standalone)").matches || navigator.standalone === true;

function urlBase64ToUint8Array(base64) {
  const padded = (base64 + "=".repeat((4 - (base64.length % 4)) % 4)).replaceAll("-", "+").replaceAll("_", "/");
  return Uint8Array.from(atob(padded), (char) => char.charCodeAt(0));
}

async function getPushSubscription() {
  if (!pushSupported) return null;
  const registration = await navigator.serviceWorker.getRegistration(SERVICE_WORKER_URL);
  return registration ? registration.pushManager.getSubscription() : null;
}

async function storePushSubscription(subscription) {
  const keys = subscription.toJSON().keys || {};
  const { error } = await supabase.from("push_subscriptions").upsert(
    { user_id: myProfile.id, endpoint: subscription.endpoint, p256dh: keys.p256dh, auth: keys.auth },
    { onConflict: "endpoint" }
  );
  if (error) throw new Error(error.message);
}

async function refreshPushUi() {
  els.pushPanel.classList.toggle("hidden", !myProfile);
  if (!myProfile) return;

  const showOnlyHint = (hint) => {
    els.pushHint.textContent = hint;
    els.pushToggleBtn.classList.add("hidden");
    els.pushTestBtn.classList.add("hidden");
  };

  if (isIos && !isStandalone) {
    showOnlyHint("På iPhone skal siden først gemmes på hjemmeskærmen: tryk på Del-ikonet i Safari, vælg \"Føj til hjemmeskærm\", og åbn siden derfra. Så kan du slå notifikationer til her.");
    return;
  }

  if (!pushSupported) {
    showOnlyHint("Denne browser understøtter ikke notifikationer.");
    return;
  }

  if (Notification.permission === "denied") {
    showOnlyHint("Notifikationer er blokeret for siden. Tillad dem i telefonens eller browserens indstillinger, og åbn siden igen.");
    return;
  }

  const subscription = await getPushSubscription();
  els.pushToggleBtn.classList.remove("hidden");
  els.pushToggleBtn.classList.toggle("member-btn--ghost", Boolean(subscription));
  els.pushToggleBtn.textContent = subscription ? "Slå notifikationer fra" : "Slå notifikationer til";
  els.pushTestBtn.classList.toggle("hidden", !subscription);
  els.pushHint.textContent = subscription
    ? "Notifikationer er slået til på denne enhed."
    : "Få besked om nye events, påmindelse dagen før og hvis du mangler at svare.";

  // Sørger for at tilmeldingen står på den bruger, der er logget ind nu.
  if (subscription) storePushSubscription(subscription).catch(() => {});
}

async function enablePush() {
  const permission = await Notification.requestPermission();
  if (permission !== "granted") throw new Error("Du skal trykke Tillad for at få notifikationer.");

  await navigator.serviceWorker.register(SERVICE_WORKER_URL);
  const registration = await navigator.serviceWorker.ready;
  const subscription = await registration.pushManager.subscribe({
    userVisibleOnly: true,
    applicationServerKey: urlBase64ToUint8Array(VAPID_PUBLIC_KEY),
  });

  await storePushSubscription(subscription);
}

async function disablePush() {
  const subscription = await getPushSubscription();
  if (!subscription) return;

  await supabase.from("push_subscriptions").delete().eq("endpoint", subscription.endpoint);
  await subscription.unsubscribe();
}

/* ---------- Admin: brugere ---------- */

function renderUsers() {
  if (!isAdmin) {
    els.userList.innerHTML = "";
    return;
  }

  els.userList.innerHTML = cachedProfiles
    .map((profile) => {
      const isSelf = profile.id === myProfile.id;
      const isUserAdmin = profile.role === "admin";
      return `
        <div class="user-row" data-user-id="${escapeHtml(profile.id)}">
          <div class="user-info">
            <strong>${escapeHtml(profile.display_name)}${isSelf ? " (dig)" : ""}</strong>
            <span>@${escapeHtml(profile.username)}</span>
          </div>
          <span class="event-chip ${isUserAdmin ? "ok" : ""}">${isUserAdmin ? "Admin" : "Medlem"}</span>
          <div class="user-actions">
            <button class="member-btn member-btn--ghost member-btn--small" type="button" data-action="set_role" ${isSelf ? "disabled" : ""}>
              ${isUserAdmin ? "Gør til medlem" : "Gør til admin"}
            </button>
            <button class="member-btn member-btn--ghost member-btn--small" type="button" data-action="rename">Omdøb</button>
            <button class="member-btn member-btn--ghost member-btn--small" type="button" data-action="set_password">Ny kode</button>
            <button class="member-btn member-btn--danger member-btn--small" type="button" data-action="delete" ${isSelf ? "disabled" : ""}>Slet</button>
          </div>
        </div>
      `;
    })
    .join("");

  els.userList.querySelectorAll("button[data-action]").forEach((button) => {
    const userId = button.closest(".user-row").dataset.userId;
    button.addEventListener("click", () => handleUserAction(button.dataset.action, userId));
  });
}

async function handleUserAction(action, userId) {
  const profile = cachedProfiles.find((item) => item.id === userId);
  if (!profile) return;

  const body = { action, user_id: userId };

  if (action === "set_role") {
    body.role = profile.role === "admin" ? "member" : "admin";
    const question = body.role === "admin"
      ? `Gør ${profile.display_name} til admin?\n\nAdmins kan oprette events og administrere brugere.`
      : `Fjern admin-rettigheden fra ${profile.display_name}?`;
    if (!window.confirm(question)) return;
  }

  if (action === "rename") {
    const displayName = window.prompt(`Nyt navn for ${profile.display_name}:`, profile.display_name);
    if (!displayName || !displayName.trim()) return;
    body.display_name = displayName.trim();
  }

  if (action === "set_password") {
    const password = window.prompt(`Ny adgangskode til ${profile.display_name} (mindst 6 tegn):`);
    if (!password) return;
    body.password = password;
  }

  if (action === "delete") {
    const confirmed = window.confirm(
      `Slet brugeren ${profile.display_name}?\n\nBrugeren kan ikke længere logge ind, og deres svar på events fjernes. Det kan ikke fortrydes.`
    );
    if (!confirmed) return;
  }

  setStatus(els.userStatus, "Gemmer...");

  try {
    const result = await invokeFunction("admin-users", body);
    await loadEvents();
    setStatus(els.userStatus, result?.message || "Gemt.", "success");
  } catch (error) {
    setStatus(els.userStatus, error.message, "error");
  }
}

/* ---------- Opstart og knapper ---------- */

async function init() {
  if (!isSupabaseConfigured()) {
    els.setupWarning.classList.remove("hidden");
    return;
  }

  hydrateRememberedLogin(els.loginName, els.rememberLogin);
  els.eventsPanel.classList.remove("hidden");

  const isLoggedIn = await refreshAuthUi();
  await loadEvents();

  if (isLoggedIn && !myProfile) {
    setStatus(els.eventsStatus, "Du er logget ind, men din bruger er ikke oprettet som medlem.", "error");
  }
}

els.showLoginBtn.addEventListener("click", () => {
  const isHidden = els.loginPanel.classList.toggle("hidden");
  if (isHidden) return;

  els.loginPanel.scrollIntoView({ behavior: "smooth", block: "center" });
  (els.loginName.value ? els.password : els.loginName).focus({ preventScroll: true });
});

els.loginForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  setStatus(els.loginStatus, "Logger ind...");

  try {
    await login(els.loginName.value, els.password.value);
  } catch (_error) {
    setStatus(els.loginStatus, "Forkert brugernavn eller adgangskode.", "error");
    return;
  }

  handleRememberLogin(els.loginName.value, els.rememberLogin.checked);
  els.password.value = "";
  setStatus(els.loginStatus, "");

  await refreshAuthUi();
  await loadEvents();

  if (!myProfile) {
    setStatus(els.eventsStatus, "Du er logget ind, men din bruger er ikke oprettet som medlem.", "error");
  }
  window.scrollTo({ top: 0, behavior: "smooth" });
});

els.logoutBtn.addEventListener("click", async () => {
  // Telefonen skal ikke blive ved med at få den afloggede brugers notifikationer.
  await disablePush().catch(() => {});
  await logout();
  openEventIds.clear();
  openAttendeeIds.clear();
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

els.pushToggleBtn.addEventListener("click", async () => {
  els.pushToggleBtn.disabled = true;
  setStatus(els.pushStatus, "");

  try {
    if (await getPushSubscription()) {
      await disablePush();
    } else {
      await enablePush();
      setStatus(els.pushStatus, "Notifikationer er slået til.", "success");
    }
  } catch (error) {
    setStatus(els.pushStatus, error.message || "Notifikationer kunne ikke slås til.", "error");
  }

  els.pushToggleBtn.disabled = false;
  await refreshPushUi();
});

els.pushTestBtn.addEventListener("click", async () => {
  setStatus(els.pushStatus, "Sender...");

  try {
    const result = await invokeFunction("push", { action: "test" });
    setStatus(
      els.pushStatus,
      result?.sent ? "Prøve-notifikation sendt." : "Ingen enheder er tilmeldt endnu.",
      result?.sent ? "success" : "error"
    );
  } catch (error) {
    setStatus(els.pushStatus, error.message, "error");
  }
});

els.userForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  setStatus(els.userStatus, "Opretter bruger...");
  els.userSubmitBtn.disabled = true;

  try {
    const result = await invokeFunction("admin-users", {
      action: "create",
      display_name: els.newDisplayName.value,
      username: els.newUsername.value,
      password: els.newPassword.value,
      role: els.newRole.value,
    });
    els.userForm.reset();
    await loadEvents();
    setStatus(els.userStatus, result?.message || "Bruger oprettet.", "success");
  } catch (error) {
    setStatus(els.userStatus, error.message, "error");
  }

  els.userSubmitBtn.disabled = false;
});

init();
