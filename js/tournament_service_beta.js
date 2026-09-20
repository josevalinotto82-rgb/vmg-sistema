import { supabase } from "./supabase_beta.js";
import { START_TYPE_TEMPLATE_ID } from "./config_beta.js";

const asTime = value => String(value || "").slice(0, 5);
const minutes = value => { const [h,m]=String(value||"0:0").split(":").map(Number); return h*60+m; };
const hhmm = value => `${String(Math.floor(value/60)).padStart(2,"0")}:${String(value%60).padStart(2,"0")}`;

function normalizeRule(raw = {}) {
  return {
    ...raw,
    aag_teeout_id: String(raw.aag_teeout_id || raw.teeout_id || raw.id || ""),
    index_min: raw.index_min == null ? null : Number(raw.index_min),
    index_max: raw.index_max == null ? null : Number(raw.index_max)
  };
}
function holesSnapshot(tee){return (Array.isArray(tee?.holes)?tee.holes:[]).map(h=>({hole:Number(h.HoleNumber??h.hole_number??h.hole),par:Number(h.Par??h.par),handicap:Number(h.Handicap??h.handicap??h.Hcp??h.hcp)})).filter(h=>Number.isInteger(h.hole)&&h.hole>=1&&h.hole<=18).sort((a,b)=>a.hole-b.hole)}
function parSegment(tee, segment){return holesSnapshot(tee).filter(h=>segment==="in"?h.hole<=9:segment==="out"?h.hole>=10:true).reduce((sum,h)=>sum+(Number.isFinite(h.par)?h.par:0),0)}
function referenceFromTee(tee){return {aag_field_id:tee.aag_field_id??null,aag_id:tee.aag_teeout_id??null,tee_name:tee.tee_name??"",category:tee.category??null,slope_in:tee.slope_in??null,slope_out:tee.slope_out??null,slope_total:tee.slope_total??null,rating_in:tee.calification_in??null,rating_out:tee.calification_out??null,rating_total:tee.calification_total??null,par_in:parSegment(tee,"in"),par_out:parSegment(tee,"out"),par_total:parSegment(tee,"total"),holes:holesSnapshot(tee)}}
function adjustedIndex(value, segment){const n=Number(value);if(!Number.isFinite(n))return value;if(["front9","back9"].includes(segment)&&n>=0)return Math.round((n/2+Number.EPSILON)*10)/10;return n}
function categorySnapshot(category, teeMap, segment){const nine=["front9","back9"].includes(segment);return {name:category.name,tee_rules:(category.tee_rules||[]).map(raw=>{const rule=normalizeRule(raw),tee=teeMap.get(rule.aag_teeout_id);if(!tee)throw new Error(`La categoría ${category.name} usa un tee AAG inexistente.`);return {...rule,source_index_min:rule.index_min,source_index_max:rule.index_max,index_min:nine?adjustedIndex(rule.index_min,segment):rule.index_min,index_max:nine?adjustedIndex(rule.index_max,segment):rule.index_max,reference:referenceFromTee(tee)}}),playing_handicap_min:category.playing_handicap_min,playing_handicap_max:category.playing_handicap_max,playing_tee_aag_teeout_id:category.playing_tee_aag_teeout_id||null,display_order:category.display_order??0,hole_segment:segment,category_system:"new"}}

export async function loadTournamentCatalogs(){
  const [modesRes,categoriesRes,teesRes,seriesRes]=await Promise.all([
    supabase.from("game_modes").select("id,name").order("name"),
    supabase.from("categories").select("id,name,active,display_order,playing_handicap_min,playing_handicap_max,playing_tee_aag_teeout_id,tee_rules").eq("active",true).order("display_order").order("name"),
    supabase.from("aag_teeouts").select("id,aag_teeout_id,aag_field_id,tee_name,category,slope_in,slope_out,slope_total,calification_in,calification_out,calification_total,holes").order("aag_field_id").order("category").order("tee_name"),
    supabase.from("tournament_series").select("id,name,required_rounds,status,scoring_mode").order("name")
  ]);
  for(const result of [modesRes,categoriesRes,teesRes,seriesRes])if(result.error)throw result.error;
  const teeMap=new Map((teesRes.data||[]).map(t=>[String(t.id),t]));
  const categories=(categoriesRes.data||[]).map(c=>{const rules=(c.tee_rules||[]).map(normalizeRule);const valid=rules.length>0&&rules.every(r=>teeMap.has(r.aag_teeout_id));const playing=String(c.playing_tee_aag_teeout_id||"");return {...c,tee_rules:rules,valid:valid&&(!playing||(teeMap.has(playing)&&rules.some(r=>r.aag_teeout_id===playing)))}});
  return {gameModes:modesRes.data||[],categories,tees:teesRes.data||[],series:seriesRes.data||[],teeMap};
}

function effectiveExport(row){const status=String(row?.status||"").trim().toLowerCase(),remote=String(row?.aag_remote_status||"").trim().toLowerCase();return status==="sent"||!!row?.aag_tournament_id||["abierto","procesado","modificado"].includes(remote)}
export async function listManagedTournaments(){const{data,error}=await supabase.from("tournaments").select("id,name,tournament_date,status,published,hole_count,start_type,scoring_mode,data_schema_version,series_id,series_round_number,game_modes(id,name)").eq("data_schema_version",2).order("tournament_date",{ascending:false}).limit(80);if(error)throw error;const rows=data||[];if(!rows.length)return rows;const exportsRes=await supabase.from("aag_exports").select("tournament_id,status,aag_tournament_id,aag_remote_status").in("tournament_id",rows.map(t=>t.id));if(exportsRes.error)throw exportsRes.error;const exported=new Set((exportsRes.data||[]).filter(effectiveExport).map(e=>String(e.tournament_id)));return rows.map(t=>({...t,aag_exported:exported.has(String(t.id))})).filter(t=>!(t.status==="archived"&&t.aag_exported))}

export async function getTournamentForEdit(id){
  const{data:tournament,error}=await supabase.from("tournaments").select(`id,name,tournament_date,status,published,hole_count,start_type,scoring_mode,data_schema_version,game_mode_id,series_id,series_round_number,tournament_categories(id,category_id,category_system,hole_segment),starting_blocks(id,name,start_time,display_order,block_type,starting_lines(id,line_time,starting_hole,label,display_order,capacity))`).eq("id",id).maybeSingle();if(error)throw error;if(!tournament)throw new Error("No se encontró el torneo.");return tournament;
}

export async function deleteTournament(id){
  const exportsRes=await supabase.from("aag_exports").select("status,aag_tournament_id,aag_remote_status").eq("tournament_id",id);if(exportsRes.error)throw exportsRes.error;if((exportsRes.data||[]).some(effectiveExport))throw new Error("No se puede eliminar un torneo que ya fue exportado a AAG.");
  const registrations=await supabase.from("registrations").select("id",{count:"exact",head:true}).eq("tournament_id",id);if(registrations.error)throw registrations.error;if(registrations.count)throw new Error("No podés eliminar el torneo porque tiene jugadores inscriptos.");
  const blocksRes=await supabase.from("starting_blocks").select("id").eq("tournament_id",id);if(blocksRes.error)throw blocksRes.error;const blockIds=(blocksRes.data||[]).map(b=>b.id);let lineIds=[];if(blockIds.length){const linesRes=await supabase.from("starting_lines").select("id").in("starting_block_id",blockIds);if(linesRes.error)throw linesRes.error;lineIds=(linesRes.data||[]).map(l=>l.id)}
  if(lineIds.length){const slotsRes=await supabase.from("line_slots").select("display_name,linked_player_id").in("starting_line_id",lineIds);if(slotsRes.error)throw slotsRes.error;if((slotsRes.data||[]).some(s=>s.linked_player_id||String(s.display_name||"").trim()))throw new Error("No podés eliminar el torneo porque tiene lugares ocupados o reservados.");}
  const result=await supabase.from("tournaments").delete().eq("id",id);if(result.error)throw result.error;
}

export async function reopenTournament(id){
  const tournamentRes=await supabase.from("tournaments").select("id,status,data_schema_version").eq("id",id).single();if(tournamentRes.error)throw tournamentRes.error;const t=tournamentRes.data;if(Number(t.data_schema_version)!==2||t.status!=="archived")throw new Error("Sólo se pueden reabrir torneos V2 archivados.");
  const exportsRes=await supabase.from("aag_exports").select("status,aag_tournament_id,aag_remote_status").eq("tournament_id",id);if(exportsRes.error)throw exportsRes.error;if((exportsRes.data||[]).some(effectiveExport))throw new Error("Este torneo ya fue exportado a AAG y no puede reabrirse desde aquí.");
  const result=await supabase.from("tournaments").update({status:"open"}).eq("id",id);if(result.error)throw result.error;
}

export async function setTournamentRegistrationStatus(id,status){
  if(!["open","closed"].includes(status))throw new Error("Estado de inscripción inválido.");
  const current=await supabase.from("tournaments").select("status,data_schema_version").eq("id",id).single();if(current.error)throw current.error;if(Number(current.data.data_schema_version)!==2)throw new Error("Sólo se administran torneos V2 desde esta pantalla.");if(!["open","closed"].includes(current.data.status))throw new Error("Este torneo ya no admite abrir o cerrar inscripciones.");
  const result=await supabase.from("tournaments").update({status}).eq("id",id);if(result.error)throw result.error;
}

export async function saveCategory(input,catalogs){
  const name=String(input.name||"").trim();if(!name)throw new Error("Ingresá el nombre de la categoría.");
  const min=input.playingHandicapMin===""?null:Number(input.playingHandicapMin),max=input.playingHandicapMax===""?null:Number(input.playingHandicapMax);if((min===null)!==(max===null))throw new Error("Completá ambos límites de HCP de juego o dejá ambos vacíos.");if(min!==null&&(!Number.isInteger(min)||!Number.isInteger(max)||min>max))throw new Error("El rango de HCP de juego debe usar enteros y mínimo ≤ máximo.");
  if(!input.rules?.length)throw new Error("Agregá al menos una regla de tee.");const rules=input.rules.map((rule,i)=>{const rmin=Number(rule.index_min),rmax=Number(rule.index_max),tee=catalogs.teeMap.get(String(rule.aag_teeout_id));if(!tee)throw new Error(`Seleccioná un tee AAG vigente en la regla ${i+1}.`);if(!Number.isFinite(rmin)||!Number.isFinite(rmax)||rmin>rmax)throw new Error(`El rango de índice de la regla ${i+1} no es válido.`);return{index_min:rmin,index_max:rmax,aag_teeout_id:String(rule.aag_teeout_id),reference:referenceFromTee(tee)}});
  const playing=String(input.playingTeeId||"")||null;if(playing&&!rules.some(r=>r.aag_teeout_id===playing))throw new Error("El tee de juego debe formar parte de las reglas.");const payload={name,active:true,display_order:Number(input.displayOrder)||0,playing_handicap_min:min,playing_handicap_max:max,playing_tee_aag_teeout_id:playing,tee_rules:rules};const query=input.id?supabase.from("categories").update(payload).eq("id",input.id):supabase.from("categories").insert(payload);const{error}=await query;if(error)throw error;
}

function validate(input,catalogs){
  if(!input.name?.trim())throw new Error("Ingresá el nombre del torneo.");if(!input.date)throw new Error("Ingresá la fecha.");if(!input.gameModeId)throw new Error("Seleccioná la modalidad.");
  const mode=catalogs.gameModes.find(m=>m.id===input.gameModeId);if(input.scoringMode==="gross"&&!String(mode?.name||"").toLowerCase().includes("medal"))throw new Error("Gross puro sólo está disponible para modalidades Medal.");
  if(!input.categoryIds?.length)throw new Error("Seleccioná al menos una categoría.");const selected=catalogs.categories.filter(c=>input.categoryIds.includes(c.id));const invalid=selected.filter(c=>!c.valid);if(invalid.length)throw new Error(`Revisá las categorías con tees AAG inválidos: ${invalid.map(c=>c.name).join(", ")}.`);
  if(input.startType==="secuencial"){if(!Number(input.interval)||Number(input.interval)<=0)throw new Error("Ingresá un intervalo válido.");const all=input.sequential||{},ranges=input.segment==="front9"?[all.b1am,all.b1pm]:input.segment==="back9"?[all.b2am,all.b2pm]:Object.values(all);if(!ranges.some(r=>r?.start&&r?.end))throw new Error("Ingresá al menos una tanda de salida en el segmento de hoyos seleccionado.");for(const r of ranges){if((r?.start&&!r?.end)||(!r?.start&&r?.end))throw new Error("Completá inicio y fin de cada tanda.");if(r?.start&&minutes(r.end)<minutes(r.start))throw new Error("El fin de una tanda no puede ser anterior al inicio.")}}
  if(input.startType==="simultanea"&&!input.simultaneous?.[0])throw new Error("Ingresá al menos una hora simultánea.");
}
function timesBetween(start,end,interval){if(!start||!end)return[];const values=[];for(let n=minutes(start),last=minutes(end);n<=last;n+=Number(interval))values.push(hhmm(n));return values}
async function createSlots(lineId){const rows=[1,2,3,4].map(slot_number=>({starting_line_id:lineId,slot_number,participant_type:"self",display_name:""}));const{error}=await supabase.from("line_slots").insert(rows);if(error)throw error}
async function blocks(id){const{data,error}=await supabase.from("starting_blocks").select("id,name,start_time,display_order").eq("tournament_id",id).order("display_order");if(error)throw error;return data||[]}
async function lines(blockId){const{data,error}=await supabase.from("starting_lines").select("id,line_time,starting_hole,label,display_order").eq("starting_block_id",blockId).order("display_order");if(error)throw error;return data||[]}
async function lineOccupied(lineId){const{data,error}=await supabase.from("line_slots").select("display_name,linked_player_id").eq("starting_line_id",lineId);if(error)throw error;return(data||[]).some(s=>s.linked_player_id||String(s.display_name||"").trim())}
async function deleteLinesSafe(rows){for(const row of rows)if(await lineOccupied(row.id))throw new Error("No se pueden quitar horarios con jugadores anotados.");if(rows.length){const{error}=await supabase.from("starting_lines").delete().in("id",rows.map(x=>x.id));if(error)throw error}}
async function deleteBlockSafe(block){const current=await lines(block.id);await deleteLinesSafe(current);const{error}=await supabase.from("starting_blocks").delete().eq("id",block.id);if(error)throw error}
async function deleteBlocksSafe(rows){
  for(const block of rows){const current=await lines(block.id);for(const line of current)if(await lineOccupied(line.id))throw new Error("No se puede cambiar el tipo de salida porque uno de los bloques que debe quitarse tiene jugadores anotados.")}
  for(const block of rows)await deleteBlockSafe(block);
}

async function upsertSequentialBlock(existing,{tournamentId,name,order,hole,ranges,interval}){
  const desired=[...timesBetween(ranges.amStart,ranges.amEnd,interval),...timesBetween(ranges.pmStart,ranges.pmEnd,interval)];if(!desired.length){if(existing)await deleteBlockSafe(existing);return}
  let block=existing;if(!block){const{data,error}=await supabase.from("starting_blocks").insert({tournament_id:tournamentId,name,start_time:`${desired[0]}:00`,block_type:"sequential",display_order:order}).select().single();if(error)throw error;block=data}else{const{error}=await supabase.from("starting_blocks").update({name,start_time:`${desired[0]}:00`,display_order:order}).eq("id",block.id);if(error)throw error}
  const current=await lines(block.id);for(let i=0;i<desired.length;i++){const payload={line_time:desired[i],starting_hole:hole,label:`Hoyo ${hole}`,capacity:4,display_order:i+1};if(current[i]){const{error}=await supabase.from("starting_lines").update(payload).eq("id",current[i].id);if(error)throw error}else{const{data,error}=await supabase.from("starting_lines").insert({starting_block_id:block.id,...payload}).select().single();if(error)throw error;await createSlots(data.id)}}await deleteLinesSafe(current.slice(desired.length));
}
function hasSequentialTimes(ranges){return Boolean(ranges.amStart||ranges.amEnd||ranges.pmStart||ranges.pmEnd)}
async function syncSequential(tournamentId,input){
  const current=await blocks(tournamentId),configs=[];
  const frontRanges={amStart:input.sequential.b1am.start,amEnd:input.sequential.b1am.end,pmStart:input.sequential.b1pm.start,pmEnd:input.sequential.b1pm.end};
  const backRanges={amStart:input.sequential.b2am.start,amEnd:input.sequential.b2am.end,pmStart:input.sequential.b2pm.start,pmEnd:input.sequential.b2pm.end};
  if(input.segment!=="back9"&&hasSequentialTimes(frontRanges))configs.push({name:"Bloque 1",order:1,hole:1,ranges:frontRanges});
  if(input.segment!=="front9"&&hasSequentialTimes(backRanges))configs.push({name:"Bloque 2",order:2,hole:10,ranges:backRanges});
  const used=new Set();
  for(const config of configs){config.block=current.find(block=>!used.has(block.id)&&String(block.name||"").trim().toLowerCase()===config.name.toLowerCase())||null;if(config.block)used.add(config.block.id)}
  await deleteBlocksSafe(current.filter(block=>!used.has(block.id)));
  for(const config of configs)await upsertSequentialBlock(config.block,{tournamentId,...config,interval:input.interval});
}
async function ensureShotgunLines(block,hour,allowedHoles){
  const current=await lines(block.id),normal=current.filter(line=>!/\bBIS\b/i.test(String(line.label||""))),used=new Set();
  for(const hole of allowedHoles){const payload={line_time:`${hour}:00`,starting_hole:hole,label:`Hoyo ${hole}`,capacity:4,display_order:hole},row=normal.find(line=>!used.has(line.id)&&Number(line.starting_hole)===hole);if(row){used.add(row.id);const{error}=await supabase.from("starting_lines").update(payload).eq("id",row.id);if(error)throw error}else{const{data,error}=await supabase.from("starting_lines").insert({starting_block_id:block.id,...payload}).select().single();if(error)throw error;await createSlots(data.id)}}
  await deleteLinesSafe(normal.filter(line=>!used.has(line.id)));
}
async function syncBis(block,hour,wanted=[],allowedHoles=[]){
  wanted=[...new Set(wanted.map(Number).filter(hole=>allowedHoles.includes(hole)))];
  const current=(await lines(block.id)).filter(line=>/\bBIS\b/i.test(String(line.label||""))),used=new Set();
  for(const hole of wanted){const payload={line_time:`${hour}:00`,starting_hole:hole,label:`Hoyo ${hole} BIS`,capacity:4,display_order:hole+100},row=current.find(line=>!used.has(line.id)&&Number(line.starting_hole)===hole);if(row){used.add(row.id);const{error}=await supabase.from("starting_lines").update(payload).eq("id",row.id);if(error)throw error}else{const{data,error}=await supabase.from("starting_lines").insert({starting_block_id:block.id,...payload}).select().single();if(error)throw error;await createSlots(data.id)}}
  await deleteLinesSafe(current.filter(line=>!used.has(line.id)));
}
async function syncShotgun(tournamentId,input){
  const hours=[...new Set((input.simultaneous||[]).filter(Boolean))],allowedHoles=input.segment==="front9"?Array.from({length:9},(_,i)=>i+1):input.segment==="back9"?Array.from({length:9},(_,i)=>i+10):Array.from({length:18},(_,i)=>i+1),current=await blocks(tournamentId),used=new Set(),plans=[];
  for(const hour of hours){let block=current.find(item=>!used.has(item.id)&&/^simultánea\b/i.test(String(item.name||""))&&asTime(item.start_time)===hour)||current.find(item=>!used.has(item.id)&&asTime(item.start_time)===hour)||current.find(item=>!used.has(item.id)&&/^simultánea\b/i.test(String(item.name||"")))||current.find(item=>!used.has(item.id))||null;if(block)used.add(block.id);plans.push({hour,block})}
  await deleteBlocksSafe(current.filter(block=>!used.has(block.id)));
  for(let i=0;i<plans.length;i++){const plan=plans[i];let block=plan.block;if(!block){const{data,error}=await supabase.from("starting_blocks").insert({tournament_id:tournamentId,name:`Simultánea ${plan.hour}`,start_time:`${plan.hour}:00`,block_type:"sequential",display_order:i+1}).select().single();if(error)throw error;block=data}else{const{error}=await supabase.from("starting_blocks").update({name:`Simultánea ${plan.hour}`,start_time:`${plan.hour}:00`,display_order:i+1}).eq("id",block.id);if(error)throw error}await ensureShotgunLines(block,plan.hour,allowedHoles);await syncBis(block,plan.hour,input.bis?.[i]||[],allowedHoles)}
}

async function syncCategories(tournamentId,input,catalogs){const selected=catalogs.categories.filter(c=>input.categoryIds.includes(c.id));const{data:current,error}=await supabase.from("tournament_categories").select("id,category_id,category_system").eq("tournament_id",tournamentId);if(error)throw error;const fresh=(current||[]).filter(c=>c.category_system==="new"&&c.category_id);const remove=fresh.filter(c=>!input.categoryIds.includes(c.category_id));if(remove.length){const{error:deleteError}=await supabase.from("tournament_categories").delete().in("id",remove.map(c=>c.id));if(deleteError)throw deleteError}for(const category of selected){const snapshot=categorySnapshot(category,catalogs.teeMap,input.segment);const existing=fresh.find(c=>c.category_id===category.id);if(existing){const{error:updateError}=await supabase.from("tournament_categories").update(snapshot).eq("id",existing.id);if(updateError)throw updateError}else{const{error:insertError}=await supabase.from("tournament_categories").insert({tournament_id:tournamentId,category_id:category.id,...snapshot});if(insertError)throw insertError}}}

export async function saveTournament(input,catalogs){
  validate(input,catalogs);let seriesId=input.series?.id||null,round=input.series?.type==="none"?null:Number(input.series?.round||0)||null;
  if(input.id){const current=await supabase.from("tournaments").select("status").eq("id",input.id).single();if(current.error)throw current.error;if(current.data.status==="archived")throw new Error("Para modificar un torneo archivado primero tenés que reabrirlo.");}
  if(input.series?.type==="new"){if(!input.series.name?.trim()||!Number(input.series.requiredRounds)||!round)throw new Error("Completá el nombre, cantidad de fechas y número de ronda de la serie.");if(round>Number(input.series.requiredRounds))throw new Error("La ronda no puede superar la cantidad de fechas.");const{data,error}=await supabase.from("tournament_series").insert({name:input.series.name.trim().toUpperCase(),description:"",required_rounds:Number(input.series.requiredRounds),scoring_mode:input.scoringMode,best18_enabled:true,status:"open"}).select("id").single();if(error)throw error;seriesId=data.id}
  if(input.series?.type==="existing"&&!seriesId)throw new Error("Seleccioná una serie existente.");
  const payload={name:input.name.trim().toUpperCase(),tournament_date:input.date,game_mode_id:input.gameModeId,scoring_mode:input.scoringMode,start_type:input.startType,hole_count:input.segment==="18"?18:9,published:!!input.published,series_id:seriesId,series_round_number:round};let tournamentId=input.id;
  if(tournamentId){const{data,error}=await supabase.from("tournaments").update(payload).eq("id",tournamentId).select("id").single();if(error)throw error;tournamentId=data.id}else{const{data,error}=await supabase.from("tournaments").insert({...payload,start_type_template_id:START_TYPE_TEMPLATE_ID,data_schema_version:2,status:"closed"}).select("id").single();if(error)throw error;tournamentId=data.id}
  await syncCategories(tournamentId,input,catalogs);if(input.startType==="secuencial")await syncSequential(tournamentId,input);else await syncShotgun(tournamentId,input);return tournamentId;
}
