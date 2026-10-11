import { requireSession } from "./auth.js";
import { escapeHtml, formatDate, notify } from "./ui.js";
import { listTvTournaments, loadTvSettings, saveTvSettings } from "./tv_service.js";

const context=await requireSession();if(context.profile.role!=="admin"){location.replace("panel.html");throw new Error("Acceso restringido")}
const byId=id=>document.getElementById(id),ids={tournament:"tvTournament",series:"tvSeriesMode",scratchMale:"tvScratchMale",scratchFemale:"tvScratchFemale",exclude:"tvExcludeScratch",music:"tvMusic",photos:"tvPhotos",sponsors:"tvSponsors",logo:"tvLogo",qr:"tvQr",single:"tvSingleCategory",leader:"tvLeaderSeconds",media:"tvMediaSeconds"};
let tournaments=[],writing=false;
const setState=(text,type="info")=>{const node=byId("tvControlState");node.textContent=text;node.className=`status ${type}`};
const bool=(id,value)=>{byId(id).checked=value??true};
function selectedTournament(){return tournaments.find(item=>String(item.id)===String(byId(ids.tournament).value))||null}
function updateSeries(){
  const tournament=selectedTournament(),isSeries=!!tournament?.series_id;
  byId(ids.series).value=isSeries?"aggregate":"daily";
  byId(ids.series).disabled=true;
  byId("tvSeriesHelp").textContent=isSeries
    ?"El proyector muestra automáticamente el acumulado cuando el torneo pertenece a una serie."
    :"El proyector muestra automáticamente los resultados de esta fecha.";
  renderSummary();
}
function applySingleMode(){
  const active=byId(ids.single).checked;[ids.photos,ids.sponsors,ids.logo,ids.qr].forEach(id=>{const input=byId(id);if(active)input.checked=false;input.disabled=active;input.closest(".tv-option").classList.toggle("disabled",active)});renderSummary();
}
function inferSingleMode(){byId(ids.single).checked=![ids.photos,ids.sponsors,ids.logo,ids.qr].some(id=>byId(id).checked);applySingleMode()}
function renderSummary(){
  const tournament=selectedTournament(),enabled=[["Fotos",ids.photos],["Sponsors",ids.sponsors],["Logo",ids.logo],["QR",ids.qr],["Música",ids.music]].filter(([,id])=>byId(id)?.checked).map(([name])=>name);
  byId("tvControlSummary").innerHTML=`<div class="tv-summary-tournament"><span>Torneo seleccionado</span><strong>${escapeHtml(tournament?.name||"Sin torneo")}</strong><small>${tournament?formatDate(tournament.tournament_date):"La pantalla queda sin clasificación seleccionada."}</small></div><div class="tv-summary-row"><span>Vista</span><b>${byId(ids.series)?.value==="aggregate"?"Acumulado de serie":"Resultados del día"}</b></div><div class="tv-summary-row"><span>Multimedia</span><b>${enabled.join(" · ")||"Desactivada"}</b></div><div class="tv-summary-row"><span>Rotación</span><b>${byId(ids.leader)?.value||14}s / ${byId(ids.media)?.value||9}s</b></div>`;
}
function renderSettings(data){
  byId(ids.tournament).value=data.tournament_id||"";byId(ids.series).value=data.series_view_mode==="aggregate"?"aggregate":"daily";bool(ids.scratchMale,data.show_scratch_male);bool(ids.scratchFemale,data.show_scratch_female);bool(ids.exclude,data.exclude_scratch_from_category);bool(ids.photos,data.show_photos);bool(ids.sponsors,data.show_sponsors);bool(ids.logo,data.show_logo_media);bool(ids.qr,data.show_qr);bool(ids.music,data.music_enabled);byId(ids.leader).value=data.leaderboard_rotation_seconds??14;byId(ids.media).value=data.media_rotation_seconds??9;byId("tvLastUpdate").textContent=`Última actualización: ${data.updated_at?new Date(data.updated_at).toLocaleString("es-AR"):"—"}`;inferSingleMode();updateSeries();setState("Configuración cargada","open");
}
async function load(){
  const result=await Promise.all([listTvTournaments(),loadTvSettings()]);tournaments=result[0];byId(ids.tournament).innerHTML='<option value="">Sin torneo seleccionado</option>'+tournaments.map(t=>`<option value="${t.id}">${formatDate(t.tournament_date)} · ${escapeHtml(t.name)}</option>`).join("");renderSettings(result[1]);
}
async function save(){
  if(writing)return;writing=true;const button=byId("saveTvControl");button.disabled=true;button.textContent="Guardando…";setState("Actualizando pantalla…","pending");
  try{const data=await saveTvSettings({tournament_id:byId(ids.tournament).value||null,series_view_mode:byId(ids.series).value,show_scratch_male:byId(ids.scratchMale).checked,show_scratch_female:byId(ids.scratchFemale).checked,exclude_scratch_from_category:byId(ids.exclude).checked,show_photos:byId(ids.photos).checked,show_sponsors:byId(ids.sponsors).checked,show_logo_media:byId(ids.logo).checked,show_qr:byId(ids.qr).checked,music_enabled:byId(ids.music).checked,media_rotation_seconds:Math.max(3,Math.min(120,Number(byId(ids.media).value)||9)),leaderboard_rotation_seconds:Math.max(5,Math.min(120,Number(byId(ids.leader).value)||14))});renderSettings(data);setState("Guardado · TV actualiza en hasta 5 s","open");notify("Configuración guardada. El TV la tomará en hasta 5 segundos.","success")}
  catch(error){setState("No se pudo guardar","danger");notify(error.message||"No se pudo actualizar la TV.","error")}
  finally{writing=false;button.disabled=false;button.textContent="Guardar y actualizar TV"}
}
byId(ids.tournament).addEventListener("change",updateSeries);byId(ids.single).addEventListener("change",applySingleMode);
[ids.scratchMale,ids.scratchFemale,ids.exclude,ids.music,ids.photos,ids.sponsors,ids.logo,ids.qr,ids.leader,ids.media].forEach(id=>byId(id).addEventListener("change",()=>{if([ids.photos,ids.sponsors,ids.logo,ids.qr].includes(id)&&byId(id).checked)byId(ids.single).checked=false;applySingleMode()}));
byId("saveTvControl").addEventListener("click",save);byId("closeTvControl").addEventListener("click",()=>{if(window.opener)window.close();else location.href="panel.html"});
try{await load()}catch(error){setState("Error de conexión","danger");notify(error.message||"No se pudo cargar Control TV.","error")}
