import { supabase } from "./supabase_beta.js";

export async function listOperationalTournaments({ limit = 30 } = {}) {
  const { data, error } = await supabase
    .from("tournaments")
    .select(`id,name,tournament_date,status,published,hole_count,start_type,scoring_mode,data_schema_version,series_id,series_round_number,game_modes(id,name)`)
    .eq("data_schema_version", 2)
    .in("status", ["draft", "closed", "open", "officialized", "archived"])
    .order("tournament_date", { ascending: false })
    .limit(limit);
  if (error) throw error;
  return data || [];
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
