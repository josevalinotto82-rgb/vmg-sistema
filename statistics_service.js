import { supabase } from "./supabase.js";

const numberOrNull = value => {
  if (value === null || value === undefined || value === "") return null;
  const number = Number(String(value).replace(",", "."));
  return Number.isFinite(number) ? number : null;
};

function cardIndex(card) {
  return numberOrNull(card.manual_index ?? card.official_index);
}

function activeHoles(segment) {
  const value = String(segment || "18").toLowerCase();
  if (value.includes("front") || value === "9" || value === "9h") return [1,2,3,4,5,6,7,8,9];
  if (value.includes("back")) return [10,11,12,13,14,15,16,17,18];
  return Array.from({ length: 18 }, (_, index) => index + 1);
}

function holeValue(card, hole) {
  const raw = card?.hole_scores?.[hole] ?? card?.hole_scores?.[String(hole)];
  if (raw && typeof raw === "object") {
    return {
      strokes: numberOrNull(raw.strokes ?? raw.score ?? raw.gross),
      par: numberOrNull(raw.par_value ?? raw.par ?? raw.Par),
      handicap: numberOrNull(raw.hole_handicap ?? raw.handicap ?? raw.hcp)
    };
  }
  return { strokes: numberOrNull(raw), par: null, handicap: null };
}

function categoryRule(card, categories) {
  const category = categories.get(String(card.category_id || ""));
  const rules = Array.isArray(category?.tee_rules) ? category.tee_rules : [];
  if (!rules.length) return null;
  const teeName = String(card.tee_name || "").trim().toLocaleLowerCase("es");
  return rules.find(rule => String(rule?.reference?.tee_name || "").trim().toLocaleLowerCase("es") === teeName)
    || (rules.length === 1 ? rules[0] : null);
}

function fallbackHole(card, hole, categories) {
  const rule = categoryRule(card, categories);
  const source = rule?.reference?.holes;
  if (!Array.isArray(source)) return { par: null, handicap: null };
  const row = source.find(item => Number(item?.hole) === hole);
  return { par: numberOrNull(row?.par), handicap: numberOrNull(row?.handicap) };
}

async function selectAll(table, columns, tournamentIds) {
  const pageSize = 1000;
  let start = 0, rows = [];
  while (true) {
    const { data, error } = await supabase.from(table).select(columns).in("tournament_id", tournamentIds).range(start, start + pageSize - 1);
    if (error) throw error;
    rows = rows.concat(data || []);
    if (!data || data.length < pageSize) break;
    start += pageSize;
  }
  return rows;
}

export async function loadTournamentStatistics(tournamentIds, { indexMin = null, indexMax = null } = {}) {
  if (!Array.isArray(tournamentIds) || !tournamentIds.length) throw new Error("Elegí al menos un torneo.");
  const [cards, categoryRows] = await Promise.all([
    selectAll("scorecards", "id,tournament_id,display_name,card_status,official_index,manual_index,hole_segment,category_id,tee_name,hole_scores", tournamentIds),
    selectAll("tournament_categories", "id,tournament_id,tee_rules", tournamentIds)
  ]);
  const categories = new Map(categoryRows.map(row => [String(row.id), row]));
  const min = numberOrNull(indexMin), max = numberOrNull(indexMax);
  const filterActive = min !== null || max !== null;
  const validCards = cards.filter(card => ["valid", "cargada"].includes(String(card.card_status || "").toLowerCase())).filter(card => {
    if (!filterActive) return true;
    const index = cardIndex(card);
    if (index === null) return false;
    if (min !== null && index < min) return false;
    if (max !== null && index > max) return false;
    return true;
  });
  const stats = Array.from({ length: 18 }, (_, index) => ({
    hole: index + 1, count: 0, totalStrokes: 0, totalVsPar: 0,
    eagles: 0, birdies: 0, pars: 0, bogeys: 0, doublePlus: 0,
    parsUsed: new Set(), handicapsUsed: new Set()
  }));
  for (const card of validCards) {
    for (const hole of activeHoles(card.hole_segment)) {
      const value = holeValue(card, hole);
      const fallback = fallbackHole(card, hole, categories);
      const par = value.par ?? fallback.par;
      const handicap = value.handicap ?? fallback.handicap;
      if (value.strokes === null || par === null || value.strokes <= 0) continue;
      const row = stats[hole - 1], difference = value.strokes - par;
      row.count += 1;
      row.totalStrokes += value.strokes;
      row.totalVsPar += difference;
      row.parsUsed.add(par);
      if (handicap !== null) row.handicapsUsed.add(handicap);
      if (difference <= -2) row.eagles += 1;
      else if (difference === -1) row.birdies += 1;
      else if (difference === 0) row.pars += 1;
      else if (difference === 1) row.bogeys += 1;
      else row.doublePlus += 1;
    }
  }
  const holes = stats.map(row => ({
    hole: row.hole,
    count: row.count,
    par: row.parsUsed.size === 1 ? [...row.parsUsed][0] : row.parsUsed.size > 1 ? "Variable" : null,
    handicap: row.handicapsUsed.size === 1 ? [...row.handicapsUsed][0] : row.handicapsUsed.size > 1 ? "Variable" : null,
    average: row.count ? row.totalStrokes / row.count : null,
    averageVsPar: row.count ? row.totalVsPar / row.count : null,
    eagles: row.eagles, birdies: row.birdies, pars: row.pars, bogeys: row.bogeys, doublePlus: row.doublePlus
  }));
  return {
    holes,
    ranking: holes.filter(row => row.count).sort((a, b) => b.averageVsPar - a.averageVsPar || a.hole - b.hole),
    cards: validCards.length,
    observations: holes.reduce((sum, row) => sum + row.count, 0),
    excluded: cards.length - validCards.length
  };
}

