import { supabase } from "./supabase.js";

export async function getUserDisplayName(user) {
  if (!user?.id) return "";
  const [profileResult, playerResult] = await Promise.all([
    supabase
      .from("profiles")
      .select("profile_type,first_name,last_name,organization_name,display_name")
      .eq("id", user.id)
      .maybeSingle(),
    supabase
      .from("players")
      .select("full_name,first_name,last_name")
      .eq("profile_id", user.id)
      .maybeSingle()
  ]);

  if (profileResult.error) console.warn("No se pudo obtener el perfil del usuario", profileResult.error);
  if (playerResult.error) console.warn("No se pudo obtener el jugador vinculado", playerResult.error);

  const profile = profileResult.data;
  const player = playerResult.data;
  const isOrganization = profile?.profile_type === "organization";
  const raw = isOrganization
    ? profile.organization_name || profile.display_name
    : profile?.first_name
      || profile?.display_name
      || player?.first_name
      || String(player?.full_name || "").split(/[ ,]+/).filter(Boolean).at(-1)
      || user.user_metadata?.first_name
      || user.user_metadata?.name
      || String(user.email || "").split("@")[0];
  if (isOrganization) return String(raw || "").trim();
  const name = String(raw || "").trim().toLocaleLowerCase("es-AR");
  return name ? name.charAt(0).toLocaleUpperCase("es-AR") + name.slice(1) : "";
}

export async function listOperationalTournaments({ limit = 30 } = {}) {
  const { data, error } = await supabase
    .from("tournaments")
    .select(`id,name,tournament_date,status,published,hole_count,start_type,scoring_mode,data_schema_version,series_id,series_round_number,notes,game_modes(id,name)`)
    .eq("data_schema_version", 2)
    .in("status", ["draft", "closed", "open", "officialized", "archived"])
    .order("tournament_date", { ascending: false })
    .limit(Math.max(limit, 100));
  if (error) throw error;
  const tournaments=(data || []).filter(row=>!String(row.notes||"").startsWith("VMGC_FREE_SCORECARD_V2"));
  const ids=tournaments.map(row=>row.id);
  let exportedIds=new Set();
  if(ids.length){
    const exportsResult=await supabase.from("aag_exports").select("tournament_id,status,aag_success").in("tournament_id",ids).is("deleted_at",null);
    if(exportsResult.error)console.warn("No se pudo verificar la exportación AAG",exportsResult.error);
    else exportedIds=new Set((exportsResult.data||[]).filter(row=>row.aag_success===true||["sent","partial"].includes(String(row.status||"").toLowerCase())).map(row=>String(row.tournament_id)));
  }
  return tournaments.map(row=>({...row,aag_exported:exportedIds.has(String(row.id))})).slice(0,limit);
}

async function count(table, tournamentId, filters = {}) {
  let query = supabase.from(table).select("id", { count: "exact", head: true }).eq("tournament_id", tournamentId);
  for (const [column, value] of Object.entries(filters)) query = query.eq(column, value);
  const { count: total, error } = await query;
  if (error) throw error;
  return total || 0;
}

export async function getTournamentMetrics(tournamentId) {
  if (!tournamentId) return { registrations: 0, scorecards: 0, ready: 0, exported: 0 };
  const [registrations, scorecards, ready, exported] = await Promise.all([
    count("registrations", tournamentId),
    count("scorecards", tournamentId),
    count("scorecards", tournamentId, { export_ready: true }),
    count("scorecards", tournamentId, { exported_to_aag: true })
  ]);
  return { registrations, scorecards, ready, exported };
}

export async function listPublishedOpenTournaments() {
  const { data, error } = await supabase
    .from("tournaments")
    .select("id,name,tournament_date,status,hole_count,start_type,game_modes(name)")
    .eq("published", true)
    .eq("data_schema_version", 2)
    .in("status", ["open", "closed"])
    .order("tournament_date", { ascending: true });
  if (error) throw error;
  return data || [];
}
