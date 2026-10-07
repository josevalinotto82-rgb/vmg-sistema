import { supabase } from "./supabase.js";
import { START_TYPE_TEMPLATE_ID, APP_TIMEZONE } from "./config.js";

const MEDAL_MODE_ID = "fb05f9cc-ee0d-4de4-9f83-d57e929398c5";
const MARKER = "VMGC_FREE_SCORECARD_V2";
export const toNumber=value=>{if(value==null||value==="")return null;const n=Number(String(value).replace(",","."));return Number.isFinite(n)?n:null};
export const normalize=value=>String(value||"").normalize("NFD").replace(/[\u0300-\u036f]/g,"").replace(/,/g," ").replace(/\s+/g," ").trim().toUpperCase();
export const normalizeGender=value=>["F","FEMALE","FEMENINO","DAMA","DAMAS","MUJER"].includes(normalize(value))?"female":"male";
export const normalizeSegment=value=>value==="front9"?"front9":value==="back9"?"back9":"18";
export const enabledHoles=segment=>segment==="front9"?Array.from({length:9},(_,i)=>i+1):segment==="back9"?Array.from({length:9},(_,i)=>i+10):Array.from({length:18},(_,i)=>i+1);

const localParts=()=>Object.fromEntries(new Intl.DateTimeFormat("en-CA",{timeZone:APP_TIMEZONE,year:"numeric",month:"2-digit",day:"2-digit",weekday:"long"}).formatToParts(new Date()).filter(p=>p.type!=="literal").map(p=>[p.type,p.value]));
export function localDate(){const p=localParts();return `${p.year}-${p.month}-${p.day}`}
export function weekday(){return new Intl.DateTimeFormat("es-AR",{timeZone:APP_TIMEZONE,weekday:"long"}).format(new Date()).replace(/^./,c=>c.toUpperCase())}
const marker=segment=>`${MARKER}:${normalizeSegment(segment)}`;
const tournamentName=segment=>`${weekday()} ${localDate()}${segment==="front9"?" - 9 HOYOS IDA":segment==="back9"?" - 9 HOYOS VUELTA":""}`.toUpperCase();

const holesFromTee=tee=>(Array.isArray(tee?.holes)?tee.holes:[]).map(h=>({hole:Number(h.HoleNumber??h.hole_number??h.hole),par:toNumber(h.Par??h.par),handicap:toNumber(h.Handicap??h.handicap??h.Hcp??h.hcp)})).filter(h=>h.hole>=1&&h.hole<=18).sort((a,b)=>a.hole-b.hole);
const parFor=(tee,segment)=>holesFromTee(tee).filter(h=>enabledHoles(segment).includes(h.hole)).reduce((sum,h)=>sum+Number(h.par||0),0);
const teeReference=tee=>({aag_field_id:tee.aag_field_id??null,aag_id:tee.aag_teeout_id??null,tee_name:tee.tee_name||"",category:tee.category??null,slope_in:tee.slope_in??null,slope_out:tee.slope_out??null,slope_total:tee.slope_total??null,rating_in:tee.calification_in??null,rating_out:tee.calification_out??null,rating_total:tee.calification_total??null,par_in:parFor(tee,"front9"),par_out:parFor(tee,"back9"),par_total:parFor(tee,"18"),holes:holesFromTee(tee)});
const normalizeRule=raw=>({...raw,aag_teeout_id:String(raw?.aag_teeout_id||raw?.teeout_id||raw?.id||""),index_min:toNumber(raw?.index_min),index_max:toNumber(raw?.index_max)});

export async function loadFreeCardCatalogs(){
  const[categoriesResult,teesResult]=await Promise.all([
    supabase.from("categories").select("id,name,display_order,playing_handicap_min,playing_handicap_max,playing_tee_aag_teeout_id,tee_rules").eq("active",true).lte("display_order",5).order("display_order"),
    supabase.from("aag_teeouts").select("id,aag_teeout_id,aag_field_id,tee_name,category,slope_in,slope_out,slope_total,calification_in,calification_out,calification_total,holes").in("aag_field_id",[1466,2048]).order("aag_field_id").order("category").order("tee_name")
  ]);
  if(categoriesResult.error)throw categoriesResult.error;if(teesResult.error)throw teesResult.error;
  const tees=teesResult.data||[],teeMap=new Map(tees.map(tee=>[String(tee.id),tee]));
  const categories=(categoriesResult.data||[]).map(category=>({...category,tee_rules:(category.tee_rules||[]).map(normalizeRule).map(rule=>({...rule,reference:teeReference(teeMap.get(rule.aag_teeout_id))}))}));
  return{categories,tees,teeMap};
}

export async function searchFreePlayers(term){
  const raw=String(term||"").trim(),words=normalize(raw).split(" ").filter(Boolean);if(raw.length<2)return[];
  const matricula=raw.replace(/\s/g,""),numeric=/^\d+$/.test(matricula),pattern=`%${words.join("%")}%`,first=`%${words[0]||""}%`;
  let playersQuery=supabase.from("players").select("id,first_name,last_name,full_name,gender,current_index,aag_member_number,country,club_name,is_club_member,option_club_id,search_text").or([`search_text.ilike.${pattern}`,`full_name.ilike.${pattern}`,`first_name.ilike.${first}`,`last_name.ilike.${first}`,...(numeric?[`aag_member_number.eq.${matricula}`]:[])].join(",")).limit(35);
  let aagQuery=supabase.from("aag_enrolleds").select("enrollment_number,first_name,last_name,full_name,gender,current_index,option_club_id,club_name,search_text");
  aagQuery=numeric?aagQuery.eq("enrollment_number",matricula):aagQuery.ilike("search_text",pattern);
  const[playersResult,aagResult]=await Promise.all([playersQuery,aagQuery.limit(35)]);
  if(playersResult.error)throw playersResult.error;if(aagResult.error)throw aagResult.error;
  const players=(playersResult.data||[]).map(p=>({...p,source:"players"})),existing=new Set(players.map(p=>String(p.aag_member_number||"")).filter(Boolean));
  const aag=(aagResult.data||[]).filter(p=>!existing.has(String(p.enrollment_number||""))).map(p=>({id:`aag:${p.enrollment_number}`,source:"aag",aag_member_number:p.enrollment_number,first_name:p.first_name,last_name:p.last_name,full_name:p.full_name,gender:p.gender,current_index:p.current_index,option_club_id:p.option_club_id,club_name:p.club_name,country:"Argentina",is_club_member:Number(p.option_club_id)===408}));
  return[...players,...aag].filter(p=>words.every(word=>normalize(`${p.full_name||""} ${p.last_name||""} ${p.first_name||""} ${p.aag_member_number||""}`).includes(word))).sort((a,b)=>(Number(b.is_club_member)-Number(a.is_club_member))||String(a.full_name||"").localeCompare(String(b.full_name||""),"es")).slice(0,15);
}

export function playerFromResult(player){return{source:player.source,player_id:player.source==="players"?player.id:null,display_name:player.full_name||[player.last_name,player.first_name].filter(Boolean).join(", "),aag_member_number:String(player.aag_member_number||""),gender:normalizeGender(player.gender),official_index:toNumber(player.current_index),club_name:player.club_name||"",is_club_member:player.is_club_member===true||Number(player.option_club_id)===408}}

const ruleGender=rule=>Number(rule?.reference?.category)===1?"female":"male";
export function suggestedCategory(catalogs,index,gender){
  const idx=toNumber(index);if(idx==null)return null;
  for(const category of catalogs.categories){const rule=(category.tee_rules||[]).find(item=>ruleGender(item)===gender&&idx>=toNumber(item.index_min)&&idx<=toNumber(item.index_max));if(rule)return{category,rule,tee:catalogs.teeMap.get(String(rule.aag_teeout_id))}}
  return null;
}
export function teeConfiguration(catalogs,player,teeId,segment){
  const tee=catalogs.teeMap.get(String(teeId));if(!tee)return null;segment=normalizeSegment(segment);
  const slope=toNumber(segment==="front9"?tee.slope_in:segment==="back9"?tee.slope_out:tee.slope_total),rating=toNumber(segment==="front9"?tee.calification_in:segment==="back9"?tee.calification_out:tee.calification_total),par=parFor(tee,segment),rawIndex=toNumber(player.official_index),index=["front9","back9"].includes(segment)?rawIndex/2:rawIndex;
  if([slope,rating,par,index].some(v=>v==null))return null;
  const playingHandicap=Math.min(Math.floor(index*slope/113+(rating-par)+.5),54);
  const automatic=suggestedCategory(catalogs,rawIndex,player.gender),category=catalogs.categories.find(c=>(c.tee_rules||[]).some(r=>String(r.aag_teeout_id)===String(teeId)&&ruleGender(r)===player.gender&&rawIndex>=toNumber(r.index_min)&&rawIndex<=toNumber(r.index_max)))||catalogs.categories.find(c=>(c.tee_rules||[]).some(r=>String(r.aag_teeout_id)===String(teeId)))||automatic?.category||null;
  return{tee,category,segment,slope,course_rating:rating,par,playing_handicap:playingHandicap,holes:holesFromTee(tee).filter(h=>enabledHoles(segment).includes(h.hole))};
}

function categorySnapshot(category,catalogs,segment){
  const nine=["front9","back9"].includes(segment),adjust=value=>{const n=toNumber(value);return nine&&n!=null?Math.round((n/2+Number.EPSILON)*10)/10:n};
  return{name:category.name,tee_rules:(category.tee_rules||[]).map(rule=>{const normalized=normalizeRule(rule),tee=catalogs.teeMap.get(String(rule.aag_teeout_id));return{...normalized,source_index_min:normalized.index_min,source_index_max:normalized.index_max,index_min:adjust(normalized.index_min),index_max:adjust(normalized.index_max),reference:teeReference(tee)}}),playing_handicap_min:category.playing_handicap_min,playing_handicap_max:category.playing_handicap_max,playing_tee_aag_teeout_id:category.playing_tee_aag_teeout_id||null,display_order:category.display_order||0,hole_segment:segment,category_system:"new"};
}
async function syncDailyCategories(tournamentId,catalogs,segment){
  const{data,error}=await supabase.from("tournament_categories").select("id,category_id").eq("tournament_id",tournamentId);if(error)throw error;
  const existing=new Map((data||[]).map(row=>[String(row.category_id),row]));
  for(const category of catalogs.categories){const snapshot=categorySnapshot(category,catalogs,segment),row=existing.get(String(category.id));const result=row?await supabase.from("tournament_categories").update(snapshot).eq("id",row.id):await supabase.from("tournament_categories").insert({tournament_id:tournamentId,category_id:category.id,...snapshot});if(result.error)throw result.error}
  const reload=await supabase.from("tournament_categories").select("id,category_id,name,tee_rules,hole_segment").eq("tournament_id",tournamentId).eq("category_system","new");if(reload.error)throw reload.error;return reload.data||[];
}
export async function ensureDailyTournament(catalogs,segment){
  segment=normalizeSegment(segment);let query=await supabase.from("tournaments").select("id,name,tournament_date,status,hole_count,notes").eq("tournament_date",localDate()).eq("notes",marker(segment)).maybeSingle();if(query.error)throw query.error;
  let tournament=query.data;
  if(!tournament){const inserted=await supabase.from("tournaments").insert({name:tournamentName(segment),tournament_date:localDate(),game_mode_id:MEDAL_MODE_ID,start_type_template_id:START_TYPE_TEMPLATE_ID,hole_count:segment==="18"?18:9,allows_guests:true,status:"officialized",published:false,notes:marker(segment),start_type:"secuencial",aag_export_excluded:false,data_schema_version:2,scoring_mode:"net"}).select("id,name,tournament_date,status,hole_count,notes").single();if(inserted.error)throw inserted.error;tournament=inserted.data}
  else if(tournament.status!=="officialized"){const updated=await supabase.from("tournaments").update({status:"officialized"}).eq("id",tournament.id).select("id,name,tournament_date,status,hole_count,notes").single();if(updated.error)throw updated.error;tournament=updated.data}
  const categories=await syncDailyCategories(tournament.id,catalogs,segment);return{tournament,categories};
}
export async function saveFreeScorecard({catalogs,player,configuration,holeScores,result}){
  const daily=await ensureDailyTournament(catalogs,configuration.segment),category=daily.categories.find(c=>String(c.category_id)===String(configuration.category?.id));if(!category)throw new Error("No se pudo asignar la categoría del jugador.");
  const number=String(player.aag_member_number||"").trim();if(!number)throw new Error("El jugador necesita una matrícula AAG válida.");
  const payload={tournament_id:daily.tournament.id,registration_id:null,linked_player_id:player.player_id||null,display_name:player.display_name,aag_member_number:number,category_id:category.id,tee_id:null,official_index:player.official_index,manual_index:player.official_index,playing_handicap:configuration.playing_handicap,starting_time:null,starting_hole:null,gross:result.gross,net:result.net,total:result.net,card_status:result.card_status,exported_to_aag:false,category_name:category.name,tee_name:configuration.tee.tee_name,player_gender:player.gender,hole_segment:configuration.segment,slope:configuration.slope,course_rating:configuration.course_rating,par:configuration.par,aag_exportable:true,hole_scores:holeScores,export_ready:result.card_status==="valid",updated_at:new Date().toISOString()};
  const current=await supabase.from("scorecards").select("id,exported_to_aag").eq("tournament_id",daily.tournament.id).is("registration_id",null).eq("aag_member_number",number).maybeSingle();if(current.error)throw current.error;if(current.data?.exported_to_aag)throw new Error("Esta tarjeta ya fue exportada y no puede reemplazarse.");
  const saved=current.data?await supabase.from("scorecards").update(payload).eq("id",current.data.id):await supabase.from("scorecards").insert(payload);if(saved.error)throw saved.error;return daily.tournament;
}
