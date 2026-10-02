import { supabase } from "./supabase-client.js";

// Brugere oprettet i admin-panelet logger ind med brugernavn, som bliver til en intern email.
const AUTH_DOMAIN = "nextlevelmc.local";
const REMEMBER_LOGIN_KEY = "nextlevelmc_remember_login";

function loginToEmail(login) {
  const clean = String(login || "").trim().toLowerCase().replace(/\s+/g, "");
  if (!clean) throw new Error("Brugernavn mangler.");
  return clean.includes("@") ? clean : `${clean}@${AUTH_DOMAIN}`;
}

export function hydrateRememberedLogin(loginInput, rememberCheckbox) {
  if (!loginInput || !rememberCheckbox) return;

  const remembered = localStorage.getItem(REMEMBER_LOGIN_KEY) || "";
  if (!remembered) return;

  loginInput.value = remembered;
  rememberCheckbox.checked = true;
}

export function handleRememberLogin(login, shouldRemember) {
  const clean = String(login || "").trim().toLowerCase();

  if (shouldRemember && clean) {
    localStorage.setItem(REMEMBER_LOGIN_KEY, clean);
  } else {
    localStorage.removeItem(REMEMBER_LOGIN_KEY);
  }
}

export async function login(usernameOrEmail, password) {
  const { data, error } = await supabase.auth.signInWithPassword({
    email: loginToEmail(usernameOrEmail),
    password,
  });

  if (error) throw error;
  return data;
}

export async function logout() {
  const { error } = await supabase.auth.signOut();
  if (error) throw error;
}

// Bruger den lokalt gemte session, så besøgende uden login ikke koster et netværkskald.
export async function getCurrentUser() {
  const { data, error } = await supabase.auth.getSession();
  if (error) return null;
  return data?.session?.user || null;
}

export async function getMyProfile() {
  const user = await getCurrentUser();
  if (!user) return null;

  const { data, error } = await supabase
    .from("profiles")
    .select("id, username, display_name, role")
    .eq("id", user.id)
    .maybeSingle();

  if (error) return null;
  return data;
}
