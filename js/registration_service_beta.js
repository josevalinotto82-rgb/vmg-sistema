import { supabase } from "./supabase_beta.js";

const SESSION_KEY = "vmgc_beta_grid_session";
export const GRID_SESSION = sessionStorage.getItem(SESSION_KEY) || crypto.randomUUID();
sessionStorage.setItem(SESSION_KEY, GRID_SESSION);

const norm = value => String(value || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/,/g, " ").replace(/\s+/g, " ").trim().toUpperCase();
const now = () => Date.now();
const plusMinutes = value => new Date(now() + value * 60000).toISOString();
const isActiveLock = slot => slot?.lock_expires_at && new Date(slot.lock_expires_at).getTime() > now();
export const isReservation = slot => slot?.notes === "RESERVA_ADMIN" || (slot?.notes === "RESERVA_24H_SOCIO" && isActiveLock(slot));
export const isEmpty = slot => !slot || (slot.participant_type !== "blocked" && !isReservation(slot) && ["", "LIBRE"].includes(String(slot.display_name || "").trim().toUpperCase()));
export const resetSlot = () => ({ display_name:"", participant_type:"self", created_by_player_id:null, linked_player_id:null, aag_member_number:null, club_name:null, country:null, manual_index:null, needs_admin_review:false, notes:null, locked_by_session:null, locked_by_player_id:null, lock_expires_at:null });

export async function listAvailableTournaments(isAdmin) {
  let query = supabase.from("tournaments").select("id,name,tournament_date,status,published,hole_count,data_schema_version,game_modes(name,requires_partner,participation_type)").eq("data_schema_version", 2);
  if (!isAdmin) query = query.eq("status", "open").eq("published", true);
  else query = query.in("status", ["open", "closed", "officialized", "archived"]);
  const { data, error } = await query.order("tournament_date", { ascending:false }).limit(80);
  if (error) throw error;
  let rows = data || [];
  if (isAdmin) {
    const archivedIds = rows.filter(t => t.status === "archived").map(t => t.id);
    if (archivedIds.length) {
      const { data:exports, error:exportError } = await supabase.from("aag_exports").select("tournament_id,status,aag_tournament_id,aag_remote_status").in("tournament_id", archivedIds);
      if (exportError) throw exportError;
      const exported = new Set((exports || []).filter(row => {
        const status=String(row.status||"").trim().toLowerCase(),remote=String(row.aag_remote_status||"").trim().toLowerCase();
        return status==="sent"||Boolean(row.aag_tournament_id)||["abierto","procesado","modificado"].includes(remote);
      }).map(row => String(row.tournament_id)));
      rows = rows.filter(t => !(t.status === "archived" && exported.has(String(t.id))));
    }
  }
  return rows;
}

export async function loadGrid(tournamentId, isAdmin) {
  let tq = supabase.from("tournaments").select("id,name,tournament_date,status,published,start_type,hole_count,data_schema_version,game_modes(id,name,requires_partner,participation_type)").eq("id", tournamentId).eq("data_schema_version", 2);
  if (!isAdmin) tq = tq.eq("status", "open").eq("published", true);
  const { data:tournament, error:te } = await tq.single();
  if (te) throw te;
  const { data:blocks, error:be } = await supabase.from("starting_blocks").select("id,tournament_id,name,start_time,block_type,display_order").eq("tournament_id", tournamentId).order("display_order");
  if (be) throw be;
  const blockIds = (blocks || []).map(item => item.id);
  let lines = [];
  if (blockIds.length) {
    const response = await supabase.from("starting_lines").select("id,starting_block_id,line_time,starting_hole,label,capacity,status,display_order").in("starting_block_id", blockIds).order("display_order");
    if (response.error) throw response.error;
    lines = response.data || [];
  }
  const lineIds = lines.map(item => item.id);
  let slots = [];
  if (lineIds.length) {
    const response = await supabase.from("line_slots").select("id,starting_line_id,slot_number,participant_type,created_by_player_id,linked_player_id,display_name,aag_member_number,club_name,country,manual_index,needs_admin_review,notes,locked_by_session,locked_by_player_id,lock_expires_at").in("starting_line_id", lineIds).order("slot_number");
    if (response.error) throw response.error;
    slots = response.data || [];
  }
  return { tournament, blocks:blocks || [], lines, slots };
}

export async function getMemberPlayer(userId) {
  const { data, error } = await supabase.from("players").select("*").eq("profile_id", userId).maybeSingle();
  if (error) throw error;
  return data || null;
}

export async function searchPlayers(term) {
  const text = String(term || "").trim();
  if (text.length < 2) return [];
  const words = norm(text).split(" ").filter(Boolean);
  const fullPattern = `%${text.replace(/[%_,]/g," ").replace(/\s+/g,"%")}%`;
  const firstPattern = `%${words[0] || text}%`;
  const member = text.replace(/\s+/g, "");
  const numeric = /^\d+$/.test(member);
  const [playersRes, aagRes] = await Promise.all([
    supabase.from("players").select("id,first_name,last_name,full_name,aag_member_number,current_index,gender,option_club_id,club_name,country,is_club_member,search_text").or([`search_text.ilike.${fullPattern}`,`full_name.ilike.${fullPattern}`,`first_name.ilike.${firstPattern}`,`last_name.ilike.${firstPattern}`,...(numeric ? [`aag_member_number.eq.${member}`] : [])].join(",")).limit(40),
    numeric
      ? supabase.from("aag_enrolleds").select("enrollment_number,first_name,last_name,full_name,gender,current_index,option_club_id,club_name,search_text").eq("enrollment_number", member).limit(40)
      : supabase.from("aag_enrolleds").select("enrollment_number,first_name,last_name,full_name,gender,current_index,option_club_id,club_name,search_text").ilike("search_text", fullPattern).limit(40)
  ]);
  if (playersRes.error) console.warn(playersRes.error);
  if (aagRes.error) console.warn(aagRes.error);
  const players = (playersRes.data || []).map(p => ({...p, source_table:"players"}));
  const known = new Set(players.map(p => String(p.aag_member_number || "")).filter(Boolean));
  const external = (aagRes.data || []).filter(p => !known.has(String(p.enrollment_number || ""))).map(p => ({...p,id:`aag:${p.enrollment_number}`,aag_member_number:p.enrollment_number,country:"Argentina",is_club_member:Number(p.option_club_id)===408,source_table:"aag_enrolleds"}));
  const sought = norm(text);
  return [...players,...external].map(player => {
    const haystack = norm(`${player.full_name || ""} ${player.last_name || ""} ${player.first_name || ""} ${player.aag_member_number || ""}`);
    if (!words.every(word => haystack.includes(word))) return {...player,_score:-1};
    let score = (Number(player.option_club_id)===408 || player.is_club_member ? 10000 : 0);
    if (String(player.aag_member_number || "") === member) score += 8000;
    if (haystack.includes(sought)) score += 4000;
    return {...player,_score:score + words.length * 500};
  }).filter(p => p._score >= 0).sort((a,b) => b._score-a._score).slice(0,15);
}

export async function ensurePlayer(player) {
  if (player.source_table === "players" && !String(player.id).startsWith("aag:")) return player;
  const member = player.enrollment_number || player.aag_member_number;
  const row = { aag_member_number:member, first_name:player.first_name || "", last_name:player.last_name || "", gender:player.gender || "male", current_index:player.current_index ?? null, option_club_id:player.option_club_id ?? null, club_name:player.club_name || "", country:player.country || "Argentina", source:"AAG", is_club_member:Number(player.option_club_id)===408, aag_last_sync_at:new Date().toISOString(), search_text:norm(`${player.last_name} ${player.first_name} ${player.first_name} ${player.last_name} ${member}`) };
  const { data, error } = await supabase.from("players").upsert(row,{onConflict:"aag_member_number"}).select("*").single();
  if (error) throw error;
  return data;
}

export async function createManualPlayer({firstName,lastName,index,gender,country}) {
  if (!firstName?.trim() || !lastName?.trim() || !gender) throw new Error("Nombre, apellido y género son obligatorios.");
  const row = { first_name:firstName.trim(), last_name:lastName.trim(), current_index:index === "" ? null : Number(String(index).replace(",",".")), gender, country:country?.trim() || null, is_club_member:false, is_aag_active:false, source:"manual", aag_member_number:null, search_text:norm(`${lastName} ${firstName} ${firstName} ${lastName}`) };
  const { data, error } = await supabase.from("players").insert(row).select("*").single();
  if (error) throw error;
  return data;
}

async function freshSlot(id) { const {data,error}=await supabase.from("line_slots").select("*").eq("id",id).single(); if(error) throw error; return data; }
async function lineSlots(lineId) { const {data,error}=await supabase.from("line_slots").select("*").eq("starting_line_id",lineId).order("slot_number"); if(error) throw error; return data || []; }
export async function lockLine(slotId, memberId) {
  const slot = await freshSlot(slotId); const slots = await lineSlots(slot.starting_line_id);
  if (slots.some(s => isActiveLock(s) && s.locked_by_session !== GRID_SESSION && String(s.locked_by_player_id || "") !== String(memberId || "") && !isReservation(s))) throw new Error("Esa línea está siendo seleccionada por otra persona.");
  const ids = slots.filter(s => !isReservation(s)).map(s => s.id);
  const {error}=await supabase.from("line_slots").update({locked_by_session:GRID_SESSION,locked_by_player_id:memberId || null,lock_expires_at:plusMinutes(2)}).in("id",ids); if(error) throw error;
  return slot;
}
export async function unlockLine(slotId) { const slot=await freshSlot(slotId); const slots=await lineSlots(slot.starting_line_id); const ids=slots.filter(s => s.locked_by_session===GRID_SESSION && !isReservation(s)).map(s=>s.id); if(ids.length){const {error}=await supabase.from("line_slots").update({locked_by_session:null,locked_by_player_id:null,lock_expires_at:null}).in("id",ids); if(error) throw error;} }

function pairBlock(number){ return Number(number)<=2 ? [1,2] : [3,4]; }
async function validatePriority(slot, partner){ const slots=await lineSlots(slot.starting_line_id); if(!partner){for(let n=1;n<Number(slot.slot_number);n++){if(isEmpty(slots.find(s=>Number(s.slot_number)===n))) throw new Error(`Primero debe ocuparse el lugar ${n}.`);}} else if(pairBlock(slot.slot_number)[0]===3 && [1,2].every(n=>isEmpty(slots.find(s=>Number(s.slot_number)===n)))) throw new Error("Primero debe ocuparse la pareja 1–2."); return slots; }
export async function validateSlotChoice(slotId,requiresPartner=false){const slot=await freshSlot(slotId);if(!isEmpty(slot))throw new Error("El lugar ya no está libre.");await validatePriority(slot,requiresPartner);return slot;}
async function ensureNotRegistered(tournamentId,playerId){const {data,error}=await supabase.from("registrations").select("id,display_name").eq("tournament_id",tournamentId).eq("linked_player_id",playerId).limit(1);if(error)throw error;if(data?.length)throw new Error(`${data[0].display_name || "El jugador"} ya está anotado.`);}
const slotPayload=(player,type,creator)=>({display_name:player.full_name || `${player.last_name || ""}, ${player.first_name || ""}`,participant_type:type,created_by_player_id:creator || null,linked_player_id:player.id,aag_member_number:player.aag_member_number || null,club_name:player.club_name || null,country:player.country || null,manual_index:player.current_index ?? null,needs_admin_review:!player.aag_member_number,notes:null,locked_by_session:null,locked_by_player_id:null,lock_expires_at:null});
const regPayload=(tournamentId,slot,player,creator,selfId)=>({tournament_id:tournamentId,starting_line_id:slot.starting_line_id,line_slot_id:slot.id,linked_player_id:player.id,created_by_player_id:creator || null,display_name:player.full_name || `${player.last_name || ""}, ${player.first_name || ""}`,participant_type:String(player.id)===String(selfId) ? "self" : (player.aag_member_number ? "aag_match" : "manual_guest"),aag_member_number:player.aag_member_number || null,club_name:player.club_name || null,country:player.country || null,reported_index:player.current_index ?? null,registration_status:"pending",needs_admin_review:!player.aag_member_number});

export async function registerPlayers({tournamentId,slotId,players,isAdmin,memberPlayerId,requiresPartner}) {
  const slot=await freshSlot(slotId); const slots=await validatePriority(slot,requiresPartner); const targetNumbers=requiresPartner?pairBlock(slot.slot_number):[Number(slot.slot_number)]; const targets=targetNumbers.map(n=>slots.find(s=>Number(s.slot_number)===n));
  if(players.length!==targets.length) throw new Error(requiresPartner?"Seleccioná los dos integrantes de la pareja.":"Seleccioná un jugador.");
  if(targets.some(s=>!s || !isEmpty(s))) throw new Error("El lugar acaba de ser ocupado. Actualizá la grilla.");
  if(new Set(players.map(p=>p.id)).size!==players.length) throw new Error("No se puede elegir dos veces al mismo jugador.");
  if(!isAdmin && memberPlayerId){const {count,error}=await supabase.from("registrations").select("id",{count:"exact",head:true}).eq("tournament_id",tournamentId).eq("created_by_player_id",memberPlayerId);if(error)throw error;if((count||0)+players.length>8)throw new Error("Ya alcanzaste el máximo de 8 jugadores en tu grupo.");}
  for(const player of players) await ensureNotRegistered(tournamentId,player.id);
  const created=[];
  try {
    for(let i=0;i<players.length;i++){const response=await supabase.from("registrations").insert(regPayload(tournamentId,targets[i],players[i],memberPlayerId,memberPlayerId)).select("*").single();if(response.error)throw response.error;created.push(response.data);const update=await supabase.from("line_slots").update(slotPayload(players[i],isAdmin?"admin":String(players[i].id)===String(memberPlayerId)?"self":"guest",memberPlayerId)).eq("id",targets[i].id);if(update.error)throw update.error;}
    if(created.length===2){await supabase.from("registrations").update({partner_registration_id:created[1].id}).eq("id",created[0].id);await supabase.from("registrations").update({partner_registration_id:created[0].id}).eq("id",created[1].id);}
  } catch(error){if(created.length)await supabase.from("registrations").delete().in("id",created.map(r=>r.id));for(const target of targets)await supabase.from("line_slots").update(resetSlot()).eq("id",target.id);throw error;}
  await unlockLine(slotId);
}

export async function reserveSlot(slotId,{isAdmin,memberPlayerId}) { const slot=await freshSlot(slotId); if(!isEmpty(slot))throw new Error("El lugar ya no está libre."); if(!isAdmin){const slots=await lineSlots(slot.starting_line_id);const first=slots.find(s=>Number(s.slot_number)===1);if(String(first?.linked_player_id||"")!==String(memberPlayerId||""))throw new Error("Solo podés reservar en tu línea si estás anotado en el lugar 1.");} const payload=isAdmin?{display_name:"Reservado",participant_type:"admin",locked_by_session:"RESERVA_ADMIN",locked_by_player_id:null,lock_expires_at:"2099-12-31T23:59:59.000Z",notes:"RESERVA_ADMIN"}:{locked_by_session:null,locked_by_player_id:memberPlayerId,lock_expires_at:new Date(now()+24*3600000).toISOString(),notes:"RESERVA_24H_SOCIO"};const {error}=await supabase.from("line_slots").update(payload).eq("id",slotId);if(error)throw error; }
export async function releaseSlot(slotId,{isAdmin,memberPlayerId,tournamentDate,requiresPartner=false}) { const slot=await freshSlot(slotId);const allowed=isAdmin||String(slot.linked_player_id||"")===String(memberPlayerId||"")||String(slot.created_by_player_id||"")===String(memberPlayerId||"")||String(slot.locked_by_player_id||"")===String(memberPlayerId||"");if(!allowed)throw new Error("No tenés permiso para liberar este lugar.");if(!isAdmin){const [year,month,day]=String(tournamentDate||"").split("-").map(Number);const cutoff=new Date(year,month-1,day,12,0,0,0);cutoff.setDate(cutoff.getDate()-1);if(now()>=cutoff.getTime())throw new Error("La baja web ya cerró. Comunicate con administración por WhatsApp.");}let ids=[slot.id];if(requiresPartner){const numbers=pairBlock(slot.slot_number);ids=(await lineSlots(slot.starting_line_id)).filter(item=>numbers.includes(Number(item.slot_number))).map(item=>item.id);}const {error:de}=await supabase.from("registrations").delete().in("line_slot_id",ids);if(de)throw de;const {error}=await supabase.from("line_slots").update(resetSlot()).in("id",ids);if(error)throw error; }
export async function blockSlot(slotId,blocked=true){const payload=blocked?{...resetSlot(),participant_type:"blocked",notes:"BLOCKED_BY_ADMIN"}:resetSlot();const{error}=await supabase.from("line_slots").update(payload).eq("id",slotId);if(error)throw error;}

export async function moveRegistration(sourceId,destinationId,{requiresPartner=false}={}){
  if(sourceId===destinationId)return;const source=await freshSlot(sourceId),destination=await freshSlot(destinationId);if(isEmpty(source)||isReservation(source)||source.participant_type==="blocked")throw new Error("El lugar de origen no contiene un jugador.");if(!isEmpty(destination))throw new Error("El lugar de destino ya no está libre.");
  let sources=[source],destinations=[destination];
  if(requiresPartner){const sourceNumbers=pairBlock(source.slot_number),destinationNumbers=pairBlock(destination.slot_number),sourceLine=await lineSlots(source.starting_line_id),destinationLine=await lineSlots(destination.starting_line_id);sources=sourceLine.filter(s=>sourceNumbers.includes(Number(s.slot_number))).sort((a,b)=>a.slot_number-b.slot_number);destinations=destinationLine.filter(s=>destinationNumbers.includes(Number(s.slot_number))).sort((a,b)=>a.slot_number-b.slot_number);if(sources.some(isEmpty))throw new Error("La pareja de origen está incompleta.");if(destinations.some(s=>!isEmpty(s)))throw new Error("La pareja de destino no está completamente libre.");if(destinationNumbers[0]===3&&[1,2].every(n=>isEmpty(destinationLine.find(s=>Number(s.slot_number)===n))))throw new Error("Primero debe ocuparse la pareja 1–2 del horario de destino.");}
  else{const destinationLine=await lineSlots(destination.starting_line_id);for(let n=1;n<Number(destination.slot_number);n++){const previous=destinationLine.find(s=>Number(s.slot_number)===n);if(isEmpty(previous)||previous?.id===source.id)throw new Error(`Para mover allí primero debe estar ocupado el lugar ${n}.`);}const sourceLine=await lineSlots(source.starting_line_id);for(let n=Number(source.slot_number)+1;n<=4;n++){const later=sourceLine.find(s=>Number(s.slot_number)===n);if(later&&!isEmpty(later)&&later.id!==destination.id)throw new Error("Ese movimiento dejaría un lugar vacío antes de otro jugador.");}}
  for(let i=0;i<sources.length;i++){const from=sources[i],to=destinations[i],copy={participant_type:from.participant_type,created_by_player_id:from.created_by_player_id,linked_player_id:from.linked_player_id,display_name:from.display_name,aag_member_number:from.aag_member_number,club_name:from.club_name,country:from.country,manual_index:from.manual_index,needs_admin_review:from.needs_admin_review,notes:from.notes,locked_by_session:null,locked_by_player_id:null,lock_expires_at:null};const copied=await supabase.from("line_slots").update(copy).eq("id",to.id);if(copied.error)throw copied.error;const registration=await supabase.from("registrations").update({line_slot_id:to.id,starting_line_id:to.starting_line_id}).eq("line_slot_id",from.id);if(registration.error)throw registration.error;const cleared=await supabase.from("line_slots").update(resetSlot()).eq("id",from.id);if(cleared.error)throw cleared.error;}
}

export function subscribeGrid(tournamentId,callback){const channel=supabase.channel(`beta-grid-${tournamentId}`).on("postgres_changes",{event:"*",schema:"public",table:"registrations",filter:`tournament_id=eq.${tournamentId}`},callback).on("postgres_changes",{event:"*",schema:"public",table:"line_slots"},callback).subscribe();return()=>supabase.removeChannel(channel);}
