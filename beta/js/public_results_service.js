import { supabase } from "./supabase.js";
import { loadResultsWorkspace } from "./results_service.js";

export async function listPublicTournaments() {
  const rows=[];
  for(let from=0;;from+=500) {
    const {data,error}=await supabase.from("tournaments")
      .select("id,name,tournament_date,hole_count,status,game_modes(name)")
      .eq("data_schema_version",2).eq("published",true)
      .in("status",["officialized","archived"])
      .order("tournament_date",{ascending:false}).order("id")
      .range(from,from+499);
    if(error)throw error;
    rows.push(...(data||[]));
    if((data||[]).length<500)return rows;
  }
}

export const loadPublicResults = id => loadResultsWorkspace(id,{publicOnly:true});
