import { createClient as createRawClient } from "https://esm.sh/@supabase/supabase-js@2";
import "./snapshot-client.js";
const createClient = (...args) => globalThis.VMGCSnapshot.wrapClient(createRawClient(...args));
import { SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY } from "./config_beta.js";

export const supabase = createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, {
  auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true }
});

export function readableError(error, fallback = "Ocurrió un error inesperado.") {
  console.error(error);
  return error?.message || error?.details || fallback;
}
