import { supabase } from "./supabase-client.js";

const REMEMBER_EMAIL_KEY = "nextlevelmc_remember_email";

export function hydrateRememberedLogin(emailInput, rememberCheckbox) {
  if (!emailInput || !rememberCheckbox) return;

  const rememberedEmail = localStorage.getItem(REMEMBER_EMAIL_KEY) || "";
  if (!rememberedEmail) return;

  emailInput.value = rememberedEmail;
  rememberCheckbox.checked = true;
}

export function handleRememberLogin(email, shouldRemember) {
  const cleanEmail = String(email || "").trim().toLowerCase();

  if (shouldRemember && cleanEmail) {
    localStorage.setItem(REMEMBER_EMAIL_KEY, cleanEmail);
  } else {
    localStorage.removeItem(REMEMBER_EMAIL_KEY);
  }
}

export async function login(email, password) {
  const { data, error } = await supabase.auth.signInWithPassword({
    email: String(email || "").trim().toLowerCase(),
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

export async function isCurrentUserAdmin() {
  const { data, error } = await supabase.rpc("is_admin");
  if (error) return false;
  return data === true;
}
