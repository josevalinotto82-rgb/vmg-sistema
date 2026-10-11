import { requireSession } from "./auth.js";
import { supabase } from "./supabase.js";
import { PAGES } from "./config.js";
import { mountShell, getActiveTournament, setActiveTournament, renderStageNavigation } from "./shell.js";
import { escapeHtml, formatDate, notify, showState, setBusy, confirmAction } from "./ui.js";
import {
  normalizeText, normalizeSegment, enabledHoles, segmentLabel, cardStatus, statusLabel, scoreMap,
  categoryForScorecard, holeMetadata, missingCourseData, isAmerican, isGross, calculateCard,
  loadScorecardWorkspace, saveScorecard, archiveTournament
} from "./scorecards_service.js";

const context = await requireSession({ admin: true });
mountShell({ context, activeStep: 3 });

const byId = id => document.getElementById(id);
const tournamentStrip = byId("tournamentStrip"), pageState = byId("pageState"), editor = byId("cardEditor"), list = byId("cardList");
const search = byId("cardSearch"), reloadButton = byId("reloadButton"), archiveButton = byId("archiveButton");
let bundle = null, selectedId = "", filter = "all", realtimeChannel = null, realtimeTimer = null;

function requestedTournamentId() {
  const params = new URLSearchParams(location.search);
  return params.get("torneo") || params.get("torneo_id") || getActiveTournament().id;
}

function sortedCards() {
  const weight = { npt: 0, desc: 1, valid: 2 };
  return [...(bundle?.scorecards || [])].sort((a, b) => (weight[cardStatus(a)] - weight[cardStatus(b)]) || normalizeText(a.display_name).localeCompare(normalizeText(b.display_name), "es"));
}

function visibleCards() {
  const query = normalizeText(search.value);
  return sortedCards().filter(card => {
    const matchesText = !query || normalizeText(`${card.display_name} ${card.aag_member_number || ""}`).includes(query);
    const status = cardStatus(card);
    const matchesStatus = filter === "all" || filter === "pending" && status !== "valid" || filter === "valid" && status === "valid";
    return matchesText && matchesStatus;
  });
}

function renderStrip() {
  renderStageNavigation(tournamentStrip, 3, bundle.tournament.id);
}

function renderKpis() {
  const cards = bundle.scorecards;
  byId("totalCards").textContent = cards.length;
  byId("pendingCards").textContent = cards.filter(card => cardStatus(card) === "npt").length;
  byId("incompleteCards").textContent = cards.filter(card => cardStatus(card) === "desc").length;
  byId("validCards").textContent = cards.filter(card => cardStatus(card) === "valid").length;
  byId("exportCards").textContent = cards.filter(card => card.export_ready).length;
  byId("listSummary").textContent = bundle.standalone
    ? `${cards.length} tarjeta${cards.length === 1 ? "" : "s"} independiente${cards.length === 1 ? "" : "s"}`
    : `${cards.length} tarjeta${cards.length === 1 ? "" : "s"} creadas en Adm. torneo${bundle.pendingCreation ? ` · ${bundle.pendingCreation} pendiente${bundle.pendingCreation === 1 ? "" : "s"} de crear` : ""}`;
}

function cardSecondary(card) {
  if (isGross(bundle)) return `Gross ${card.gross ?? "—"}`;
  if (isAmerican(bundle)) return `Resultado ${card.gross ?? "—"}`;
  return `HCP ${card.playing_handicap ?? "—"} · Gross ${card.gross ?? "—"} · Neto ${card.net ?? "—"}`;
}

function renderList() {
  const cards = visibleCards();
  if (!cards.length) {
    list.innerHTML = '<div class="empty-state compact">No hay tarjetas para este filtro.</div>';
    return;
  }
  list.innerHTML = cards.map(card => {
    const status = cardStatus(card), active = String(card.id) === String(selectedId), category = categoryForScorecard(bundle, card);
    return `<button class="scorecard-player ${active ? "active" : ""} ${status}" data-card-id="${card.id}"><span class="scorecard-player-main"><strong>${escapeHtml(card.display_name || "Sin nombre")}</strong><small>${escapeHtml(card.aag_member_number || "Sin matrícula AAG")} · ${escapeHtml(card.category_name || category?.name || "Sin categoría")}</small><small>${escapeHtml(card.tee_name || "Tee sin informar")} · ${cardSecondary(card)}</small></span><span class="status ${status === "valid" ? "open" : status === "desc" ? "danger" : "pending"}">${statusLabel(card)}</span></button>`;
  }).join("");
  list.querySelectorAll("[data-card-id]").forEach(button => button.addEventListener("click", () => selectCard(button.dataset.cardId)));
}

function currentCard() {
  return bundle.scorecards.find(card => String(card.id) === String(selectedId)) || null;
}

function valuesFromInputs() {
  const result = {};
  editor.querySelectorAll("[data-hole-input]").forEach(input => {
    const raw = String(input.value || "").trim();
    result[Number(input.dataset.holeInput)] = raw === "" ? null : Number(raw);
  });
  return result;
}

function sumRange(values, from, to) {
  const numbers = Object.entries(values).filter(([hole, value]) => Number(hole) >= from && Number(hole) <= to && Number.isFinite(value)).map(([, value]) => Number(value));
  return numbers.length ? numbers.reduce((sum, value) => sum + value, 0) : null;
}

function updatePreview() {
  const card = currentCard();
  if (!card) return;
  const result = calculateCard(bundle, card, valuesFromInputs());
  byId("previewFirst").textContent = sumRange(valuesFromInputs(), 1, 9) ?? "—";
  byId("previewSecond").textContent = sumRange(valuesFromInputs(), 10, 18) ?? "—";
  byId("previewGross").textContent = result.gross ?? "—";
  if (byId("previewNet")) byId("previewNet").textContent = result.net ?? "—";
  byId("previewStatus").textContent = result.card_status === "valid" ? "Cargada" : result.card_status === "desc" ? "DESC" : "Sin presentar";
}

function holeGroup(card, numbers, title) {
  const values = scoreMap(card);
  return `<section><div class="scorecard-nine-title"><strong>${title}</strong><span>${numbers[0]}–${numbers[numbers.length - 1]}</span></div><div class="holes scorecard-holes">${numbers.map(number => {
    const meta = holeMetadata(bundle, card, number);
    return `<div class="hole"><label>Hoyo ${number}</label><small class="hole-meta"><span>Par ${meta.par}</span><span>HCP ${meta.handicap}</span></small><input data-hole-input="${number}" inputmode="numeric" maxlength="2" value="${values[number] ?? ""}" aria-label="Golpes hoyo ${number}"></div>`;
  }).join("")}</div></section>`;
}

function renderEditor({ focusFirstHole = true } = {}) {
  const card = currentCard();
  if (!card) {
    pageState.classList.remove("hidden"); editor.classList.add("hidden"); showState(pageState, "Seleccioná una tarjeta para comenzar."); return;
  }
  const missing = missingCourseData(bundle, card);
  if (missing.length) {
    pageState.classList.remove("hidden"); editor.classList.add("hidden"); showState(pageState, `Falta Par/HCP en la categoría del torneo para los hoyos: ${missing.join(", ")}. No se usarán datos fijos del HTML.`, "error"); return;
  }
  const holes = enabledHoles(card.hole_segment), first = holes.filter(number => number <= 9), second = holes.filter(number => number >= 10);
  const category = categoryForScorecard(bundle, card), noNet = isGross(bundle) || isAmerican(bundle);
  pageState.classList.add("hidden"); editor.classList.remove("hidden");
  editor.innerHTML = `<div class="card-head scorecard-editor-head"><div><div class="eyebrow">Tarjeta seleccionada</div><h2>${escapeHtml(card.display_name)}</h2><div class="subtle">Matrícula ${escapeHtml(card.aag_member_number || "—")} · ${escapeHtml(category?.name || card.category_name || "Sin categoría")} · ${escapeHtml(card.tee_name || "Tee sin informar")} · ${segmentLabel(card.hole_segment)}</div></div><span class="status ${cardStatus(card) === "valid" ? "open" : cardStatus(card) === "desc" ? "danger" : "pending"}">${statusLabel(card)}</span></div><div class="card-body"><div class="scorecard-context">${isGross(bundle) ? "Torneo Gross: se suman golpes y no se descuenta HCP." : isAmerican(bundle) ? "Americana: cargá el resultado final de la pareja por hoyo; no se descuenta otro HCP." : `HCP de juego: ${card.playing_handicap ?? "—"}. El neto se calcula automáticamente.`}</div><div class="hole-groups">${first.length ? holeGroup(card, first, "Primera vuelta") : ""}${second.length ? holeGroup(card, second, "Segunda vuelta") : ""}</div><div class="score-summary scorecard-preview ${noNet ? "without-net" : ""}"><div class="score-box"><strong id="previewFirst">—</strong><span>Ida</span></div><div class="score-box"><strong id="previewSecond">—</strong><span>Vuelta</span></div><div class="score-box"><strong id="previewGross">—</strong><span>${noNet ? "Resultado" : "Gross"}</span></div>${noNet ? "" : '<div class="score-box"><strong id="previewNet">—</strong><span>Neto</span></div>'}<div class="score-box"><strong id="previewStatus">—</strong><span>Estado</span></div></div><div class="scorecard-actions"><button class="btn secondary" id="clearCardButton">Limpiar</button><button class="btn danger" id="descCardButton">${cardStatus(card) === "desc" ? "Quitar DESC" : "Marcar DESC"}</button><button class="btn primary" id="saveCardButton">Guardar tarjeta</button></div></div>`;
  editor.querySelectorAll("[data-hole-input]").forEach((input, index, inputs) => {
    input.addEventListener("input", () => { input.value = input.value.replace(/[^0-9]/g, "").slice(0, 2); updatePreview(); });
    input.addEventListener("keydown", async event => { if (event.key !== "Enter") return; event.preventDefault(); if (inputs[index + 1]) { inputs[index + 1].focus(); inputs[index + 1].select(); } else await saveCurrent({ returnToSearch: true }); });
  });
  byId("clearCardButton").addEventListener("click", () => { editor.querySelectorAll("[data-hole-input]").forEach(input => { input.value = ""; }); updatePreview(); });
  byId("descCardButton").addEventListener("click", toggleDesc);
  byId("saveCardButton").addEventListener("click", () => saveCurrent());
  updatePreview();
  if (focusFirstHole) requestAnimationFrame(() => editor.querySelector("[data-hole-input]")?.focus());
}

function selectCard(id) { selectedId = id; renderList(); renderEditor(); }

function focusSearchForNextPlayer() {
  search.focus();
  search.select();
}

async function saveCurrent({ returnToSearch = false } = {}) {
  const card = currentCard(); if (!card) return;
  const button = byId("saveCardButton"); setBusy(button, true, "Guardando…");
  try {
    const payload = calculateCard(bundle, card, valuesFromInputs());
    await saveScorecard(card.id, payload); await reload({ preserveSelection: true, focusEditor: !returnToSearch });
    notify(payload.card_status === "valid" ? `Tarjeta cargada: ${card.display_name}` : `Tarjeta guardada como ${payload.card_status === "desc" ? "DESC" : "sin presentar"}.`, payload.card_status === "valid" ? "success" : "warning");
    if (returnToSearch) focusSearchForNextPlayer();
  } catch (error) { console.error(error); notify(error.message || "No se pudo guardar la tarjeta.", "error"); }
  finally { setBusy(button, false); }
}

async function toggleDesc() {
  const card = currentCard(); if (!card) return;
  const forced = cardStatus(card) === "desc" ? "" : "desc";
  try { await saveScorecard(card.id, calculateCard(bundle, card, valuesFromInputs(), forced)); await reload({ preserveSelection: true }); notify(forced ? "Tarjeta marcada DESC." : "Estado DESC actualizado."); }
  catch (error) { notify(error.message, "error"); }
}

async function reload({ preserveSelection = false, focusEditor = true } = {}) {
  const id = requestedTournamentId();
  if (!id) { location.replace(PAGES.panel); return; }
  renderStageNavigation(tournamentStrip, 3, id);
  byId("backOfficialization").href = `oficializacion.html?torneo=${encodeURIComponent(id)}`;
  const previous = preserveSelection ? selectedId : "";
  bundle = await loadScorecardWorkspace(id); setActiveTournament(bundle.tournament);
  selectedId = bundle.scorecards.some(card => String(card.id) === String(previous)) ? previous : sortedCards()[0]?.id || "";
  byId("backOfficialization").href = `oficializacion.html?torneo=${encodeURIComponent(id)}`;
  renderStrip(); renderKpis(); renderList(); renderEditor({ focusFirstHole: focusEditor }); subscribe(id);
}

function subscribe(tournamentId) {
  if (realtimeChannel) supabase.removeChannel(realtimeChannel);
  realtimeChannel = supabase.channel(`tarjetas-${tournamentId}`).on("postgres_changes", { event: "*", schema: "public", table: "scorecards", filter: `tournament_id=eq.${tournamentId}` }, () => {
    clearTimeout(realtimeTimer); realtimeTimer = setTimeout(() => {
      if (document.activeElement === search || editor.querySelector("input:focus")) return;
      reload({ preserveSelection: true, focusEditor: false }).catch(console.warn);
    }, 500);
  }).subscribe();
}

search.addEventListener("input", renderList);
search.addEventListener("keydown", event => {
  if (event.key !== "Enter") return;
  const matches = visibleCards();
  if (matches.length !== 1) return;
  event.preventDefault();
  selectCard(matches[0].id);
});
byId("statusFilters").addEventListener("click", event => { const button = event.target.closest("[data-filter]"); if (!button) return; filter = button.dataset.filter; byId("statusFilters").querySelectorAll(".filter-tab").forEach(item => item.classList.toggle("active", item === button)); renderList(); });
reloadButton.addEventListener("click", () => reload({ preserveSelection: true }).catch(error => notify(error.message, "error")));
archiveButton.addEventListener("click", async () => {
  const pending = bundle.scorecards.filter(card => cardStatus(card) !== "valid").length;
  const ok = await confirmAction({ title: "Archivar torneo", message: pending ? `Todavía hay ${pending} tarjeta(s) sin completar o DESC. ¿Querés archivarlo igualmente?` : "El torneo quedará archivado y disponible para Resultados.", confirmText: "Archivar", danger: true });
  if (!ok) return;
  try { await archiveTournament(bundle.tournament.id); bundle.tournament.status = "archived"; renderStrip(); notify("Torneo archivado correctamente."); }
  catch (error) { notify(error.message, "error"); }
});

try { await reload({ focusEditor: false }); focusSearchForNextPlayer(); }
catch (error) { console.error(error); showState(pageState, error.message || "No se pudo cargar el torneo.", "error"); editor.classList.add("hidden"); }

window.addEventListener("beforeunload", () => { if (realtimeChannel) supabase.removeChannel(realtimeChannel); });
