import { BETA_PAGES, ACTIVE_TOURNAMENT_ID_KEY, ACTIVE_TOURNAMENT_NAME_KEY } from "./config_beta.js";
import { signOut } from "./auth_beta.js";
import { escapeHtml } from "./ui_beta.js";

const stages = [
  { page: BETA_PAGES.tournaments, label: "Configuración", param: "torneo_id" },
  { page: BETA_PAGES.registrations, label: "Inscripciones", param: "torneo_id" },
  { page: BETA_PAGES.officialization, label: "Oficialización", param: "torneo" },
  { page: BETA_PAGES.scorecards, label: "Tarjetas", param: "torneo" },
  { page: BETA_PAGES.results, label: "Resultados", param: "torneo" },
  { page: BETA_PAGES.export, label: "Exportación", param: "torneo" }
];

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
