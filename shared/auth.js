import { supabase } from "./supabase-client.js";

const AUTH_DOMAIN = "nextlevelmc.local";
const REMEMBER_USERNAME_KEY = "nextlevelmc_remember_username";

export function normalizeUsername(username) {
  return String(username || "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, "");
}

export function usernameToEmail(username) {
  const cleanUsername = normalizeUsername(username);
  if (!cleanUsername) throw new Error("Brugernavn mangler.");
  return `${cleanUsername}@${AUTH_DOMAIN}`;
}

export function getRememberedUsername() {
  return localStorage.getItem(REMEMBER_USERNAME_KEY) || "";
}

export function setRememberedUsername(username) {
  const cleanUsername = normalizeUsername(username);
  if (!cleanUsername) return;
  localStorage.setItem(REMEMBER_USERNAME_KEY, cleanUsername);
}

export function clearRememberedUsername() {
  localStorage.removeItem(REMEMBER_USERNAME_KEY);
}

export function hydrateRememberedLogin(usernameInput, rememberCheckbox) {
  if (!usernameInput || !rememberCheckbox) return;

  const rememberedUsername = getRememberedUsername();
  if (!rememberedUsername) return;

  usernameInput.value = rememberedUsername;
  rememberCheckbox.checked = true;
}

export function handleRememberLogin(username, shouldRemember) {
  if (shouldRemember) {
    setRememberedUsername(username);
  } else {
    clearRememberedUsername();
  }
}

export async function loginWithUsername(username, password) {
  const email = usernameToEmail(username);
  const { data, error } = await supabase.auth.signInWithPassword({
    email,
    password,
  });

  if (error) throw error;
  return data;
}

export async function logout() {
  const { error } = await supabase.auth.signOut();
  if (error) throw error;
}

export async function getCurrentUser() {
  const { data, error } = await supabase.auth.getUser();
  if (error) return null;
  return data?.user || null;
}

export async function getMyProfile() {
  const user = await getCurrentUser();
  if (!user) return null;

  const { data, error } = await supabase
    .from("profiles")
    .select("id, username, display_name, role, active, created_at, deleted_at")
    .eq("id", user.id)
    .single();

  if (error) throw error;
  return data;
}

export async function requireLogin() {
  const user = await getCurrentUser();
  if (!user) return null;

  const profile = await getMyProfile();
  if (!profile || profile.active !== true || profile.deleted_at) {
    await logout();
    return null;
  }

  return { user, profile };
}

export async function requireAdmin() {
  const authState = await requireLogin();
  if (!authState) return null;

  if (authState.profile.role !== "admin") {
    return { ...authState, isAdmin: false };
  }

  return { ...authState, isAdmin: true };
}
