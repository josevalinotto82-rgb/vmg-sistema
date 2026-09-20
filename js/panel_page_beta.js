import { requireSession } from "./auth_beta.js";
import { mountShell, getActiveTournament, setActiveTournament, stages, tournamentUrl } from "./shell_beta.js";
import { listOperationalTournaments, listPublishedOpenTournaments, getTournamentMetrics } from "./dashboard_service_beta.js";
import { escapeHtml, formatDate, notify } from "./ui_beta.js";

const context = await requireSession();
mountShell({ context, showSteps: false });
const content = document.getElementById("panelContent");
const title = document.getElementById("welcomeTitle");
const subtitle = document.getElementById("welcomeText");
const role = document.getElementById("panelRole");
const heroActions = document.getElementById("heroActions");

function statusLabel(value){return ({draft:"Borrador",closed:"Inscripción programada",open:"Abierto",officialized:"Guardado",archived:"Archivado"})[value]||value||"—"}
function statusClass(value){return ["open","officialized"].includes(value)?"open":value==="archived"?"neutral":"pending"}

async function selectTournament(tournament, tournaments){
  setActiveTournament(tournament); notify(`Torneo activo: ${tournament.name}`); await renderAdmin(tournaments, tournament);
}

async function renderAdmin(tournaments, selected){
  const active = selected || tournaments.find(t=>t.id===getActiveTournament().id) || tournaments.find(t=>["open","officialized"].includes(t.status)) || tournaments[0];
  if(active) setActiveTournament(active);
  const metrics = active ? await getTournamentMetrics(active.id) : {registrations:0,scorecards:0,ready:0,exported:0};
  content.innerHTML = `${active ? `<section class="tournament-strip"><div class="tournament-main"><span class="status ${statusClass(active.status)}">${statusLabel(active.status)}</span><h2>${escapeHtml(active.name)}</h2><div class="meta">${formatDate(active.tournament_date)} · ${escapeHtml(active.game_modes?.name||"Modalidad")} · ${active.hole_count} hoyos</div></div><div class="metric"><strong>${metrics.registrations}</strong><span>Inscriptos</span></div><div class="metric"><strong>${metrics.scorecards}</strong><span>Tarjetas creadas</span></div><div class="metric"><strong>${metrics.ready}</strong><span>Listas AAG</span></div><div class="metric"><strong>${metrics.exported}</strong><span>Exportadas</span></div></section>` : ""}
  <section class="grid two"><article class="card"><div class="card-head"><div><h2>Continuar torneo</h2><div class="subtle">Todas las etapas conservan el torneo seleccionado</div></div></div><div class="card-body action-list">${stages.map((stage,i)=>`<a class="action" href="${tournamentUrl(stage,active?.id)}"><span class="action-icon">${i+1}</span><span class="action-copy"><strong>${stage.label}</strong><span>${["Datos, categorías y salidas","Grilla, reservas y jugadores","HCP, pagos e impresión","Golpes, NPT y DESC","Ganadores e informes","Control y envío AAG"][i]}</span></span><span class="chev">›</span></a>`).join("")}</div></article>
  <aside class="card"><div class="card-head"><div><h2>Torneos recientes</h2><div class="subtle">Elegí el contexto de trabajo</div></div></div><div class="card-body action-list">${tournaments.slice(0,8).map(t=>`<button class="action" style="text-align:left;cursor:pointer" data-select-tournament="${t.id}"><span class="action-copy"><strong>${escapeHtml(t.name)}</strong><span>${formatDate(t.tournament_date)} · ${statusLabel(t.status)}</span></span>${t.id===active?.id?'<span class="status open">Activo</span>':'<span class="chev">›</span>'}</button>`).join("")||'<div class="notice warn">No se encontraron torneos V2.</div>'}</div></aside></section>
  <section class="grid three" style="margin-top:18px"><a class="card" href="scorecard_libre_beta.html"><div class="card-body"><span class="status info">Operación diaria</span><h3 style="margin-top:12px">Tarjeta libre</h3><p class="subtle">Green fee, impresión y resultado.</p></div></a><a class="card" href="administracion_beta.html"><div class="card-body"><span class="status neutral">Administración</span><h3 style="margin-top:12px">AAG y herramientas</h3><p class="subtle">Sincronización, archivos y control.</p></div></a><a class="card" href="resultados_beta.html"><div class="card-body"><span class="status open">Público</span><h3 style="margin-top:12px">Resultados</h3><p class="subtle">Torneos jugados y series.</p></div></a></section>`;
  content.querySelectorAll("[data-select-tournament]").forEach(btn=>btn.addEventListener("click",()=>selectTournament(tournaments.find(t=>t.id===btn.dataset.selectTournament),tournaments)));
}

async function renderMember(){
  const tournaments=await listPublishedOpenTournaments();
  content.innerHTML=`<section class="grid two"><article class="card"><div class="card-head"><h2>Torneos disponibles</h2></div><div class="card-body action-list">${tournaments.map(t=>`<a class="action" href="inscripciones_beta.html?torneo_id=${encodeURIComponent(t.id)}"><span class="action-icon">⛳</span><span class="action-copy"><strong>${escapeHtml(t.name)}</strong><span>${formatDate(t.tournament_date)} · ${escapeHtml(t.game_modes?.name||"")}</span></span><span class="chev">›</span></a>`).join("")||'<div class="notice warn">No hay torneos habilitados para inscripción.</div>'}</div></article><aside class="card"><div class="card-head"><h2>Accesos</h2></div><div class="card-body action-list"><a class="action" href="resultados_beta.html"><span class="action-icon">★</span><span class="action-copy"><strong>Resultados</strong><span>Consultar torneos jugados</span></span><span class="chev">›</span></a></div></aside></section>`;
}

try{
  const email=context.user.email||"";
  title.textContent=context.profile.role==="admin"?"Operación del club":"Hola";
  subtitle.textContent=context.profile.role==="admin"?"Elegí un torneo y avanzá por cada etapa sin perder el contexto.":`Sesión iniciada como ${email}`;
  role.textContent=context.profile.role==="admin"?"Panel administrador":"Panel de jugador";
  if(context.profile.role==="admin"){
    heroActions.innerHTML='<a class="btn primary" href="torneos_beta.html?nuevo=1">＋ Crear torneo</a>';
    const tournaments=await listOperationalTournaments(); await renderAdmin(tournaments);
  }else await renderMember();
}catch(error){console.error(error);content.innerHTML=`<div class="notice warn">No se pudo cargar el panel: ${escapeHtml(error.message)}</div>`}
