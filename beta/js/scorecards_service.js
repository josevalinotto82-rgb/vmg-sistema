import { supabase } from "./supabase.js";

export function normalizeText(value) {
  return String(value || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toUpperCase().trim();
}

export function normalizeSegment(value) {
  const segment = String(value || "").toLowerCase().trim();
  if (["front9", "front 9", "primeros 9", "ida", "9", "9h", "9 hoyos"].includes(segment)) return "front9";
  if (["back9", "back 9", "segundos 9", "vuelta"].includes(segment)) return "back9";
  return "18";
}

export function enabledHoles(segment) {
  if (normalizeSegment(segment) === "front9") return Array.from({ length: 9 }, (_, index) => index + 1);
  if (normalizeSegment(segment) === "back9") return Array.from({ length: 9 }, (_, index) => index + 10);
  return Array.from({ length: 18 }, (_, index) => index + 1);
}

export function segmentLabel(segment) {
  const value = normalizeSegment(segment);
  if (value === "front9") return "Hoyos 1 al 9";
  if (value === "back9") return "Hoyos 10 al 18";
  return "18 hoyos";
}

export function cardStatus(scorecard) {
  const value = String(scorecard?.card_status || "npt").toLowerCase();
  if (["valid", "cargada", "loaded"].includes(value)) return "valid";
  if (["desc", "incomplete"].includes(value)) return "desc";
  return "npt";
}

export function statusLabel(scorecard) {
  const status = cardStatus(scorecard);
  if (status === "valid") return "Cargada";
  if (status === "desc") return "DESC";
  return "Sin presentar";
}

export function scoreMap(scorecard) {
  const result = {};
  for (const [hole, raw] of Object.entries(scorecard?.hole_scores || {})) {
    const value = raw && typeof raw === "object" ? raw.strokes : raw;
    if (value !== null && value !== undefined && value !== "") result[Number(hole)] = Number(value);
  }
  return result;
}

function ruleHoles(rule) {
  return Array.isArray(rule?.reference?.holes) ? rule.reference.holes : [];
}

function holeNumber(raw) {
  return Number(raw?.hole ?? raw?.HoleNumber ?? raw?.hole_number ?? raw?.number);
}

export function categoryForScorecard(bundle, scorecard) {
  return bundle.categories.find(category => String(category.id) === String(scorecard.category_id)) || null;
}

export function teeRuleForScorecard(bundle, scorecard) {
  const category = categoryForScorecard(bundle, scorecard);
  const rules = Array.isArray(category?.tee_rules) ? category.tee_rules : [];
  if (!rules.length) return null;
  const playingTee = String(category?.playing_tee_aag_teeout_id || "");
  if (playingTee) {
    const found = rules.find(rule => String(rule?.aag_teeout_id || "") === playingTee);
    if (found) return found;
  }
  const teeName = normalizeText(scorecard?.tee_name);
  if (teeName) {
    const found = rules.find(rule => normalizeText(rule?.reference?.tee_name) === teeName);
    if (found) return found;
  }
  return rules.length === 1 ? rules[0] : null;
}

export function holeMetadata(bundle, scorecard, number) {
  const raw = ruleHoles(teeRuleForScorecard(bundle, scorecard)).find(hole => holeNumber(hole) === Number(number));
  if (!raw) return null;
  const par = Number(raw?.par ?? raw?.Par ?? raw?.par_value);
  const handicap = Number(raw?.handicap ?? raw?.Handicap ?? raw?.hole_handicap ?? raw?.hole_hcp ?? raw?.hcp ?? raw?.stroke_index);
  const yards = Number(raw?.yards ?? raw?.Yards ?? raw?.yardage);
  return {
    par: Number.isFinite(par) ? par : null,
    handicap: Number.isFinite(handicap) ? handicap : null,
    yards: Number.isFinite(yards) ? yards : null
  };
}

export function missingCourseData(bundle, scorecard) {
  return enabledHoles(scorecard.hole_segment).filter(number => {
    const meta = holeMetadata(bundle, scorecard, number);
    return !meta || !Number.isFinite(meta.par) || !Number.isFinite(meta.handicap);
  });
}

export function isAmerican(bundle) {
  return normalizeText(bundle?.tournament?.game_modes?.name).includes("AMERICANA");
}

export function isGross(bundle) {
  return String(bundle?.tournament?.scoring_mode || "net").toLowerCase() === "gross";
}

export function calculateCard(bundle, scorecard, values, forcedStatus = "") {
  const holes = enabledHoles(scorecard.hole_segment);
  const loaded = holes.filter(number => Number.isFinite(values[number]));
  const gross = loaded.length ? loaded.reduce((sum, number) => sum + Number(values[number]), 0) : null;
  let status = loaded.length === 0 ? "npt" : loaded.length === holes.length ? "valid" : "desc";
  if (forcedStatus === "desc") status = "desc";
  const withoutNet = isAmerican(bundle) || isGross(bundle);
  const net = gross === null ? null : withoutNet ? (isAmerican(bundle) ? gross : null) : gross - Number(scorecard.playing_handicap || 0);
  const total = isGross(bundle) ? gross : net;
  const exportReady = status === "valid" && scorecard.aag_exportable === true && !!scorecard.aag_member_number;
  const holeScores = {};
  holes.forEach(number => { holeScores[String(number)] = Number.isFinite(values[number]) ? Number(values[number]) : null; });
  return { gross, net, total, card_status: status, export_ready: exportReady, hole_scores: holeScores, updated_at: new Date().toISOString() };
}

export async function loadScorecardWorkspace(tournamentId) {
  const [tournamentResult, categoriesResult, registrationsResult, scorecardsResult] = await Promise.all([
    supabase.from("tournaments").select("id,name,tournament_date,status,hole_count,start_type,scoring_mode,data_schema_version,game_modes(id,name,participation_type,calculation_params)").eq("id", tournamentId).single(),
    supabase.from("tournament_categories").select("id,tournament_id,category_id,category_system,name,display_order,hole_segment,tee_rules,playing_tee_aag_teeout_id").eq("tournament_id", tournamentId).order("display_order"),
    supabase.from("registrations").select("id,partner_registration_id").eq("tournament_id", tournamentId).neq("registration_status", "cancelled"),
    supabase.from("scorecards").select("id,tournament_id,registration_id,linked_player_id,display_name,aag_member_number,playing_handicap,player_1_playing_handicap,player_2_playing_handicap,category_id,category_name,tee_name,player_gender,hole_segment,gross,net,total,card_status,hole_scores,export_ready,aag_exportable,exported_to_aag").eq("tournament_id", tournamentId)
  ]);
  for (const result of [tournamentResult, categoriesResult, registrationsResult, scorecardsResult]) if (result.error) throw result.error;
  if (Number(tournamentResult.data?.data_schema_version) !== 2) throw new Error("Esta pantalla administra únicamente torneos V2.");
  const categories = categoriesResult.data || [];
  if (categories.some(category => String(category.category_system || "").toLowerCase() !== "new")) throw new Error("El torneo contiene categorías que no pertenecen al sistema nuevo.");
  const registrations = registrationsResult.data || [];
  const scorecards = scorecardsResult.data || [];
  const registrationIds = new Set(registrations.map(item => String(item.id)));
  const used = new Set();
  const expectedGroups = [];
  for (const registration of registrations) {
    const id = String(registration.id);
    if (used.has(id)) continue;
    const partnerId = String(registration.partner_registration_id || "");
    const group = [id];
    used.add(id);
    if (partnerId && registrationIds.has(partnerId)) {
      group.push(partnerId);
      used.add(partnerId);
    }
    expectedGroups.push(group);
  }
  const cardRegistrationIds = new Set(scorecards.map(card => String(card.registration_id || "")));
  const missingGroups = expectedGroups.filter(group => !group.some(id => cardRegistrationIds.has(id)));
  if (!expectedGroups.length && !scorecards.length) {
    throw new Error("El torneo todavía no tiene inscriptos ni tarjetas para cargar.");
  }
  // Las tarjetas creadas se pueden cargar sin esperar al resto de los inscriptos.
  return { tournament: tournamentResult.data, categories, scorecards, standalone: expectedGroups.length === 0, pendingCreation: missingGroups.length };
}

export async function saveScorecard(scorecardId, payload) {
  const { error } = await supabase.from("scorecards").update(payload).eq("id", scorecardId);
  if (error) throw error;
}

export async function archiveTournament(tournamentId) {
  const { error } = await supabase.from("tournaments").update({ status: "archived" }).eq("id", tournamentId);
  if (error) throw error;
}
