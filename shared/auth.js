import { supabase } from "./supabase-client.js";

const AUTH_DOMAIN = "nextlevelmc.local";

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
    .select("id, username, display_name, role, active, created_at")
    .eq("id", user.id)
    .single();

  if (error) throw error;
  return data;
}

export async function requireLogin() {
  const user = await getCurrentUser();
  if (!user) return null;

  const profile = await getMyProfile();
  if (!profile || profile.active !== true) {
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
