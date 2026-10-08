import { supabase } from "./supabase.js";
import { PAGES } from "./config.js";

let cachedContext = null;

export async function getAuthContext({ force = false } = {}) {
  if (cachedContext && !force) return cachedContext;
  const { data: { session }, error: sessionError } = await supabase.auth.getSession();
  if (sessionError) throw sessionError;
  if (!session?.user) return { session: null, user: null, profile: null };
  const { data: profile, error: profileError } = await supabase
    .from("profiles")
    .select("id, role, active")
    .eq("id", session.user.id)
    .maybeSingle();
  if (profileError) throw profileError;
  cachedContext = { session, user: session.user, profile };
  return cachedContext;
}

export async function requireSession({ admin = false } = {}) {
  const context = await getAuthContext();
  if (!context.session) {
    const next = encodeURIComponent(location.pathname.split("/").pop() + location.search);
    location.replace(`${PAGES.login}?next=${next}`);
    throw new Error("Sesión requerida");
  }
  if (!context.profile?.active) {
    await supabase.auth.signOut();
    location.replace(`${PAGES.login}?inactive=1`);
    throw new Error("Usuario inactivo");
  }
  if (admin && context.profile.role !== "admin") {
    await supabase.auth.signOut();
    cachedContext = null;
    location.replace(`${PAGES.login}?admin_required=1`);
    throw new Error("Permiso de administrador requerido");
  }
  return context;
}

export async function signIn(email, password) {
  const { data, error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) throw error;
  cachedContext = null;
  const context = await getAuthContext();
  if (!context.profile?.active || context.profile.role !== "admin") {
    await supabase.auth.signOut();
    cachedContext = null;
    throw new Error("Este sistema es exclusivo para administradores activos.");
  }
  return data;
}

export async function signOut() {
  await supabase.auth.signOut();
  cachedContext = null;
  location.replace(PAGES.login);
}
