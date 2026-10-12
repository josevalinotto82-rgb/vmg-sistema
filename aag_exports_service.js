import { supabase } from "./supabase.js";
import { SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY } from "./config.js";

const FUNCTION_URL = `${SUPABASE_URL}/functions/v1/swift-worker`;

async function adminWorker(action, extra = {}) {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) throw new Error("La sesión venció. Volvé a ingresar.");
  const response = await fetch(FUNCTION_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${session.access_token}`,
      apikey: SUPABASE_PUBLISHABLE_KEY
    },
    body: JSON.stringify({ action, ...extra })
  });
  const text = await response.text();
  let data = {};
  try { data = text ? JSON.parse(text) : {}; }
  catch { data = { raw_response: text }; }
  if (!response.ok || data.ok === false) throw new Error(data.error || data.message || text || "AAG no respondió correctamente.");
  return data;
}

export async function listCurrentAagExports() {
  const { data, error } = await supabase
    .from("aag_exports")
    .select(`
      id,tournament_id,title,start_date,status,is_current,tee_name,gender,
      aag_field_id,aag_teeout_id,aag_tournament_id,aag_remote_status,
      aag_last_check_at,aag_last_sync_ok,aag_total_scorecards,
      aag_valid_scorecards,aag_error_scorecards,aag_added_scorecards,
      aag_error,created_at,sent_at,
      tournament:tournaments!aag_exports_tournament_id_fkey(id,name,tournament_date,status)
    `)
    .eq("is_current", true)
    .not("aag_tournament_id", "is", null)
    .order("start_date", { ascending: false })
    .order("tee_name", { ascending: true });
  if (error) throw error;
  return data || [];
}

export const refreshAllAagStatuses = () => adminWorker("refresh_all_exports");
export const syncAagFields = () => adminWorker("sync_fields");
