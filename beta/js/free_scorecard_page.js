import { requireSession } from "./auth.js";
import { escapeHtml, formatDate, notify } from "./ui.js";
import { nextCouponNumber } from "./officialization_service.js";
import { preprintedCardCss } from "./officialization_print.js";
import { enabledHoles, loadFreeCardCatalogs, localDate, normalizeSegment, playerFromResult, saveFreeScorecard, searchFreePlayers, suggestedCategory, teeConfiguration, toNumber, weekday } from "./free_scorecard_service.js";

const context=await requireSession();
if(context.profile.role!=="admin"){location.replace("panel.html");throw new Error("Acceso restringido")}
if(!localStorage.getItem("ticket_branch_code")){const email=String(context.user?.email||"").toLowerCase(),branches={"lau_m2000@hotmail.com":"S1","giselaantonino@gmail.com":"S2"};localStorage.setItem("ticket_branch_code",branches[email]||"S1")}
const byId=id=>document.getElementById(id),search=byId("freePlayerSearch"),results=byId("freePlayerResults"),gamePanel=byId("freeGamePanel"),scorePanel=byId("freeScorePanel"),status=byId("freeCardStatus"),totals=byId("freeScoreTotals");
let catalogs=null,players=[],player=null,configuration=null,scores={},timer=0,saving=false;
const setStatus=(text,type="info")=>{status.textContent=text;status.className=`status ${type}`};
const indexText=value=>toNumber(value)==null?"—":Number(value).toFixed(1);
const money=value=>new Intl.NumberFormat("es-AR",{style:"currency",currency:"ARS"}).format(Number(value||0));
const memberNumber=value=>String(value||"").replace(/\.0$/,"").trim();
const scoreResult=()=>{
  const holes=enabledHoles(configuration?.segment),values=holes.map(h=>toNumber(scores[h])).filter(v=>v!=null),gross=values.length?values.reduce((sum,v)=>sum+v,0):null,complete=values.length===holes.length,card_status=!values.length?"npt":complete?"valid":"desc",net=gross==null?null:gross-Number(configuration?.playing_handicap||0);
  return{gross,net,card_status,loaded:values.length,total:holes.length};
};
const holeScores=()=>Object.fromEntries(enabledHoles(configuration.segment).map(h=>[String(h),scores[h]==null||scores[h]===""?null:{strokes:Number(scores[h]),par_value:configuration.holes.find(x=>x.hole===h)?.par??null,hole_handicap:configuration.holes.find(x=>x.hole===h)?.handicap??null}]));

function renderSearchRows(){
  results.innerHTML=players.length?players.map((item,index)=>`<button type="button" class="free-player-row" data-player="${index}"><span class="free-player-avatar">${escapeHtml(String(item.full_name||item.last_name||"?").trim()[0]||"?")}</span><span><strong>${escapeHtml(item.full_name||[item.last_name,item.first_name].filter(Boolean).join(", "))}</strong><small>Matrícula ${escapeHtml(memberNumber(item.aag_member_number)||"—")} · Index ${indexText(item.current_index)} · ${escapeHtml(item.club_name||"Sin club")}</small></span><b>${item.source==="players"?"Players":"AAG"}</b></button>`).join(""):'<div class="empty-state compact">No se encontraron jugadores.</div>';
}
async function runSearch(){
  const term=search.value.trim();if(term.length<2){results.innerHTML='<div class="empty-state compact">Escribí al menos dos caracteres.</div>';return}
  results.innerHTML='<div class="empty-state compact">Buscando…</div>';
  try{players=await searchFreePlayers(term);renderSearchRows();if(players.length===1&&document.activeElement===search)setStatus("Una coincidencia encontrada.","info")}catch(error){results.innerHTML=`<div class="notice warn">${escapeHtml(error.message)}</div>`}
}
function teeOptions(){
  return catalogs.tees.filter(tee=>(Number(tee.category)===1?"female":"male")===player.gender).map(tee=>`<option value="${tee.id}" ${String(tee.id)===String(configuration?.tee?.id)?"selected":""}>${escapeHtml(tee.tee_name)}</option>`).join("");
}
function renderGame(){
  if(!player||!configuration)return;
  byId("freePlayerName").textContent=player.display_name;
  byId("freePlayerMeta").textContent=`Matrícula ${memberNumber(player.aag_member_number)||"—"} · Index ${indexText(player.official_index)} · ${player.is_club_member?"Socio VMGC":"Invitado / AAG"}`;
  gamePanel.innerHTML=`<div class="free-game-controls"><div class="field"><label>Segmento</label><select class="control" id="freeSegment"><option value="18" ${configuration.segment==="18"?"selected":""}>18 hoyos</option><option value="front9" ${configuration.segment==="front9"?"selected":""}>Hoyos 1 al 9</option><option value="back9" ${configuration.segment==="back9"?"selected":""}>Hoyos 10 al 18</option></select></div><div class="field"><label>Tee de salida</label><select class="control" id="freeTee">${teeOptions()}</select></div></div><div class="free-game-summary"><div><span>Categoría</span><strong>${escapeHtml(configuration.category?.name||"—")}</strong></div><div><span>HCP de juego</span><strong>${configuration.playing_handicap??"—"}</strong></div><div><span>Slope</span><strong>${configuration.slope??"—"}</strong></div><div><span>Rating</span><strong>${configuration.course_rating?.toFixed?.(1)??configuration.course_rating??"—"}</strong></div><div><span>Par</span><strong>${configuration.par??"—"}</strong></div></div><div class="free-game-actions"><button class="btn secondary" id="autoFreeTee">Restablecer tee recomendado</button><button class="btn outline" id="printFreeCard">Imprimir tarjeta</button></div>`;
  byId("freeSegment").addEventListener("change",event=>changeConfiguration(configuration.tee.id,event.target.value));
  byId("freeTee").addEventListener("change",event=>changeConfiguration(event.target.value,configuration.segment));
  byId("autoFreeTee").addEventListener("click",()=>{const automatic=suggestedCategory(catalogs,player.official_index,player.gender);if(automatic)changeConfiguration(automatic.tee.id,configuration.segment)});
  byId("printFreeCard").addEventListener("click",printCard);
  byId("printFreeCoupon").disabled=false;
}
function changeConfiguration(teeId,segment){
  const next=teeConfiguration(catalogs,player,teeId,normalizeSegment(segment));if(!next){notify("No se pudo calcular el HCP para ese tee y segmento.","error");return}
  configuration=next;scores={};renderGame();renderScore();
}
function selectPlayer(item){
  player=playerFromResult(item);
  if(player.official_index==null){notify("El jugador no tiene un Index vigente cargado.","error");return}
  const automatic=suggestedCategory(catalogs,player.official_index,player.gender);if(!automatic){notify("No se encontró una categoría automática para este jugador.","error");return}
  configuration=teeConfiguration(catalogs,player,automatic.tee.id,"18");scores={};search.value="";results.innerHTML='<div class="empty-state compact">Jugador seleccionado. Buscador listo para una nueva consulta.</div>';renderGame();renderScore();setStatus(`Tarjeta preparada para ${player.display_name}.`,"open");
}
function renderScore(){
  if(!configuration)return;
  const holes=enabledHoles(configuration.segment),first=holes.filter(h=>h<=9),second=holes.filter(h=>h>=10);
  const grid=list=>`<div class="free-hole-grid">${list.map(h=>{const meta=configuration.holes.find(item=>item.hole===h)||{};return`<label class="free-hole"><span>H${h}</span><small>Par ${meta.par??"—"} · HCP ${meta.handicap??"—"}</small><input class="control" inputmode="numeric" data-free-hole="${h}" value="${scores[h]??""}"></label>`}).join("")}</div>`;
  scorePanel.innerHTML=`${first.length?`<h3>Ida · Hoyos 1 al 9</h3>${grid(first)}`:""}${second.length?`<h3>Vuelta · Hoyos 10 al 18</h3>${grid(second)}`:""}<div class="free-score-actions"><button class="btn secondary" id="clearFreeScores">Limpiar golpes</button><button class="btn primary" id="saveFreeScore">Guardar tarjeta</button></div>`;
  const inputs=[...scorePanel.querySelectorAll("[data-free-hole]")];
  inputs.forEach((input,index)=>{input.addEventListener("input",()=>{scores[Number(input.dataset.freeHole)]=input.value;renderTotals()});input.addEventListener("keydown",event=>{if(event.key!=="Enter")return;event.preventDefault();if(inputs[index+1]){inputs[index+1].focus();inputs[index+1].select()}else saveCard()})});
  byId("clearFreeScores").addEventListener("click",()=>{scores={};renderScore()});byId("saveFreeScore").addEventListener("click",saveCard);renderTotals();
}
function renderTotals(){
  if(!configuration){totals.innerHTML="";return}const result=scoreResult();
  totals.innerHTML=`<span><small>Gross</small><b>${result.gross??"—"}</b></span><span><small>HCP</small><b>${configuration.playing_handicap??"—"}</b></span><span><small>Neto</small><b>${result.net??"—"}</b></span><span class="status ${result.card_status==="valid"?"open":result.card_status==="desc"?"danger":"pending"}">${result.card_status==="valid"?"Completa":result.card_status==="desc"?"Incompleta":"Sin cargar"}</span>`;
}
async function saveCard(){
  if(saving||!player||!configuration)return;const result=scoreResult();if(result.card_status!=="valid"){notify(`Completá los ${result.total} hoyos antes de guardar una tarjeta exportable.`,"error");return}
  saving=true;const button=byId("saveFreeScore");if(button){button.disabled=true;button.textContent="Guardando…"}setStatus("Creando o reutilizando el torneo libre de hoy…","pending");
  try{const tournament=await saveFreeScorecard({catalogs,player,configuration,holeScores:holeScores(),result});setStatus(`Guardada en ${tournament.name}. Lista para exportación.`,"open");notify("Tarjeta libre guardada correctamente.","success");setTimeout(()=>resetAll(true),700)}
  catch(error){setStatus(error.message||"No se pudo guardar.","danger");notify(error.message||"No se pudo guardar la tarjeta.","error")}
  finally{saving=false;if(button){button.disabled=false;button.textContent="Guardar tarjeta"}}
}
function fontPlayer(value){return String(value||"").length>38?10:String(value||"").length>30?11:12}
function printCard(){
  if(!player||!configuration)return;
  const root=byId("printRoot"),details=`— / Tee: ${configuration.tee.tee_name||"—"} / —`,date=formatDate(localDate()),title=`Green Fee ${weekday()}`;
  root.innerHTML=preprintedCardCss()+`<div class="tarjeta-page"><div class="tarjeta-landscape"><div class="tj-field tj-tournament" style="font-size:20px">${escapeHtml(title)}</div><div class="tj-field tj-date">${date}</div><div class="tj-field tj-player-single" style="font-size:${fontPlayer(player.display_name)}px">${escapeHtml(player.display_name)}</div><div class="tj-field tj-handicap">${configuration.playing_handicap}</div><div class="tj-field tj-number">${escapeHtml(memberNumber(player.aag_member_number))}</div><div class="tj-field tj-index">(${indexText(player.official_index)})<br>INDEX</div><div class="tj-field tj-details">${escapeHtml(details)}</div></div></div>`;
  document.body.classList.add("printing-scorecards");setTimeout(()=>window.print(),100);setTimeout(()=>{document.body.classList.remove("printing-scorecards");root.innerHTML=""},1200);
}
function couponAmount(){const raw=String(byId("freeCouponAmount").value||"").replace(/\$/g,"").replace(/\s/g,"").replace(/\./g,"").replace(",",".");return Number(raw)||0}
function formatCouponAmount(){const amount=couponAmount();byId("freeCouponAmount").value=amount?money(amount):"";localStorage.setItem("green_fee_ticket_amount",String(amount))}
async function printCoupon(){
  if(!player)return;
  try{const number=await nextCouponNumber(),amount=couponAmount(),method=byId("freeCouponMethod").value,html=`<div class="ticket-80"><div style="text-align:center;font-size:14px;font-weight:700">Villa María Golf Club</div><div style="text-align:center;font-size:12px">Cupón de pago NO FISCAL</div><div style="border-top:1px dashed #000;margin:6px 0"></div><div style="font-size:12px;line-height:1.5"><div><b>Cupón:</b> ${escapeHtml(number)}</div><div><b>Fecha:</b> ${escapeHtml(new Date().toLocaleDateString("es-AR"))}</div><div><b>Torneo:</b> Green Fee ${escapeHtml(weekday())}</div><div><b>Jugador:</b> ${escapeHtml(player.display_name)}</div><div><b>Matrícula:</b> ${escapeHtml(memberNumber(player.aag_member_number)||"—")}</div><div><b>Concepto:</b> Green fee</div><div><b>Importe:</b> ${money(amount)}</div><div><b>Forma de pago:</b> ${escapeHtml(method)}</div></div><div style="border-top:1px dashed #000;margin:6px 0"></div><div style="font-size:11px;text-align:center">NO VÁLIDO COMO FACTURA</div></div>`;if(typeof window.imprimirTicketQZ!=="function")throw new Error("No se encontró la conexión con QZ Tray.");await window.imprimirTicketQZ(html);setStatus(`Cupón ${number} impreso para ${player.display_name}.`,"open")}catch(error){notify(error.message||"No se pudo imprimir el cupón.","error")}}
function resetAll(focus=false){player=null;configuration=null;scores={};search.value="";players=[];results.innerHTML='<div class="empty-state compact">Escribí al menos dos caracteres.</div>';byId("freePlayerName").textContent="Seleccioná un jugador";byId("freePlayerMeta").textContent="El sistema asignará categoría, tee y HCP automáticamente.";gamePanel.innerHTML='<div class="empty-state">Primero seleccioná un jugador.</div>';scorePanel.innerHTML='<div class="empty-state">La carga de hoyos aparecerá al seleccionar un jugador.</div>';totals.innerHTML="";byId("printFreeCoupon").disabled=true;setStatus("Lista para una nueva tarjeta.","info");if(focus){search.focus();search.select()}}

results.addEventListener("click",event=>{const button=event.target.closest("[data-player]");if(button)selectPlayer(players[Number(button.dataset.player)])});
search.addEventListener("input",()=>{clearTimeout(timer);timer=setTimeout(runSearch,280)});search.addEventListener("keydown",event=>{if(event.key==="Enter"){event.preventDefault();if(players.length===1)selectPlayer(players[0]);else runSearch()}});
byId("newFreeCard").addEventListener("click",()=>resetAll(true));byId("closeFreeCard").addEventListener("click",()=>{if(window.opener)window.close();else location.href="panel.html"});byId("printFreeCoupon").addEventListener("click",printCoupon);
byId("freeCouponAmount").addEventListener("focus",()=>{const amount=couponAmount();byId("freeCouponAmount").value=amount?String(Math.round(amount)):""});byId("freeCouponAmount").addEventListener("blur",formatCouponAmount);

try{const saved=Number(localStorage.getItem("green_fee_ticket_amount")||0);byId("freeCouponAmount").value=saved?money(saved):"";catalogs=await loadFreeCardCatalogs();setStatus("Cancha y categorías listas.","open");search.focus()}catch(error){setStatus(error.message||"No se pudo iniciar la herramienta.","danger");scorePanel.innerHTML=`<div class="notice warn">${escapeHtml(error.message)}</div>`}
