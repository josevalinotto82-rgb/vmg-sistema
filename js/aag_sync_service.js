import { supabase } from "./supabase.js";
import { SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY } from "./config.js";

const CLUB_ID = 408;
const FUNCTION_URL = `${SUPABASE_URL}/functions/v1/swift-worker`;

const cleanMemberNumber = value => String(value ?? "").trim();
const normalized = value => String(value || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toUpperCase().trim();
const isFemale = gender => ["female", "f", "1", "dama", "damas"].includes(String(gender || "").toLowerCase());

function nameKey(player) {
  const last = normalized(player?.last_name), first = normalized(player?.first_name);
  if (last || first) return `${last}|${first}`;
  const parts = normalized(player?.full_name).replace(/,/g, " ").replace(/\s+/g, " ").split(" ").filter(Boolean);
  return parts.length >= 2 ? `${parts[0]}|${parts.slice(1).join(" ")}` : parts.join(" ");
}

async function selectAll({ table, select, orderBy, filter }) {
  const pageSize = 1000;
  let from = 0, rows = [];
  while (true) {
    let query = supabase.from(table).select(select).range(from, from + pageSize - 1);
    if (orderBy) query = query.order(orderBy, { ascending: true });
    if (filter) query = filter(query);
    const { data, error } = await query;
    if (error) throw error;
    rows = rows.concat(data || []);
    if (!data || data.length < pageSize) break;
    from += pageSize;
  }
  return rows;
}

async function playersSnapshot() {
  const rows = await selectAll({
    table: "players",
    select: "id,first_name,last_name,full_name,gender,current_index,aag_member_number,country,club_name,option_club_id,is_club_member,is_aag_active,source,search_text,index_updated_at,born_date,doc_number,lowest_handicap_index",
    orderBy: "aag_member_number",
    filter: query => query.not("aag_member_number", "is", null)
  });
  const map = new Map();
  rows.forEach(player => { const member = cleanMemberNumber(player.aag_member_number); if (member) map.set(member, player); });
  return map;
}

async function manualPlayers() {
  return selectAll({
    table: "players",
    select: "id,first_name,last_name,full_name,gender,current_index,aag_member_number,country,club_name,option_club_id,is_club_member,is_aag_active,source,search_text,born_date,doc_number,lowest_handicap_index",
    orderBy: "full_name",
    filter: query => query.is("aag_member_number", null)
  });
}


async function playerUsage(playerId) {
  const definitions = [
    ["registrations", "linked_player_id"],
    ["scorecards", "linked_player_id"],
    ["tournament_payments", "linked_player_id"]
  ];
  const values = await Promise.all(definitions.map(async ([table, column]) => {
    const { count, error } = await supabase.from(table).select("id", { count: "exact", head: true }).eq(column, playerId);
    return [table, error ? null : count || 0];
  }));
  return Object.fromEntries(values);
}

export function currentThursdayStart(now = new Date()) {
  const parts = Object.fromEntries(new Intl.DateTimeFormat("en-CA", { timeZone:"America/Argentina/Cordoba", year:"numeric", month:"2-digit", day:"2-digit" }).formatToParts(now).filter(part => part.type !== "literal").map(part => [part.type, part.value]));
  const localMidnightUtc = new Date(Date.UTC(Number(parts.year), Number(parts.month) - 1, Number(parts.day), 3));
  const daysSinceThursday = (localMidnightUtc.getUTCDay() + 3) % 7;
  return new Date(localMidnightUtc.getTime() - daysSinceThursday * 86400000);
}

export async function getAagSyncStatus() {
  const historyResult = await supabase.from("aag_sync_history").select("id,created_at,added_count,updated_count,deactivated_count,before_vmgc,after_vmgc,data").eq("club_id",CLUB_ID).order("created_at",{ascending:false}).limit(1).maybeSingle();
  if(historyResult.error)throw historyResult.error;
  const latest = historyResult.data;
  const lastCompletedAt = latest?.created_at ? new Date(latest.created_at) : null;
  return {
    current: Boolean(lastCompletedAt && lastCompletedAt >= currentThursdayStart()),
    lastCompletedAt,
    sourceUpdatedAt: latest?.data?.generated_at ? new Date(latest.data.generated_at) : lastCompletedAt,
    latest
  };
}

async function callWorker(action, extra = {}) {
  const {data:{session},error} = await supabase.auth.getSession();
  if(error || !session) throw new Error("La sesión venció. Volvé a ingresar.");
  const response = await fetch(FUNCTION_URL, {
    method:"POST",headers:{"Content-Type":"application/json",Authorization:`Bearer ${session.access_token}`,apikey:SUPABASE_PUBLISHABLE_KEY},
    body:JSON.stringify({action,...extra})
  });
  const text=await response.text();
  let result;
  try {result=JSON.parse(text);} catch {throw new Error("El servidor no devolvió una respuesta válida. Revisá los informes antes de reintentar.");}
  if(!response.ok || result.ok!==true) throw new Error(result.error || "No se pudo sincronizar con AAG.");
  return result;
}

export async function prepareAagSync(onProgress = () => {}) {
  onProgress("Descargando y validando el padrón actual de AAG…");
  const prepared=await callWorker("prepare_sync_vmgc");
  try {
    onProgress("Revisando jugadores manuales contra el padrón recién recibido…");
    const [beforeMap,manuals]=await Promise.all([playersSnapshot(),manualPlayers()]);
    const pending=[];
    for(const player of prepared.vmgc_players || []) {
      const member=cleanMemberNumber(player.enrollment_number);
      if(beforeMap.has(member)) continue;
      const candidates=manuals.filter(p=>nameKey(p)===nameKey(player) && isFemale(p.gender)===isFemale(player.gender)).slice(0,5);
      if(candidates.length) pending.push({aag:{...player,aag_member_number:member},candidates});
    }
    await Promise.all(pending.flatMap(item=>item.candidates.map(async candidate=>{candidate.usage=await playerUsage(candidate.id);}))); 
    return {run_id:prepared.run_id,pending,links:[],completed:false};
  } catch(error) {
    await callWorker("cancel_sync_vmgc",{run_id:prepared.run_id}).catch(()=>{});
    throw error;
  }
}

export async function linkManualPlayer(candidate,aagPlayer,prepared) {
  const member=cleanMemberNumber(aagPlayer.aag_member_number || aagPlayer.enrollment_number);
  if(prepared.links.some(link=>link.player_id===candidate.id)) throw new Error("Ya elegiste ese jugador para otra matrícula.");
  prepared.links.push({player_id:candidate.id,matricula:member});
  // Se aplica junto con el padrón, dentro de la transacción del servidor.
}

export async function cancelAagSync(prepared) {
  if(prepared?.run_id && !prepared.completed) await callWorker("cancel_sync_vmgc",{run_id:prepared.run_id});
}

export async function executeAagSync(onProgress = () => {},prepared) {
  if(!prepared?.run_id) throw new Error("Primero hay que preparar la sincronización.");
  onProgress("Comparando y guardando los cambios AAG…");
  const result=await callWorker("sync_vmgc",{run_id:prepared.run_id,links:prepared.links});
  prepared.completed=true;
  if(result.schema_version!==2 || !result.history_id) throw new Error("La sincronización no devolvió el informe esperado.");
  return {history:{id:result.history_id},changes:result.changes};
}

export async function listAagSyncReports(limit = 30) {
  const { data, error } = await supabase.from("aag_sync_history").select("id,created_at,created_by,club_id,added_count,updated_count,deactivated_count,before_vmgc,after_vmgc,data").eq("club_id", CLUB_ID).order("created_at", { ascending:false }).limit(limit);
  if (error) throw error;
  return data || [];
}

export async function getAagSyncReport(id) {
  if (!id) throw new Error("Falta identificar el informe de actualización.");
  const { data, error } = await supabase.from("aag_sync_history").select("id,created_at,created_by,club_id,added_count,updated_count,deactivated_count,before_vmgc,after_vmgc,data").eq("club_id", CLUB_ID).eq("id", id).single();
  if (error) throw error;
  return data;
}

export async function getLatestIndexJob(){const {data,error}=await supabase.from('aag_sync_jobs_v3').select('id,status,message,attempts,pending,history_id,error_text,created_at,updated_at,finished_at').order('created_at',{ascending:false}).limit(1).maybeSingle();if(error)throw error;return data;}
export const startIndexJob=()=>callWorker('start_background_sync');
export const decideIndexJob=(jobId,matricula,playerId)=>callWorker('decide_background_sync',{job_id:jobId,matricula,player_id:playerId});
export const retryIndexJob=jobId=>callWorker('retry_background_sync',{job_id:jobId});
