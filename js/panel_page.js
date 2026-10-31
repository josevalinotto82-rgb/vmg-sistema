import { requireSession } from "./auth.js";
import { mountShell, getActiveTournament, setActiveTournament, clearActiveTournament, tournamentUrl, stages, panelTools, openPanelTool } from "./shell.js";
import { listOperationalTournaments, listPublishedOpenTournaments, getTournamentMetrics, getUserDisplayName } from "./dashboard_service.js";
import { escapeHtml, formatDate, notify } from "./ui.js";
import { mountHcpLookup } from "./hcp_lookup.js";

const context = await requireSession({ admin: true });
document.body.classList.add("home-page");
mountShell({ context, showSteps: false, showSettings: true });
const content = document.getElementById("panelContent"), title = document.getElementById("welcomeTitle"), subtitle = document.getElementById("welcomeText"), role = document.getElementById("panelRole"), heroActions = document.getElementById("heroActions");
let adminTournaments = [], activeTournament = null;
const mountHomeHcp = () => mountHcpLookup(document.getElementById("homeHcpLookup"));


const operationIcons = {"misc-billing":"<svg width=\"23\" height=\"23\" viewBox=\"0 0 24 24\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"1.7\" stroke-linecap=\"round\" stroke-linejoin=\"round\" aria-hidden=\"true\"><path d=\"M6 3h12v18l-3-2-3 2-3-2-3 2V3Z\"/><path d=\"M9 7h6M9 11h6M9 15h3\"/></svg>","notifications":"<svg width=\"23\" height=\"23\" viewBox=\"0 0 24 24\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"1.7\" stroke-linecap=\"round\" stroke-linejoin=\"round\" aria-hidden=\"true\"><path d=\"M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9\"/><path d=\"M10 21h4M12 2V1\"/></svg>","aag":"<svg width=\"23\" height=\"23\" viewBox=\"0 0 24 24\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"1.7\" stroke-linecap=\"round\" stroke-linejoin=\"round\" aria-hidden=\"true\"><path d=\"M20 7v5h-5M4 17v-5h5\"/><path d=\"M6.1 6.1A8 8 0 0 1 20 12M4 12a8 8 0 0 0 13.9 5.9\"/></svg>","free-card":"<svg width=\"23\" height=\"23\" viewBox=\"0 0 24 24\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"1.7\" stroke-linecap=\"round\" stroke-linejoin=\"round\" aria-hidden=\"true\"><rect x=\"4\" y=\"3\" width=\"16\" height=\"18\" rx=\"2\"/><path d=\"M8 7h8M8 11h2M14 11h2M8 15h2M14 15h2M8 18h2M14 18h2\"/></svg>"};
function toolsCard(){return `<aside class="card home-tools-card"><div class="card-head"><div><h2>Operaciones</h2><div class="subtle">Gestiones de todos los días</div></div></div><div class="card-body home-tool-grid">${panelTools.map(item=>`<button type="button" class="home-tool-item" data-panel-tool="${item.id}"><span class="action-icon">${operationIcons[item.id]||item.icon}</span><span class="operation-copy"><strong>${escapeHtml(item.label)}</strong><small>${escapeHtml(item.description)}</small></span><span class="operation-arrow" aria-hidden="true">›</span></button>`).join("")}</div></aside>`;}
content.addEventListener("click",event=>{const button=event.target.closest("[data-panel-tool]");if(button)openPanelTool(button.dataset.panelTool);});

function greeting() { const hour = new Date().getHours(); return hour < 12 ? "Buen día" : hour < 20 ? "Buenas tardes" : "Buenas noches"; }
function statusLabel(tournament) { if (tournament?.aag_exported) return "Exportado AAG"; return ({ draft:"Borrador", closed:"Programado", open:"Abierto", officialized:"Guardado", archived:"Archivado" })[tournament?.status] || tournament?.status || "—"; }
function statusClass(tournament) { if (tournament?.aag_exported) return "info"; return ["open","officialized"].includes(tournament?.status) ? "open" : tournament?.status === "archived" ? "neutral" : "pending"; }

function tournamentStrip(tournament, metrics) {
  return `<section class="tournament-strip"><div class="tournament-main"><span class="status ${statusClass(tournament)}">${statusLabel(tournament)}</span><h2>${escapeHtml(tournament.name)}</h2><div class="meta">${formatDate(tournament.tournament_date)} · ${escapeHtml(tournament.game_modes?.name || "Modalidad")} · ${tournament.hole_count} hoyos</div></div><div class="metric"><strong>${metrics.registrations}</strong><span>Inscriptos</span></div><div class="metric"><strong>${metrics.scorecards}</strong><span>Jugadores guardados</span></div><div class="metric"><strong>${metrics.ready}</strong><span>Tarjetas cargadas</span></div><div class="metric"><strong>${metrics.exported}</strong><span>Exportadas AAG</span></div></section>`;
}

function nextAction(active, metrics) {
  if (String(active.notes || "").startsWith("VMGC_FREE_SCORECARD_V2:")) return { pending:0, progress:100, notice:`Hay ${metrics.scorecards} tarjeta(s) libre(s) de este día. Podés abrirlas para consultar o corregir sus resultados.`, href:tournamentUrl(stages[3],active.id), label:"Ver tarjetas libres →" };
  const pending = Math.max(0, metrics.registrations - metrics.scorecards), progress = metrics.registrations ? Math.round(metrics.scorecards * 100 / metrics.registrations) : 0;
  if (pending) return { pending, progress, notice:`Hay ${pending} jugador${pending === 1 ? "" : "es"} que necesita${pending === 1 ? "" : "n"} revisión antes de imprimir todas las tarjetas.`, href:tournamentUrl(stages[2], active.id), label:"Continuar en Adm. torneo →" };
  if (metrics.registrations && metrics.ready < metrics.registrations) return { pending:Math.max(0, metrics.registrations - metrics.ready), progress:100, notice:"Los jugadores ya están guardados. Podés continuar con la carga de tarjetas.", href:tournamentUrl(stages[3], active.id), label:"Continuar a tarjetas →" };
  return { pending:0, progress:metrics.registrations ? 100 : 0, notice:metrics.registrations ? "El torneo está preparado para consultar sus resultados." : "El torneo todavía no tiene jugadores inscriptos.", href:tournamentUrl(metrics.registrations ? stages[4] : stages[1], active.id), label:metrics.registrations ? "Ver resultados →" : "Ir a inscripciones →" };
}

function mountTournamentDrawer() {
  document.getElementById("tournamentPicker")?.remove();
  const drawer = document.createElement("div"); drawer.id = "tournamentPicker"; drawer.className = "drawer";
  drawer.innerHTML = `<section class="drawer-panel narrow"><div class="drawer-head"><div><div class="eyebrow">Contexto de trabajo</div><h2>Cambiar torneo</h2><p class="subtle">La selección se conserva en todas las etapas.</p></div><button class="btn secondary small" data-close>✕</button></div><div class="tournament-picker-filters"><div class="field"><label>Buscar por nombre</label><input class="control" data-search placeholder="Nombre del torneo"></div><div class="field date"><label>Fecha</label><input class="control" data-date type="date" aria-label="Buscar torneo por fecha"></div></div><div class="tournament-list" data-list style="margin-top:14px"></div></section>`;
  document.body.appendChild(drawer);
  const render = () => { const query = String(drawer.querySelector("[data-search]").value || "").toLowerCase(), date = drawer.querySelector("[data-date]").value; const list = adminTournaments.filter(item => (!date || item.tournament_date === date) && `${item.name} ${item.tournament_date}`.toLowerCase().includes(query)); drawer.querySelector("[data-list]").innerHTML = list.map(item => `<button class="tournament-item ${item.id === activeTournament?.id ? "active" : ""}" data-id="${item.id}"><span class="tournament-main-button"><b>${escapeHtml(item.name)}</b><small>${formatDate(item.tournament_date)} · ${statusLabel(item)}</small></span>${item.id === activeTournament?.id ? '<span class="status open">Activo</span>' : '<span class="chev">›</span>'}</button>`).join("") || '<div class="empty-state compact">No hay coincidencias.</div>'; drawer.querySelectorAll("[data-id]").forEach(button => button.addEventListener("click", async () => { activeTournament = adminTournaments.find(item => item.id === button.dataset.id); setActiveTournament(activeTournament); drawer.classList.remove("open"); await renderAdmin(); notify(`Torneo activo: ${activeTournament.name}`); })); };
  drawer.querySelector("[data-close]").addEventListener("click", () => drawer.classList.remove("open")); drawer.querySelector("[data-search]").addEventListener("input", render); drawer.querySelector("[data-date]").addEventListener("input", render); render();
  document.getElementById("changeTournamentButton")?.addEventListener("click", async () => { drawer.classList.add("open"); try { adminTournaments = await listOperationalTournaments({ limit:500 }); if (drawer.isConnected) render(); } catch (error) { notify(error.message,"error"); } });
}

async function renderAdmin(prefetchedMetrics = null) {
  activeTournament = activeTournament || adminTournaments.find(item => item.id === getActiveTournament().id) || adminTournaments.find(item => ["open","officialized"].includes(item.status)) || adminTournaments[0];
  if (!activeTournament) {
    clearActiveTournament();
    heroActions.innerHTML = '<a class="btn primary" href="torneos.html?nuevo=1">＋ Crear primer torneo</a>';
    content.innerHTML = `<div id="homeHcpLookup"></div><section class="card panel-onboarding"><div class="card-body"><span class="status pending">Primer paso</span><h2>Creá el primer torneo</h2><p class="lead">No necesitás preparar nada antes. Configuración crea el torneo, sus categorías y las salidas; después el sistema te lleva por cada etapa.</p><a class="btn primary" href="torneos.html?nuevo=1">Crear torneo →</a><div class="onboarding-steps"><div><b>1</b><span><strong>Configuración</strong><small>Fecha, modalidad, categorías y salidas.</small></span></div><div><b>2</b><span><strong>Inscripciones</strong><small>Jugadores, horarios y casilleros.</small></span></div><div><b>3</b><span><strong>Administración</strong><small>HCP, pagos, tarjetas y resultados.</small></span></div></div></div></section>${toolsCard()}`;
    mountHomeHcp();
    return;
  }
  setActiveTournament(activeTournament);
  const metrics = prefetchedMetrics?.tournamentId === activeTournament.id ? prefetchedMetrics.value : await getTournamentMetrics(activeTournament.id), action = nextAction(activeTournament, metrics);
  const preparation = metrics.registrations ? `${metrics.scorecards} de ${metrics.registrations}` : "Sin inscriptos";
  content.innerHTML = `${tournamentStrip(activeTournament, metrics)}<div id="homeHcpLookup"></div><section class="grid two home-main-grid"><article class="card"><div class="card-head"><div><h2>Continuar torneo</h2><div class="subtle">El sistema propone el próximo paso</div></div>${action.pending ? `<span class="status pending">${action.pending} pendientes</span>` : '<span class="status open">Al día</span>'}</div><div class="card-body"><div class="notice ${action.pending ? "warn" : "success"} home-next-notice"><strong>Próxima acción:</strong> ${escapeHtml(action.notice)}</div><div class="kpis"><div class="kpi"><strong>${metrics.registrations}</strong><span>Inscriptos</span></div><div class="kpi"><strong>${metrics.scorecards}</strong><span>Guardados</span></div><div class="kpi ${action.pending ? "gold" : ""}"><strong>${action.pending}</strong><span>Para revisar</span></div><div class="kpi"><strong>${action.progress}%</strong><span>Avance</span></div></div><div class="progress-copy"><strong>Preparación del torneo</strong><span class="subtle">${preparation}</span></div><div class="progress"><span style="width:${action.progress}%"></span></div><div class="panel-next-actions"><a class="btn primary" href="${action.href}">${escapeHtml(action.label)}</a><a class="btn secondary" href="${tournamentUrl(stages[1], activeTournament.id)}">Ver inscripciones</a></div></div></article>${toolsCard()}</section>`;
  if (String(activeTournament.notes || "").startsWith("VMGC_FREE_SCORECARD_V2:")) {
    content.querySelectorAll('a[href^="torneos.html"], a[href^="inscripciones.html"], a[href^="oficializacion.html"]').forEach(link => {
      const disabled = document.createElement("span"); disabled.className = link.className + " disabled"; disabled.setAttribute("aria-disabled","true"); disabled.title = "Esta opción no corresponde a Tarjeta Libre"; disabled.style.opacity = "0.5"; disabled.innerHTML = link.innerHTML; link.replaceWith(disabled);
    });
  }
  heroActions.innerHTML = `<button class="btn outline" id="changeTournamentButton">Cambiar torneo</button><a class="btn primary" href="torneos.html?nuevo=1">＋ Crear torneo</a>`;
  mountTournamentDrawer();
  mountHomeHcp();
}

try {
  const displayNamePromise = getUserDisplayName(context.user);
  const tournamentsPromise = context.profile.role === "admin" ? listOperationalTournaments({ limit:500 }) : listPublishedOpenTournaments();
  const storedTournamentId = getActiveTournament().id;
  const metricsPromise = context.profile.role === "admin" && storedTournamentId ? getTournamentMetrics(storedTournamentId).then(value => ({ tournamentId:storedTournamentId, value })).catch(() => null) : Promise.resolve(null);
  const [displayName, tournaments, prefetchedMetrics] = await Promise.all([displayNamePromise, tournamentsPromise, metricsPromise]);
  title.textContent = `${greeting()}${displayName ? `, ${displayName}` : ""}`;
  subtitle.textContent = context.profile.role === "admin" ? "Todo lo importante del club, ordenado por lo que necesita atención hoy." : "Elegí un torneo disponible para inscribirte.";
  role.textContent = context.profile.role === "admin" ? "Inicio operativo" : "Inicio de jugador";
  if (context.profile.role === "admin") { adminTournaments = tournaments; await renderAdmin(prefetchedMetrics); } else { content.innerHTML = `<div id="homeHcpLookup"></div><section class="grid two"><article class="card"><div class="card-head"><h2>Torneos disponibles</h2></div><div class="card-body action-list">${tournaments.map(item => `<a class="action" href="inscripciones.html?torneo_id=${encodeURIComponent(item.id)}"><span class="action-icon">⛳</span><span class="action-copy"><strong>${escapeHtml(item.name)}</strong><span>${formatDate(item.tournament_date)} · ${escapeHtml(item.game_modes?.name || "")}</span></span><span class="chev">›</span></a>`).join("") || '<div class="notice warn">No hay torneos habilitados para inscripción.</div>'}</div></article><aside class="card"><div class="card-head"><h2>Accesos</h2></div><div class="card-body action-list"><a class="action" href="resultados.html"><span class="action-icon">★</span><span class="action-copy"><strong>Resultados</strong><span>Consultar torneos jugados</span></span><span class="chev">›</span></a></div></aside></section>`; mountHomeHcp(); }
} catch (error) { console.error(error); content.innerHTML = `<div class="notice warn">No se pudo cargar Inicio: ${escapeHtml(error.message)}</div>`; }
