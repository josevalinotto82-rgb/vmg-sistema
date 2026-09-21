import { supabase } from "./supabase_beta.js";

function isEffectiveExport(row) {
  const status = String(row?.status || "").toLowerCase();
  const remote = String(row?.aag_remote_status || "").toLowerCase();
  return status === "sent" || !!row?.aag_tournament_id || ["abierto", "procesado", "modificado"].includes(remote);
}

export async function getUserDisplayName(user) {
  if (!user?.id) return "";
  const { data, error } = await supabase.from("players").select("full_name,first_name,last_name").eq("profile_id", user.id).maybeSingle();
  if (error) console.warn("No se pudo obtener el nombre del usuario", error);
  const raw = data?.first_name || String(data?.full_name || "").split(/[ ,]+/).filter(Boolean).at(-1) || user.user_metadata?.first_name || user.user_metadata?.name || String(user.email || "").split("@")[0];
  const name = String(raw || "").trim().toLocaleLowerCase("es-AR");
  return name ? name.charAt(0).toLocaleUpperCase("es-AR") + name.slice(1) : "";
}

export async function listOperationalTournaments({ limit = 30 } = {}) {
  const { data, error } = await supabase
    .from("tournaments")
    .select(`id,name,tournament_date,status,published,hole_count,start_type,scoring_mode,data_schema_version,series_id,series_round_number,game_modes(id,name)`)
    .eq("data_schema_version", 2)
    .in("status", ["draft", "closed", "open", "officialized", "archived"])
    .order("tournament_date", { ascending: false })
    .limit(Math.max(limit, 100));
  if (error) throw error;
  const rows = data || [];
  if (!rows.length) return rows;

  const { data: exports, error: exportError } = await supabase
    .from("aag_exports")
    .select("tournament_id,status,aag_tournament_id,aag_remote_status,is_current")
    .in("tournament_id", rows.map(row => row.id))
    .eq("is_current", true);
  if (exportError) throw exportError;

  const exportMap = new Map();
  for (const row of exports || []) {
    if (!isEffectiveExport(row)) continue;
    const key = String(row.tournament_id);
    exportMap.set(key, true);
  }

  const enriched = rows.map(row => {
    return { ...row, aag_exported: exportMap.has(String(row.id)) };
  });
  const archivedExported = enriched.filter(row => row.status === "archived" && row.aag_exported).slice(0, 2);
  const visible = enriched.filter(row => !(row.status === "archived" && row.aag_exported));
  return [...visible, ...archivedExported].sort((a, b) => String(b.tournament_date).localeCompare(String(a.tournament_date))).slice(0, limit);
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
  const [registrations, scorecards, ready, exportResult] = await Promise.all([
    count("registrations", tournamentId),
    count("scorecards", tournamentId),
    count("scorecards", tournamentId, { export_ready: true }),
    supabase
      .from("aag_exports")
      .select("status,aag_tournament_id,aag_remote_status,aag_added_scorecards,aag_valid_scorecards,aag_total_scorecards,payload")
      .eq("tournament_id", tournamentId)
      .eq("is_current", true)
  ]);
  if (exportResult.error) throw exportResult.error;
  const exported = (exportResult.data || [])
    .filter(isEffectiveExport)
    .reduce((total, row) => {
      const payloadCards = Array.isArray(row.payload?.ScoreCards) ? row.payload.ScoreCards.length : 0;
      return total + Number(row.aag_added_scorecards ?? row.aag_valid_scorecards ?? row.aag_total_scorecards ?? payloadCards ?? 0);
    }, 0);
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
