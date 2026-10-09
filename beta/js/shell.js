import { mountPublicResults } from "./public_results_page.js";
import { PAGES, ACTIVE_TOURNAMENT_ID_KEY, ACTIVE_TOURNAMENT_NAME_KEY } from "./config.js";
import { signOut } from "./auth.js";
import { supabase } from "./supabase.js";
import { confirmAction, escapeHtml, formatDate, notify } from "./ui.js";
import { executeAagSync, getAagSyncStatus, linkManualPlayer, listAagSyncReports, prepareAagSync } from "./aag_sync_service.js";
import { listCurrentAagExports, refreshAllAagStatuses, syncAagFields } from "./aag_exports_service.js";
import { loadTournamentStatistics } from "./statistics_service.js";
import { statisticsContent, printStatisticsReport } from "./statistics_report.js";

const stages = [
  { page: PAGES.tournaments, label: "Configuración", param: "torneo_id" },
  { page: PAGES.registrations, label: "Inscripciones", param: "torneo_id" },
  { page: PAGES.officialization, label: "Adm. torneo", param: "torneo" },
  { page: PAGES.scorecards, label: "Tarjetas", param: "torneo" },
  { page: PAGES.results, label: "Resultados", param: "torneo" }
];

const settingsItems = [
  { id: "notifications", icon: "♧", label: "Avisos a jugadores", description: "Preparar notificaciones con texto y flyer" },
  { id: "aag", icon: "↻", label: "Sincro. AAG", description: "Actualizar índices y datos oficiales" },
  { id: "free-card", icon: "▦", label: "Tarjeta Libre", description: "Cargar una tarjeta sin torneo programado" },
  { id: "public-results", icon: "★", label: "Resultados Públicos", description: "Publicación y consulta de clasificaciones" },
  { id: "statistics", icon: "▥", label: "Estadísticas", description: "Indicadores históricos y deportivos del club" },
  { id: "tv-control", icon: "▶", label: "Control TV", description: "Elegir el contenido de las pantallas" },
  { id: "tv-media", icon: "▣", label: "TV Multimedia", description: "Administrar fotos, logo, QR, sponsors y música" },
  { id: "reports", icon: "≡", label: "Informes", description: "Acceder a informes administrativos" }
];

const prefetchedPages = new Set();
let navigationInProgress = false;

function internalPageUrl(anchor) {
  if (!anchor?.href || anchor.target || anchor.hasAttribute("download")) return null;
  const url = new URL(anchor.href, location.href);
  if (url.origin !== location.origin || url.pathname === location.pathname && url.search === location.search || url.hash && url.pathname === location.pathname && url.search === location.search) return null;
  return url;
}

function enableSmoothNavigation() {
  if (document.documentElement.dataset.smoothNavigation === "1") return;
  document.documentElement.dataset.smoothNavigation = "1";
  document.addEventListener("pointerover", event => {
    const url = internalPageUrl(event.target.closest?.("a"));
    if (!url) return;
    const key = `${url.pathname}${url.search}`;
    if (prefetchedPages.has(key)) return;
    prefetchedPages.add(key);
    const link = document.createElement("link");
    link.rel = "prefetch";
    link.href = url.href;
    document.head.appendChild(link);
  }, { passive: true });
  document.addEventListener("click", event => {
    if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    const url = internalPageUrl(event.target.closest?.("a"));
    if (!url || navigationInProgress) return;
    event.preventDefault();
    navigationInProgress = true;
    document.body.classList.add("vmgc-leaving");
    window.setTimeout(() => location.assign(url.href), 220);
  });
}

export function getActiveTournament() {
  return { id: localStorage.getItem(ACTIVE_TOURNAMENT_ID_KEY) || "", name: localStorage.getItem(ACTIVE_TOURNAMENT_NAME_KEY) || "" };
}

export function setActiveTournament(tournament) {
  if (!tournament?.id) return;
  localStorage.setItem(ACTIVE_TOURNAMENT_ID_KEY, tournament.id);
  localStorage.setItem(ACTIVE_TOURNAMENT_NAME_KEY, tournament.name || "Torneo seleccionado");
  document.dispatchEvent(new CustomEvent("vmgc:tournament-changed", { detail: tournament }));
}

export function clearActiveTournament() {
  localStorage.removeItem(ACTIVE_TOURNAMENT_ID_KEY);
  localStorage.removeItem(ACTIVE_TOURNAMENT_NAME_KEY);
}

export function tournamentUrl(stage, id = getActiveTournament().id) {
  return stage.page + (id ? `?${stage.param}=${encodeURIComponent(id)}` : "");
}

export function renderStageNavigation(container, activeStep = -1, tournamentId = getActiveTournament().id) {
  if (!container) return;
  container.className = "stage-content-shell";
  container.innerHTML = `<nav class="steps stage-content-steps" aria-label="Etapas del torneo">${stages.map((stage, index) => {
    if ((!tournamentId && index > 0) || (tournamentId && index > 1)) return `<span class="step disabled ${index===activeStep?"active":""}" data-stage-index="${index}" aria-disabled="true"><span class="num">${index + 1}</span>${stage.label}</span>`;
    const href = !tournamentId && index === 0 ? `${PAGES.tournaments}?nuevo=1` : tournamentUrl(stage, tournamentId);
    return `<a class="step ${index === activeStep ? "active" : ""}" data-stage-index="${index}" href="${href}"><span class="num">${index + 1}</span>${stage.label}</a>`;
  }).join("")}</nav>`;
  if(tournamentId)hydrateStageNavigation(container,activeStep,tournamentId);
}

async function stageAccess(tournamentId){
  const count=async(table,configure)=>{let query=supabase.from(table).select("id",{count:"exact",head:true}).eq("tournament_id",tournamentId);if(configure)query=configure(query);const{count,error}=await query;if(error)throw error;return count||0};
  const[registrations,scorecards,loaded]=await Promise.all([count("registrations",query=>query.or("registration_status.is.null,registration_status.neq.cancelled")),count("scorecards"),count("scorecards",query=>query.in("card_status",["valid","desc"]))]);
  return{registrations,scorecards,loaded};
}
async function hydrateStageNavigation(container,activeStep,tournamentId){
  try{const access=await stageAccess(tournamentId),highest=access.loaded>0?4:access.scorecards>0?3:access.registrations>0?2:1,nav=container.querySelector("nav");if(!nav||!container.isConnected)return;nav.innerHTML=stages.map((stage,index)=>{const enabled=index<=highest,active=index===activeStep,inner=`<span class="num">${index+1}</span>${stage.label}`;return enabled?`<a class="step ${active?"active":""}" data-stage-index="${index}" href="${tournamentUrl(stage,tournamentId)}">${inner}</a>`:`<span class="step disabled ${active?"active":""}" data-stage-index="${index}" aria-disabled="true" title="Completá el paso anterior para continuar">${inner}</span>`}).join("")}catch(error){console.warn("No se pudo calcular el avance del torneo",error)}
}

function statusLabel(status) {
  return ({ open: "Inscripciones abiertas", closed: "Inscripciones cerradas", officialized: "Guardado", archived: "Archivado" })[status] || status || "Borrador";
}

function statusClass(status) {
  return status === "open" ? "open" : status === "closed" ? "pending" : status === "archived" ? "muted" : "info";
}

let tournamentListPromise = null;

async function getTournamentSummary(id) {
  if (!id) return null;
  const { data, error } = await supabase
    .from("tournaments")
    .select("id,name,tournament_date,status,hole_count,start_type,notes,game_modes(name)")
    .eq("data_schema_version", 2)
    .eq("id", id)
    .maybeSingle();
  if (error) throw error;
  return data || null;
}

async function listTournaments() {
  if (!tournamentListPromise) {
    tournamentListPromise = (async () => {
      const pageSize = 500;
      const rows = [];
      for (let from = 0; ; from += pageSize) {
        const { data, error } = await supabase
          .from("tournaments")
          .select("id,name,tournament_date,status,hole_count,start_type,notes,game_modes(name)")
          .eq("data_schema_version", 2)
          .order("tournament_date", { ascending: false })
          .order("id", { ascending: false })
          .range(from, from + pageSize - 1);
        if (error) throw error;
        rows.push(...(data || []));
        if ((data || []).length < pageSize) break;
      }
      return rows;
    })();
  }
  try {
    return await tournamentListPromise;
  } catch (error) {
    tournamentListPromise = null;
    throw error;
  }
}

function normalizedGender(value) {
  const gender = String(value || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").trim().toLowerCase();
  if (["f", "female", "femenino", "dama", "damas", "mujer"].includes(gender)) return "female";
  if (["m", "male", "masculino", "caballero", "caballeros", "hombre"].includes(gender)) return "male";
  return "";
}

async function tournamentAudience(tournamentId) {
  const { data, error } = await supabase
    .from("registrations")
    .select("id,club_name,player:players!registrations_linked_player_id_fkey(gender,option_club_id,is_club_member,club_name)")
    .eq("tournament_id", tournamentId)
    .or("registration_status.is.null,registration_status.neq.cancelled");
  if (error) throw error;
  const rows = data || [];
  const isMember = registration => {
    const club = String(registration.club_name || registration.player?.club_name || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
    return Number(registration.player?.option_club_id) === 408 || registration.player?.is_club_member === true || club.includes("villa maria");
  };
  return rows.reduce((metrics, registration) => {
    const gender = normalizedGender(registration.player?.gender);
    metrics.total += 1;
    if (gender === "female") metrics.women += 1;
    if (gender === "male") metrics.men += 1;
    if (isMember(registration)) metrics.members += 1;
    else metrics.guests += 1;
    return metrics;
  }, { total: 0, women: 0, men: 0, members: 0, guests: 0 });
}

function pickerRows(tournaments, query = "", date = "") {
  const words = String(query).trim().toLocaleLowerCase("es").split(/\s+/).filter(Boolean);
  const rows = tournaments.filter(t => (!date || t.tournament_date === date) && words.every(word => `${t.name} ${t.tournament_date} ${statusLabel(t.status)}`.toLocaleLowerCase("es").includes(word)));
  return rows.length ? rows.map(t => `<button type="button" class="tournament-picker-row" data-pick-tournament="${t.id}"><span><strong>${escapeHtml(t.name)}</strong><small>${formatDate(t.tournament_date)} · ${escapeHtml(t.game_modes?.name || "")}</small></span><span class="status ${statusClass(t.status)}">${escapeHtml(statusLabel(t.status))}</span></button>`).join("") : '<div class="empty-state compact">No hay torneos que coincidan.</div>';
}

async function hydrateTournamentHeader(host, activeStep) {
  const bar = host.querySelector("[data-active-tournament-bar]");
  if (!bar) return;
  try {
    const stored = getActiveTournament();
    const current = await getTournamentSummary(stored.id);
    if (!current) {
      bar.innerHTML = `<div class="active-tournament-copy"><small>Torneo activo</small><strong>Sin torneo seleccionado</strong><span>Creá uno nuevo o elegí uno existente.</span></div><div class="active-tournament-actions"><a class="btn primary small" href="${PAGES.tournaments}?nuevo=1">＋ Nuevo torneo</a><button class="btn secondary small" data-change-tournament>Cambiar torneo</button></div>`;
    } else {
      const audience = await tournamentAudience(current.id);
      const action = current.status === "open" ? "Cerrar inscripciones" : current.status === "closed" ? "Abrir inscripciones" : current.status === "archived" ? "Reabrir torneo" : "";
      bar.innerHTML = `<div class="active-tournament-copy"><small><span class="status ${statusClass(current.status)}">${escapeHtml(statusLabel(current.status))}</span></small><strong>${escapeHtml(current.name)}</strong><span>${formatDate(current.tournament_date)} · ${escapeHtml(current.game_modes?.name || "")} · ${Number(current.hole_count) || 18} hoyos</span></div><div class="active-tournament-audience" aria-label="Resumen de inscriptos"><div><strong>${audience.total}</strong><span>Inscriptos</span></div><div><strong>${audience.women}</strong><span>Damas</span></div><div><strong>${audience.men}</strong><span>Caballeros</span></div><div><strong>${audience.members}</strong><span>Socios VMGC</span></div><div><strong>${audience.guests}</strong><span>Invitados</span></div></div><div class="active-tournament-actions">${action ? `<button class="btn ${current.status === "closed" ? "gold" : "secondary"} small" data-toggle-tournament>${action}</button>` : ""}<button class="btn secondary small" data-change-tournament>Cambiar torneo</button></div>`;
      bar.querySelector("[data-toggle-tournament]")?.addEventListener("click", async () => {
        const next = current.status === "open" ? "closed" : "open";
        const verb = next === "open" ? "abrir" : "cerrar";
        if (!await confirmAction({ title: `${next === "open" ? "Abrir" : "Cerrar"} inscripciones`, message: `¿Querés ${verb} las inscripciones de “${current.name}”?`, confirmText: next === "open" ? "Abrir" : "Cerrar" })) return;
        const { error } = await supabase.from("tournaments").update({ status: next }).eq("id", current.id);
        if (error) return notify(error.message, "error");
        location.reload();
      });
    }
    bar.querySelector("[data-change-tournament]")?.addEventListener("click", async () => {
      const drawer = document.createElement("div");
      drawer.className = "drawer open";
      drawer.setAttribute("aria-hidden", "false");
      drawer.innerHTML = `<section class="drawer-panel tournament-picker"><div class="drawer-head"><div><div class="eyebrow">Cambiar torneo</div><h2>Elegí el torneo activo</h2></div><button class="btn secondary small" data-close-picker>✕</button></div><div class="tournament-picker-filters"><div class="field"><label>Buscar por nombre o estado</label><input class="control" data-picker-search placeholder="Nombre del torneo" disabled></div><div class="field date"><label>Fecha</label><input class="control" type="date" data-picker-date aria-label="Buscar torneo por fecha" disabled></div></div><div class="tournament-picker-list" data-picker-list><div class="empty-state compact">Cargando historial completo…</div></div></section>`;
      document.body.appendChild(drawer);
      const close = () => drawer.remove();
      drawer.querySelector("[data-close-picker]").addEventListener("click", close);
      drawer.addEventListener("click", event => { if (event.target === drawer) close(); });
      let tournaments;
      try {
        tournaments = await listTournaments();
      } catch (error) {
        drawer.querySelector("[data-picker-list]").innerHTML = `<div class="notice error">No se pudo cargar el historial: ${escapeHtml(error.message)}</div>`;
        return;
      }
      if (!drawer.isConnected) return;
      drawer.querySelector("[data-picker-search]").disabled = false;
      drawer.querySelector("[data-picker-date]").disabled = false;
      drawer.querySelector("[data-picker-list]").innerHTML = pickerRows(tournaments);
      const refreshPicker = () => { drawer.querySelector("[data-picker-list]").innerHTML = pickerRows(tournaments, drawer.querySelector("[data-picker-search]").value, drawer.querySelector("[data-picker-date]").value); };
      drawer.querySelector("[data-picker-search]").addEventListener("input", refreshPicker);
      drawer.querySelector("[data-picker-date]").addEventListener("input", refreshPicker);
      drawer.querySelector("[data-picker-list]").addEventListener("click", event => {
        const button = event.target.closest("[data-pick-tournament]");
        if (!button) return;
        const picked = tournaments.find(t => t.id === button.dataset.pickTournament);
        if (!picked) return;
        setActiveTournament(picked);
        const stage = stages[Math.max(0, activeStep)] || stages[0];
        location.href = tournamentUrl(stage, picked.id);
      });
      drawer.querySelector("[data-picker-search]").focus();
    });
  } catch (error) {
    bar.innerHTML = `<div class="notice error">No se pudo leer el torneo activo: ${escapeHtml(error.message)}</div>`;
  }
}

function settingsDetail(item) {
  const notes = {
    aag: "Estado de los torneos enviados a AAG, actualización de índices y sincronización de campos y salidas.",
    "free-card": "Acá se abrirá la carga completa de una tarjeta presentada fuera de un torneo programado.",
    "public-results": "Consultá los torneos publicados y sus clasificaciones oficiales.",
    statistics: "Compará la dificultad de cada hoyo entre uno o varios torneos y filtrá por rango de índice.",
    "tv-control": "Acá se elegirán torneo, vista, rotación y contenido de la pantalla de TV.",
    "tv-media": "Acá se administrarán fotos, logo, QR, música y patrocinadores de TV.",
    reports: "Informes imprimibles de torneos y del historial de actualización de índices."
  };
  const live = item.id === "reports" ? "reports-content" : item.id === "aag" ? "aag-settings" : item.id === "statistics" ? "statistics-settings" : item.id === "public-results" ? "public-results" : "";
  const content = live ? `<div class="settings-live-content" data-${live}><div class="empty-state compact">Cargando información…</div></div>` : '<div class="settings-placeholder"><strong>Espacio preparado</strong><p>La función se incorporará acá sin mezclarla con el recorrido normal de un torneo.</p></div>';
  return `<div class="settings-detail-head"><span class="settings-detail-icon">${item.icon}</span><div class="settings-tool-title"><div class="eyebrow">Herramienta</div><h2>${escapeHtml(item.label)}</h2></div><button type="button" class="settings-tool-close" data-settings-detail-close aria-label="Cerrar ${escapeHtml(item.label)}"><span aria-hidden="true">×</span> Cerrar</button></div><div class="notice info">${escapeHtml(notes[item.id])}</div>${content}`;
}

const dateTime = value => value ? new Intl.DateTimeFormat("es-AR", { dateStyle:"medium", timeStyle:"short", timeZone:"America/Argentina/Cordoba" }).format(new Date(value)) : "Sin registro";
const indexText = value => Number.isFinite(Number(value)) ? Number(value).toFixed(1) : "—";
const localDateKey = value => {
  const parts = new Intl.DateTimeFormat("en", { timeZone:"America/Argentina/Cordoba", year:"numeric", month:"2-digit", day:"2-digit" }).formatToParts(new Date(value));
  const get = type => parts.find(part => part.type === type)?.value || "";
  return `${get("year")}-${get("month")}-${get("day")}`;
};


async function hydrateReportsPanel(detail) {
  const host = detail.querySelector("[data-reports-content]");
  if (!host) return;
  try {
    const [reports, tournaments] = await Promise.all([listAagSyncReports(200), listTournaments()]);
    const reportIcon = type => type === "payments" ? "●" : type === "results" ? "★" : "↻";
    const reportTitle = type => type === "payments" ? "Informe de pagos" : type === "results" ? "Informe de resultados" : "Actualización de Index";
    const renderHome = () => {
      host.innerHTML = `<div class="report-type-grid"><button type="button" data-report-type="payments"><span>●</span><strong>Informe de pagos</strong><small>Detalle de caja de un torneo seleccionado.</small></button><button type="button" data-report-type="results"><span>★</span><strong>Informe de resultados</strong><small>Resultados y estadísticas por categoría.</small></button><button type="button" data-report-type="index"><span>↻</span><strong>Actualización de Index</strong><small>Altas, bajas y cambios recibidos desde AAG.</small></button></div>`;
      host.querySelectorAll("[data-report-type]").forEach(button => button.addEventListener("click", () => renderBrowser(button.dataset.reportType)));
    };
    const tournamentRows = (type, query, date) => {
      const words = String(query || "").toLocaleLowerCase("es").split(/\s+/).filter(Boolean);
      const rows = tournaments.filter(item => (!date || item.tournament_date === date) && words.every(word => String(item.name || "").toLocaleLowerCase("es").includes(word)));
      if (!rows.length) return '<div class="empty-state compact">No hay torneos que coincidan con la búsqueda.</div>';
      return rows.map(item => `<button type="button" class="unified-report-row" data-open-report="${item.id}"><span class="unified-report-icon">${reportIcon(type)}</span><span><strong>${escapeHtml(item.name)}</strong><small>${formatDate(item.tournament_date)} · ${escapeHtml(item.game_modes?.name || "Torneo")} · ${escapeHtml(statusLabel(item.status))}</small></span><b>Abrir A4 ↗</b></button>`).join("");
    };
    const indexRows = date => {
      const rows = reports.filter(report => !date || localDateKey(report.created_at) === date);
      if (!rows.length) return '<div class="empty-state compact">No hay actualizaciones en esa fecha.</div>';
      return rows.map(report => `<button type="button" class="unified-report-row" data-open-index-report="${report.id}"><span class="unified-report-icon">↻</span><span><strong>${dateTime(report.created_at)}</strong><small>${report.before_vmgc ?? "—"} → ${report.after_vmgc ?? "—"} socios VMGC</small></span><span class="aag-report-counts"><b>+${report.added_count}</b><b>↕${report.updated_count}</b><b>−${report.deactivated_count}</b></span></button>`).join("");
    };
    const renderBrowser = type => {
      const index = type === "index";
      host.innerHTML = `<button class="btn secondary small" data-report-home>← Informes</button><div class="unified-report-head"><span class="settings-detail-icon">${reportIcon(type)}</span><div><div class="eyebrow">Archivo de informes</div><h3>${reportTitle(type)}</h3></div></div><div class="unified-report-filters">${index ? "" : '<div class="field"><label>Buscar torneo</label><input class="control" data-report-search placeholder="Nombre del torneo"></div>'}<div class="field"><label>Fecha</label><input class="control" type="date" data-report-date></div></div><div class="unified-report-list" data-unified-report-list></div>`;
      host.querySelector("[data-report-home]").addEventListener("click", renderHome);
      const list = host.querySelector("[data-unified-report-list]"), search = host.querySelector("[data-report-search]"), date = host.querySelector("[data-report-date]");
      const refresh = () => { list.innerHTML = index ? indexRows(date.value) : tournamentRows(type, search?.value, date.value); };
      search?.addEventListener("input", refresh); date.addEventListener("input", refresh); refresh();
      list.addEventListener("click", event => {
        const tournamentButton = event.target.closest("[data-open-report]");
        const indexButton = event.target.closest("[data-open-index-report]");
        if (tournamentButton) {
          const kind = type === "payments" ? "pagos" : "resultados";
          window.open(`report_view.html?tipo=${kind}&torneo=${encodeURIComponent(tournamentButton.dataset.openReport)}`, "_blank", "noopener");
        }
        if (indexButton) window.open(`report_view.html?tipo=index&id=${encodeURIComponent(indexButton.dataset.openIndexReport)}`, "_blank", "noopener");
      });
    };
    renderHome();
  } catch (error) { host.innerHTML = `<div class="notice warn">${escapeHtml(error.message)}</div>`; }
}

async function hydrateAagSettings(detail) {
  const host = detail.querySelector("[data-aag-settings]");
  if (!host) return;
  try {
    const [statusResult, exportsResult] = await Promise.allSettled([getAagSyncStatus(), listCurrentAagExports()]);
    const status = statusResult.status === "fulfilled" ? statusResult.value : { current: false, lastCompletedAt: null, sourceUpdatedAt: null };
    if (exportsResult.status === "rejected") throw exportsResult.reason;
    const exports = exportsResult.value;
    const grouped = new Map();
    exports.forEach(item => {
      const key = item.tournament_id || item.title;
      if (!grouped.has(key)) grouped.set(key, { tournament: item.tournament, title: item.tournament?.name || item.title || "Torneo AAG", date: item.tournament?.tournament_date || item.start_date, exports: [] });
      grouped.get(key).exports.push(item);
    });
    const tournamentRows = [...grouped.values()];
    const processed = tournamentRows.filter(group => group.exports.every(item => String(item.aag_remote_status || "").toLowerCase() === "procesado")).length;
    const open = tournamentRows.filter(group => group.exports.some(item => String(item.aag_remote_status || "").toLowerCase() === "abierto")).length;
    const errors = exports.filter(item => item.aag_last_sync_ok === false || Number(item.aag_error_scorecards || 0) > 0).length;
    const statusBadge = value => {
      const normalized = String(value || "Sin consultar").toLowerCase();
      const cls = normalized === "procesado" ? "open" : normalized === "abierto" ? "info" : normalized.includes("error") ? "danger" : "pending";
      return `<span class="status ${cls}">${escapeHtml(value || "Sin consultar")}</span>`;
    };
    const exportAlerts = item => {
      if (!item.aag_error) return [];
      let value = item.aag_error;
      if (typeof value === "string") {
        try { value = JSON.parse(value); }
        catch { return [{ message: value }]; }
      }
      const rows = Array.isArray(value) ? value : [value];
      return rows.map(row => {
        if (typeof row === "string") return { message: row };
        const enrollment = String(row?.Value || "").match(/EnrollmentNumber\s*=\s*([^\s,;]+)/i)?.[1] || "";
        return { enrollment, message: row?.ErrorMessage || row?.Message || row?.message || row?.ErrorCode || "Error informado por AAG" };
      });
    };
    const renderRows = query => {
      const words = String(query || "").toLocaleLowerCase("es").split(/\s+/).filter(Boolean);
      const rows = tournamentRows.filter(group => words.every(word => `${group.title} ${group.date || ""}`.toLocaleLowerCase("es").includes(word)));
      if (!rows.length) return '<div class="empty-state compact">No hay exportaciones que coincidan.</div>';
      return rows.map((group, index) => {
        const allProcessed = group.exports.every(item => String(item.aag_remote_status || "").toLowerCase() === "procesado");
        const anyOpen = group.exports.some(item => String(item.aag_remote_status || "").toLowerCase() === "abierto");
        const groupStatus = allProcessed ? "Procesado" : anyOpen ? "Abierto" : group.exports[0]?.aag_remote_status || "Sin consultar";
        const lastCheck = group.exports.map(item => item.aag_last_check_at).filter(Boolean).sort().at(-1);
        return `<details class="aag-export-group" ${index < 2 ? "open" : ""}><summary><span><strong>${escapeHtml(group.title)}</strong><small>${formatDate(group.date)} · ${group.exports.length} ${group.exports.length === 1 ? "categoría/salida" : "categorías/salidas"} · Revisado ${dateTime(lastCheck)}</small></span>${statusBadge(groupStatus)}<b>⌄</b></summary><div class="aag-export-detail">${group.exports.map(item => { const alerts = exportAlerts(item); return `<article class="${alerts.length || Number(item.aag_error_scorecards || 0) ? "has-alert" : ""}"><div><strong>${escapeHtml(item.tee_name || item.gender || "Salida AAG")}</strong><small>ID AAG ${escapeHtml(item.aag_tournament_id || "—")} · Campo ${escapeHtml(item.aag_field_id ?? "—")} · TeeOut ${escapeHtml(item.aag_teeout_id ?? "—")}</small></div>${statusBadge(item.aag_remote_status)}<dl><div><dt>Enviadas</dt><dd>${item.aag_total_scorecards ?? "—"}</dd></div><div><dt>Aceptadas</dt><dd>${item.aag_valid_scorecards ?? item.aag_added_scorecards ?? "—"}</dd></div><div><dt>Con error</dt><dd>${item.aag_error_scorecards ?? "—"}</dd></div></dl>${alerts.length ? `<div class="aag-export-alert"><strong>Detalle de la alerta</strong><ul>${alerts.map(alert => `<li>${alert.enrollment ? `<b>Matrícula ${escapeHtml(alert.enrollment)}:</b> ` : ""}${escapeHtml(alert.message)}</li>`).join("")}</ul></div>` : ""}</article>`; }).join("")}</div></details>`;
      }).join("");
    };
    host.innerHTML = `<div class="aag-settings-status ${status.current ? "current" : "pending"}"><span class="aag-state-dot"></span><div><strong>${status.current ? "Índices actualizados" : "Actualización de índices pendiente"}</strong><small>Última sincronización VMGC: ${dateTime(status.lastCompletedAt)}</small><small>Último padrón recibido de AAG: ${dateTime(status.sourceUpdatedAt)}</small></div></div>${statusResult.status === "rejected" ? '<div class="notice warn compact">No se pudo consultar el estado de índices. La información de exportaciones sigue disponible.</div>' : ''}<div class="aag-tool-actions"><button class="btn primary" type="button" data-run-aag-settings>Actualizar Index</button><button class="btn secondary" type="button" data-sync-aag-fields>Actualizar campos y salidas AAG</button><button class="btn secondary" type="button" data-refresh-aag-status>Verificar estados ahora</button></div><div class="aag-export-heading"><div><div class="eyebrow">Seguimiento AAG</div><h3>Torneos exportados</h3></div><span>${tournamentRows.length} torneos</span></div><div class="aag-export-kpis"><div><strong>${tournamentRows.length}</strong><span>Torneos exportados</span></div><div><strong>${open}</strong><span>Abiertos en AAG</span></div><div><strong>${processed}</strong><span>Procesados</span></div><div class="${errors ? "warn" : ""}"><strong>${errors}</strong><span>Salidas con alerta</span></div></div><div class="field aag-export-search"><label>Buscar torneo exportado</label><input class="control" data-aag-export-search placeholder="Nombre del torneo"></div><div class="aag-export-list" data-aag-export-list>${renderRows("")}</div>`;
    host.querySelector("[data-run-aag-settings]").addEventListener("click", () => startAagSync(document.querySelector("[data-app-shell]")));
    host.querySelector("[data-aag-export-search]").addEventListener("input", event => { host.querySelector("[data-aag-export-list]").innerHTML = renderRows(event.target.value); });
    host.querySelector("[data-sync-aag-fields]").addEventListener("click", async event => {
      const button = event.currentTarget;
      if (!await confirmAction({ title:"Actualizar campos y salidas AAG", message:"Se reemplazará el catálogo local por la lista vigente informada por AAG. ¿Querés continuar?", confirmText:"Actualizar catálogo" })) return;
      try { button.disabled = true; button.textContent = "Actualizando…"; const result = await syncAagFields(); notify(`Catálogo AAG actualizado: ${result.fields ?? "—"} campos y ${result.teeouts ?? "—"} salidas.`); await hydrateAagSettings(detail); }
      catch (error) { notify(error.message, "error"); button.disabled = false; button.textContent = "Actualizar campos y salidas AAG"; }
    });
    host.querySelector("[data-refresh-aag-status]").addEventListener("click", async event => {
      const button = event.currentTarget;
      try { button.disabled = true; button.textContent = "Consultando AAG…"; const result = await refreshAllAagStatuses(); notify(`Estados revisados: ${result.checked ?? result.results?.length ?? 0}.`); await hydrateAagSettings(detail); }
      catch (error) { notify(error.message, "error"); button.disabled = false; button.textContent = "Verificar estados ahora"; }
    });
  } catch (error) { host.innerHTML = `<div class="notice warn">${escapeHtml(error.message)}</div>`; }
}

async function hydrateStatistics(detail) {
  const host = detail.querySelector("[data-statistics-settings]");
  if (!host) return;
  try {
    const tournaments = await listTournaments();
    const selected = new Set();
    const tournamentRows = query => {
      const words = String(query || "").toLocaleLowerCase("es").split(/\s+/).filter(Boolean);
      const rows = tournaments.filter(item => words.every(word => `${item.name} ${item.tournament_date}`.toLocaleLowerCase("es").includes(word)));
      return rows.length ? rows.map(item => `<label class="statistics-tournament-row"><input type="checkbox" value="${item.id}" ${selected.has(item.id) ? "checked" : ""}><span><strong>${escapeHtml(item.name)}</strong><small>${formatDate(item.tournament_date)} · ${escapeHtml(item.game_modes?.name || "Torneo")}</small></span></label>`).join("") : '<div class="empty-state compact">No hay torneos que coincidan.</div>';
    };
    host.innerHTML = `<div class="statistics-controls"><div class="field"><label>Buscar torneos</label><input class="control" data-statistics-search placeholder="Nombre del torneo"></div><div class="statistics-tournament-list" data-statistics-tournaments>${tournamentRows("")}</div><div class="statistics-filter-grid"><div class="field"><label>Index mínimo</label><input class="control" data-statistics-min type="number" step="0.1" placeholder="Sin mínimo"></div><div class="field"><label>Index máximo</label><input class="control" data-statistics-max type="number" step="0.1" placeholder="Sin máximo"></div></div><div class="statistics-run-actions"><button class="btn primary" type="button" data-statistics-run>Calcular dificultad</button><button class="btn secondary" type="button" data-statistics-print disabled>Imprimir A4</button></div></div><div data-statistics-results><div class="empty-state compact">Elegí uno o varios torneos. El ranking combinará todas las tarjetas válidas seleccionadas.</div></div>`;
    let lastReport = null, lastMeta = null;
    const printButton = host.querySelector("[data-statistics-print]");
    printButton.addEventListener("click", () => { if (lastReport) printStatisticsReport(lastReport,lastMeta); });
    const list = host.querySelector("[data-statistics-tournaments]");
    const bindChecks = () => list.querySelectorAll('input[type="checkbox"]').forEach(input => input.addEventListener("change", () => { input.checked ? selected.add(input.value) : selected.delete(input.value); }));
    bindChecks();
    host.querySelector("[data-statistics-search]").addEventListener("input", event => { list.innerHTML = tournamentRows(event.target.value); bindChecks(); });
    host.querySelector("[data-statistics-run]").addEventListener("click", async event => {
      const button = event.currentTarget, results = host.querySelector("[data-statistics-results]");
      try {
        button.disabled = true; button.textContent = "Calculando…";
        printButton.disabled = true; lastReport = null;
        const selectedIds = [...selected];
        const reportMeta = { tournaments:tournaments.filter(item => selectedIds.includes(item.id)), indexMin:host.querySelector("[data-statistics-min]").value, indexMax:host.querySelector("[data-statistics-max]").value };
        const report = await loadTournamentStatistics(selectedIds,reportMeta);
        lastReport = report;
        lastMeta = reportMeta;
        results.innerHTML = statisticsContent(report,lastMeta);
        printButton.disabled = false;
      } catch (error) { results.innerHTML = `<div class="notice warn">${escapeHtml(error.message)}</div>`; }
      finally { button.disabled = false; button.textContent = "Calcular dificultad"; }
    });
  } catch (error) { host.innerHTML = `<div class="notice warn">${escapeHtml(error.message)}</div>`; }
}

function openSettings(initialItem = "") {
  document.getElementById("systemSettingsDrawer")?.remove();
  const drawer = document.createElement("div");
  drawer.id = "systemSettingsDrawer";
  drawer.className = "drawer open settings-drawer";
  drawer.setAttribute("aria-hidden", "false");
  drawer.innerHTML = `<section class="settings-detail-panel" data-settings-detail aria-hidden="true"></section><section class="drawer-panel settings-main-panel"><div class="drawer-head"><div><div class="eyebrow">Inicio</div><h2>Configuración y herramientas</h2><p class="subtle">Funciones independientes de la gestión de un torneo.</p></div><button class="btn secondary small" data-settings-close>✕</button></div><div class="settings-menu">${settingsItems.map(item => `<button type="button" class="settings-menu-item" data-settings-item="${item.id}"><span class="settings-menu-icon">${item.icon}</span><span><strong>${escapeHtml(item.label)}</strong><small>${escapeHtml(item.description)}</small></span><span class="chev">›</span></button>`).join("")}</div></section>`;
  document.body.appendChild(drawer);
  const detail = drawer.querySelector("[data-settings-detail]");
  let activeItem = "";
  const onToolMessage = event => {
    const frame = detail.querySelector("iframe.settings-tool-frame");
    if (event.origin === location.origin && frame && event.source === frame.contentWindow && event.data?.type === "vmgc:close-tool") hideDetail();
  };
  window.addEventListener("message",onToolMessage);
  const close = () => { window.removeEventListener("message",onToolMessage); drawer.remove(); };
  const hideDetail = () => {
    activeItem = "";
    detail.innerHTML = "";
    detail.classList.remove("open","settings-detail-wide");
    detail.setAttribute("aria-hidden", "true");
    drawer.querySelectorAll("[data-settings-item]").forEach(button => button.classList.remove("active"));
  };
  const showDetail = id => {
    if (activeItem === id && detail.classList.contains("open")) return hideDetail();
    const item = settingsItems.find(entry => entry.id === id);
    if (!item) return;
    activeItem = id;
    drawer.querySelectorAll("[data-settings-item]").forEach(button => button.classList.toggle("active", button.dataset.settingsItem === id));
    const toolPages = { "free-card":PAGES.freeCard, "tv-control":PAGES.tvControl, "tv-media":PAGES.tvMedia, notifications:"notificaciones.html",  };
    const toolPage = toolPages[id];
    detail.classList.toggle("settings-detail-wide", !!toolPage || id === "statistics" || id === "public-results");
    detail.innerHTML = toolPage
      ? '<div class="settings-detail-head"></div><iframe class="settings-tool-frame" title="' + escapeHtml(item.label) + '" src="' + toolPage + '?embedded=1"></iframe>'
      : settingsDetail(item);
    if (toolPage || id === "statistics" || id === "public-results") {
      detail.querySelector(".settings-detail-head").outerHTML = '<header class="settings-detail-head unified-tool-header"><div class="unified-tool-brand"><img src="escudo.png" alt="Escudo VMGC"><div><small>Villa María Golf Club</small><h2>' + escapeHtml(item.label) + '</h2></div></div><button type="button" class="settings-tool-close" data-settings-detail-close aria-label="Cerrar ' + escapeHtml(item.label) + '"><span aria-hidden="true">×</span> Cerrar</button></header>';
    }
    detail.classList.add("open");
    detail.setAttribute("aria-hidden", "false");
    detail.querySelector("[data-settings-detail-close]").addEventListener("click", hideDetail);
    if (id === "reports") hydrateReportsPanel(detail);
    if (id === "aag") hydrateAagSettings(detail);
    if (id === "statistics") hydrateStatistics(detail);
    if (id === "public-results") mountPublicResults(detail.querySelector("[data-public-results]"));
  };
  drawer.querySelector("[data-settings-close]").addEventListener("click", close);
  drawer.addEventListener("click", event => { if (event.target === drawer) close(); });
  drawer.querySelectorAll("[data-settings-item]").forEach(button => button.addEventListener("click", () => showDetail(button.dataset.settingsItem)));
  if (initialItem) showDetail(initialItem);
}

async function hydrateAagStatus(host) {
  const button = host.querySelector("[data-aag-status]");
  if (!button) return;
  try {
    const status = await getAagSyncStatus();
    button.classList.toggle("current", status.current);
    button.classList.toggle("pending", !status.current);
    button.title = status.current ? `Índices AAG actualizados: ${dateTime(status.lastCompletedAt)}` : "Índices AAG pendientes de actualización semanal";
  } catch (error) {
    button.classList.add("pending");
    button.title = "No se pudo verificar la última sincronización AAG";
  }
}

function syncSummary(changes) {
  return `<div class="aag-sync-success"><span class="status open">Sincronización correcta</span><h2>Actualización finalizada</h2><div class="aag-report-kpis"><div><strong>${changes.added.length}</strong><span>Altas</span></div><div><strong>${changes.updated.length}</strong><span>Cambios de index</span></div><div><strong>${changes.deactivated.length}</strong><span>Bajas</span></div></div><p>El informe quedó guardado y ya está disponible en <b>Configuración → Informes</b>.</p></div>`;
}

function openSyncProgress() {
  document.getElementById("aagSyncDialog")?.remove();
  const dialog = document.createElement("div");
  dialog.id = "aagSyncDialog";
  dialog.className = "drawer open aag-sync-dialog";
  dialog.innerHTML = `<section class="drawer-panel aag-sync-panel"><div class="drawer-head"><div><div class="eyebrow">Sincronización oficial</div><h2>Actualizar Index</h2></div><button class="btn secondary small" data-sync-close disabled>✕</button></div><div data-sync-content><div class="aag-sync-working"><span class="sync-spinner"></span><strong>Preparando sincronización…</strong></div></div></section>`;
  document.body.appendChild(dialog);
  const content = dialog.querySelector("[data-sync-content]"), closeButton = dialog.querySelector("[data-sync-close]");
  closeButton.addEventListener("click", () => dialog.remove());
  return { dialog, content, closeButton, progress(message) { content.innerHTML = `<div class="aag-sync-working"><span class="sync-spinner"></span><strong>${escapeHtml(message)}</strong><small>No cierres esta ventana.</small></div>`; } };
}

async function startAagSync(shellHost) {
  try {
    const status = await getAagSyncStatus();
    const sourceDate = status.sourceUpdatedAt || status.lastCompletedAt;
    const accepted = await confirmAction({ title:"Actualizar índices AAG", message:`Se sincronizarán los jugadores de VMGC con la última actualización disponible de AAG: ${dateTime(sourceDate)}. ¿Querés continuar?`, confirmText:"Actualizar Index" });
    if (!accepted) return;
    document.getElementById("systemSettingsDrawer")?.remove();
    const ui = openSyncProgress();
    const prepared = await prepareAagSync(message => ui.progress(message));
    const finish = async () => {
      const { changes } = await executeAagSync(message => ui.progress(message));
      ui.content.innerHTML = syncSummary(changes);
      ui.closeButton.disabled = false;
      await hydrateAagStatus(shellHost);
    };
    const resolveNext = async () => {
      if (!prepared.pending.length) return finish();
      const item = prepared.pending[0];
      ui.content.innerHTML = `<div class="notice warn"><strong>Posible jugador duplicado</strong><br>Antes de sincronizar, revisá si el nuevo jugador AAG ya existe como jugador manual.</div><div class="aag-association"><div><span>Nuevo dato AAG</span><strong>${escapeHtml(playerDisplay(item.aag))}</strong><small>Matrícula ${escapeHtml(item.aag.aag_member_number)} · Index ${indexText(item.aag.current_index)}</small></div><h3>¿Corresponde a alguno de estos jugadores?</h3>${item.candidates.map((candidate,index) => `<button type="button" class="aag-candidate" data-candidate="${index}"><span><strong>${escapeHtml(playerDisplay(candidate))}</strong><small>Index ${indexText(candidate.current_index)} · ${candidate.usage?.registrations ?? "—"} inscripciones · ${candidate.usage?.scorecards ?? "—"} tarjetas</small></span><b>Asociar</b></button>`).join("")}<button type="button" class="btn secondary" data-skip-association>Crear jugador nuevo / no asociar</button></div>`;
      ui.content.querySelectorAll("[data-candidate]").forEach(button => button.addEventListener("click", async () => {
        try { button.disabled = true; await linkManualPlayer(item.candidates[Number(button.dataset.candidate)], item.aag); prepared.pending.shift(); await resolveNext(); }
        catch (error) { notify(error.message, "error"); button.disabled = false; }
      }));
      ui.content.querySelector("[data-skip-association]").addEventListener("click", async () => { prepared.pending.shift(); await resolveNext(); });
    };
    await resolveNext();
  } catch (error) {
    const ui = document.getElementById("aagSyncDialog");
    const content = ui?.querySelector("[data-sync-content]"), close = ui?.querySelector("[data-sync-close]");
    if (content) content.innerHTML = `<div class="notice warn"><strong>No se pudo completar la sincronización.</strong><br>${escapeHtml(error.message || error)}</div>`;
    if (close) close.disabled = false;
    if (!ui) notify(error.message || "No se pudo sincronizar con AAG.", "error");
  }
}

function playerDisplay(player) { return player?.full_name || [player?.last_name, player?.first_name].filter(Boolean).join(", ") || "Sin nombre"; }

export function mountShell({ context, activeStep = -1, showSteps = true, showSettings = false } = {}) {
  enableSmoothNavigation();
  const host = document.querySelector("[data-app-shell]");
  if (!host) return;
  const isAdmin = context?.profile?.role === "admin";
  host.innerHTML = `<header class="topbar"><div class="topbar-inner"><a class="brand" href="${PAGES.panel}"><img class="club-logo" src="escudo.png" alt="Escudo Villa María Golf Club"><span>Villa María Golf Club</span></a><div class="top-context">${showSettings ? '' : '<button class="btn secondary small" data-home>Inicio</button>'}${showSettings && isAdmin ? '<button class="aag-sync-status" data-aag-status type="button" title="Verificando actualización AAG"><i></i><span>Index</span></button><button class="btn secondary small settings-button" data-settings type="button" aria-label="Abrir configuración" title="Configuración"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 15.5a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7Z"/><path d="M19.4 15a1.7 1.7 0 0 0 .34 1.88l.06.06-2.83 2.83-.06-.06A1.7 1.7 0 0 0 15 19.4a1.7 1.7 0 0 0-1 .6 1.7 1.7 0 0 0-.4 1.1V21h-4v-.1A1.7 1.7 0 0 0 8.6 19.4a1.7 1.7 0 0 0-1.88.34l-.06.06-2.83-2.83.06-.06A1.7 1.7 0 0 0 4.6 15a1.7 1.7 0 0 0-.6-1 1.7 1.7 0 0 0-1.1-.4H3v-4h.1A1.7 1.7 0 0 0 4.6 8.6a1.7 1.7 0 0 0-.34-1.88l-.06-.06 2.83-2.83.06.06A1.7 1.7 0 0 0 9 4.6a1.7 1.7 0 0 0 1-.6 1.7 1.7 0 0 0 .4-1.1V3h4v.1A1.7 1.7 0 0 0 15.4 4.6a1.7 1.7 0 0 0 1.88-.34l.06-.06 2.83 2.83-.06.06A1.7 1.7 0 0 0 19.4 9c.08.38.29.73.6 1 .3.26.68.4 1.1.4h.1v4h-.1a1.7 1.7 0 0 0-1.7.6Z"/></svg></button>' : ''}<button class="btn secondary small" data-logout>Salir</button></div></div></header>${showSteps && isAdmin ? '<div class="active-tournament-shell"><div class="active-tournament-bar" data-active-tournament-bar><div class="active-tournament-copy"><small>Torneo activo</small><strong>Cargando…</strong></div></div></div>' : ""}`;
  host.querySelector("[data-home]")?.addEventListener("click", () => location.href = PAGES.panel);
  host.querySelector("[data-logout]")?.addEventListener("click", signOut);
  host.querySelector("[data-settings]")?.addEventListener("click", () => openSettings());
  host.querySelector("[data-aag-status]")?.addEventListener("click", () => startAagSync(host));
  if (showSettings && isAdmin) hydrateAagStatus(host);
  if (showSteps && isAdmin) {
    hydrateTournamentHeader(host, activeStep);
    document.addEventListener("vmgc:tournament-changed", () => hydrateTournamentHeader(host, activeStep));
  }
}

export function captureTournamentFromUrl(tournaments = []) {
  const params = new URLSearchParams(location.search);
  const id = params.get("torneo_id") || params.get("torneo") || params.get("id");
  const tournament = tournaments.find(t => String(t.id) === String(id));
  if (tournament) setActiveTournament(tournament);
  return tournament || null;
}

export { stages };
