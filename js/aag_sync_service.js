import { supabase } from "./supabase.js";
import { SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY } from "./config.js";

const CLUB_ID = 408;
const FUNCTION_URL = `${SUPABASE_URL}/functions/v1/swift-worker`;

const cleanMemberNumber = value => String(value ?? "").trim();
const indexNumber = value => {
  const number = Number(String(value ?? "").replace(",", "."));
  return Number.isFinite(number) ? Math.round(number * 10) / 10 : null;
};
const normalized = value => String(value || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toUpperCase().trim();
const playerName = player => player?.full_name || [player?.last_name, player?.first_name].filter(Boolean).join(", ") || "Sin nombre";
const isFemale = gender => ["female", "f", "1", "dama", "damas"].includes(String(gender || "").toLowerCase());
const isVmgc = player => Number(player?.option_club_id) === CLUB_ID || player?.is_club_member === true;
const isActiveVmgc = player => Boolean(player) && isVmgc(player) && player?.is_aag_active !== false;

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

async function vmgcAagPlayers() {
  return selectAll({
    table: "aag_enrolleds",
    select: "enrollment_number,first_name,last_name,full_name,gender,current_index,option_club_id,club_name,search_text,born_date,doc_number,lowest_handicap_index,last_sync_at",
    orderBy: "enrollment_number",
    filter: query => query.eq("option_club_id", CLUB_ID)
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
  const [historyResult, sourceResult] = await Promise.all([
    supabase.from("aag_sync_history").select("id,created_at,added_count,updated_count,deactivated_count,before_vmgc,after_vmgc,data").eq("club_id", CLUB_ID).order("created_at", { ascending: false }).limit(1).maybeSingle(),
    supabase.from("aag_enrolleds").select("last_sync_at").eq("option_club_id", CLUB_ID).not("last_sync_at", "is", null).order("last_sync_at", { ascending: false }).limit(1).maybeSingle()
  ]);
  if (historyResult.error) throw historyResult.error;
  if (sourceResult.error) throw sourceResult.error;
  const latest = historyResult.data;
  const lastCompletedAt = latest?.created_at ? new Date(latest.created_at) : null;
  return {
    current: Boolean(lastCompletedAt && lastCompletedAt >= currentThursdayStart()),
    lastCompletedAt,
    sourceUpdatedAt: sourceResult.data?.last_sync_at ? new Date(sourceResult.data.last_sync_at) : null,
    latest
  };
}

export async function prepareAagSync(onProgress = () => {}) {
  onProgress("Revisando jugadores manuales antes de sincronizar…");
  const [beforeMap, manuals, enrolled] = await Promise.all([playersSnapshot(), manualPlayers(), vmgcAagPlayers()]);
  const existingMembers = new Set([...beforeMap.keys()]);
  const manualByKey = new Map();
  manuals.filter(player => nameKey(player)).forEach(player => {
    const key = `${nameKey(player)}|${isFemale(player.gender) ? "female" : "male"}`;
    if (!manualByKey.has(key)) manualByKey.set(key, []);
    manualByKey.get(key).push(player);
  });
  const pending = [];
  for (const enrolledPlayer of enrolled) {
    const member = cleanMemberNumber(enrolledPlayer.enrollment_number);
    if (!member || existingMembers.has(member)) continue;
    const candidates = manualByKey.get(`${nameKey(enrolledPlayer)}|${isFemale(enrolledPlayer.gender) ? "female" : "male"}`) || [];
    if (!candidates.length) continue;
    pending.push({ aag: { ...enrolledPlayer, aag_member_number: member }, candidates: candidates.slice(0, 5) });
  }
  await Promise.all(pending.flatMap(item => item.candidates.map(async candidate => { candidate.usage = await playerUsage(candidate.id); })));
  return { beforeMap, pending };
}

export async function linkManualPlayer(candidate, aagPlayer) {
  const member = cleanMemberNumber(aagPlayer.aag_member_number || aagPlayer.enrollment_number);
  const payload = {
    aag_member_number: member,
    first_name: aagPlayer.first_name || candidate.first_name || null,
    last_name: aagPlayer.last_name || candidate.last_name || null,
    gender: aagPlayer.gender || candidate.gender || null,
    current_index: aagPlayer.current_index ?? candidate.current_index ?? null,
    born_date: aagPlayer.born_date || candidate.born_date || null,
    doc_number: aagPlayer.doc_number || candidate.doc_number || null,
    lowest_handicap_index: aagPlayer.lowest_handicap_index ?? candidate.lowest_handicap_index ?? null,
    country: "Argentina",
    club_name: aagPlayer.club_name || "Villa María Golf Club",
    option_club_id: Number(aagPlayer.option_club_id) || CLUB_ID,
    is_club_member: Number(aagPlayer.option_club_id) === CLUB_ID,
    is_aag_active: true,
    source: "aag",
    index_updated_at: new Date().toISOString()
  };
  const { error } = await supabase.from("players").update(payload).eq("id", candidate.id);
  if (error) throw error;
}

function buildChanges(beforeMap, afterMap, workerData = {}) {
  const added = [], updated = [], deactivated = [];
  for (const [member, after] of afterMap.entries()) {
    const before = beforeMap.get(member);
    if (!isActiveVmgc(after)) continue;
    if (!before || !isActiveVmgc(before)) {
      added.push({ matricula:member, nombre:playerName(after), index:indexNumber(after.current_index), club:after.club_name || "Villa María Golf Club" });
      continue;
    }
    const oldIndex = indexNumber(before.current_index), newIndex = indexNumber(after.current_index);
    if (oldIndex !== newIndex) updated.push({ matricula:member, nombre:playerName(after), old_index:oldIndex, new_index:newIndex, club:after.club_name || "Villa María Golf Club" });
  }
  for (const [member, before] of beforeMap.entries()) {
    if (!isActiveVmgc(before)) continue;
    const after = afterMap.get(member);
    if (!after || !isActiveVmgc(after)) deactivated.push({ matricula:member, nombre:playerName(after || before), old_index:indexNumber(before.current_index), new_index:after ? indexNumber(after.current_index) : null, old_club:before.club_name || "Villa María Golf Club", new_club:after?.club_name || "Sin club VMGC", reason:!after ? "Ya no aparece en players después de sincronizar." : "Ya no figura como miembro activo del club 408." });
  }
  for (const rows of [added, updated, deactivated]) rows.sort((a,b) => String(a.nombre).localeCompare(String(b.nombre), "es"));
  return { added, updated, deactivated, totals:{ before_vmgc:[...beforeMap.values()].filter(isActiveVmgc).length, after_vmgc:[...afterMap.values()].filter(isActiveVmgc).length, total_received:workerData.total_received ?? workerData.totalReceived ?? null, total_filtered:workerData.total_filtered ?? workerData.totalFiltered ?? null, total_upserted:workerData.total_upserted ?? workerData.totalUpserted ?? null } };
}

export async function executeAagSync(onProgress = () => {}) {
  const { data:{ session } } = await supabase.auth.getSession();
  if (!session) throw new Error("La sesión venció. Volvé a ingresar.");
  onProgress("Tomando la foto previa de jugadores VMGC…");
  const beforeMap = await playersSnapshot();
  onProgress("Sincronizando con AAG… puede tardar unos minutos.");
  const response = await fetch(FUNCTION_URL, {
    method:"POST",
    headers:{ "Content-Type":"application/json", Authorization:`Bearer ${session.access_token}`, apikey:SUPABASE_PUBLISHABLE_KEY },
    body:JSON.stringify({ action:"sync_vmgc", club_id:CLUB_ID, detail_changes:true })
  });
  const text = await response.text();
  let workerData = {};
  try { workerData = text ? JSON.parse(text) : {}; } catch { workerData = { raw_response:text }; }
  if (!response.ok || workerData.ok === false) throw new Error(workerData.error || workerData.message || text || "No se pudo sincronizar con AAG.");
  onProgress("Comparando índices y preparando el informe…");
  const afterMap = await playersSnapshot();
  const changes = buildChanges(beforeMap, afterMap, workerData);
  const payload = { club_id:CLUB_ID, generated_at:new Date().toISOString(), totals:changes.totals, added:changes.added, updated:changes.updated, deactivated:changes.deactivated, worker_response:workerData };
  const { data:history, error } = await supabase.from("aag_sync_history").insert({ created_by:session.user.id, club_id:CLUB_ID, added_count:changes.added.length, updated_count:changes.updated.length, deactivated_count:changes.deactivated.length, before_vmgc:changes.totals.before_vmgc, after_vmgc:changes.totals.after_vmgc, data:payload }).select("*").single();
  if (error) throw new Error(`Los índices se actualizaron, pero no se pudo guardar el informe: ${error.message}`);
  return { history, changes };
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
