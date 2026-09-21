import { BETA_PAGES, ACTIVE_TOURNAMENT_ID_KEY, ACTIVE_TOURNAMENT_NAME_KEY } from "./config_beta.js";
import { signOut } from "./auth_beta.js";
import { escapeHtml } from "./ui_beta.js";

const stages = [
  { page: BETA_PAGES.tournaments, label: "Configuración", param: "torneo_id" },
  { page: BETA_PAGES.registrations, label: "Inscripciones", param: "torneo_id" },
  { page: BETA_PAGES.officialization, label: "Adm. torneo", param: "torneo" },
  { page: BETA_PAGES.scorecards, label: "Tarjetas", param: "torneo" },
  { page: BETA_PAGES.results, label: "Resultados", param: "torneo" },
  { page: BETA_PAGES.export, label: "Exportación", param: "torneo" }
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

  // Adelanta solamente el HTML. Los modulos JS y CSS conservan su cache normal
  // y las consultas a Supabase siguen ejecutandose con datos vigentes.
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
    const anchor = event.target.closest?.("a");
    const url = internalPageUrl(anchor);
    if (!url || navigationInProgress) return;
    // La pequeña pausa permite que el desvanecimiento se pinte antes de que
    // el navegador descarte el documento actual.
    event.preventDefault();
    navigationInProgress = true;
    document.body.classList.add("vmgc-leaving");
    window.setTimeout(() => location.assign(url.href), 150);
  });
}

export function getActiveTournament() {
  return {
    id: localStorage.getItem(ACTIVE_TOURNAMENT_ID_KEY) || "",
    name: localStorage.getItem(ACTIVE_TOURNAMENT_NAME_KEY) || ""
  };
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

export function mountShell({ context, activeStep = -1, showSteps = true } = {}) {
  enableSmoothNavigation();
  const host = document.querySelector("[data-app-shell]");
  if (!host) return;
  const active = getActiveTournament();
  const isAdmin = context?.profile?.role === "admin";
  host.innerHTML = `<header class="topbar"><div class="topbar-inner"><a class="brand" href="${BETA_PAGES.panel}"><img class="club-logo" src="escudo.png" alt="Escudo Villa María Golf Club"><span>Villa María Golf Club</span><small class="status open" style="margin-left:5px">BETA</small></a><div class="top-context"><div class="context-copy"><strong data-shell-tournament>${escapeHtml(active.name || "Sin torneo activo")}</strong><small>${active.id ? "Torneo activo" : "Elegí un torneo desde el panel"}</small></div><button class="btn secondary small" data-home>Panel</button><button class="btn secondary small" data-logout>Salir</button></div></div></header>
  ${showSteps && isAdmin ? `<div class="shell" style="padding-bottom:0"><nav class="steps">${stages.map((s, i) => `<a class="step ${i === activeStep ? "active" : ""}" data-stage-index="${i}" href="${tournamentUrl(s)}"><span class="num">${i + 1}</span>${s.label}</a>`).join("")}</nav></div>` : ""}`;
  host.querySelector("[data-home]")?.addEventListener("click", () => location.href = BETA_PAGES.panel);
  host.querySelector("[data-logout]")?.addEventListener("click", signOut);
  document.addEventListener("vmgc:tournament-changed", event => {
    const label = host.querySelector("[data-shell-tournament]");
    if (label) label.textContent = event.detail?.name || "Torneo seleccionado";
    host.querySelectorAll("[data-stage-index]").forEach(link => {
      const stage = stages[Number(link.dataset.stageIndex)];
      if (stage) link.href = tournamentUrl(stage, event.detail?.id || "");
    });
  });
}

export function captureTournamentFromUrl(tournaments = []) {
  const params = new URLSearchParams(location.search);
  const id = params.get("torneo_id") || params.get("torneo") || params.get("id");
  const tournament = tournaments.find(t => String(t.id) === String(id));
  if (tournament) setActiveTournament(tournament);
  return tournament || null;
}

export { stages };
