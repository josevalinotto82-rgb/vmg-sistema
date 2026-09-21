export const toNumber = value => {
  if (value == null || value === "") return null;
  const number = Number(String(value).replace(",", "."));
  return Number.isFinite(number) ? number : null;
};

export const roundHalfUp = value => {
  const number = toNumber(value);
  return number == null ? null : Math.floor(number + 0.5);
};

const roundOneDecimal = value => {
  const number = toNumber(value);
  return number == null ? null : Math.round((number + Number.EPSILON) * 10) / 10;
};

export function normalizeGender(value) {
  const gender = String(value || "").toLowerCase().trim();
  if (["male", "caballero", "caballeros", "hombre", "masculino", "m"].includes(gender)) return "male";
  if (["female", "dama", "damas", "mujer", "femenino", "f"].includes(gender)) return "female";
  return gender;
}

export function normalizeSegment(value) {
  const segment = String(value || "18").toLowerCase().trim();
  if (["18", "18h", "18 hoyos", "18 holes", "full", "completo"].includes(segment)) return "18";
  if (["9", "9h", "9 hoyos"].includes(segment)) return "9";
  if (["front9", "front 9", "primeros 9"].includes(segment)) return "front9";
  if (["back9", "back 9", "segundos 9"].includes(segment)) return "back9";
  return segment;
}

export const getScorecard = registration => {
  const score = registration?.scorecard || null;
  if (!score) return null;
  // Las parejas comparten una unica scorecard. Cuando esa tarjeta fue enlazada
  // tambien al compañero para mostrar el estado, no debe reemplazar su
  // categoria, index ni tee individual (especialmente en Americana).
  if (score.registration_id && registration?.id && String(score.registration_id) !== String(registration.id)) return null;
  return score;
};
export const getLine = registration => registration?.starting_line || null;
export const getSlot = registration => registration?.line_slot || null;

export function memberNumber(registration) {
  const value = registration?.aag_member_number || registration?.player?.aag_member_number || getSlot(registration)?.aag_member_number;
  return value == null || value === "" ? null : String(value).replace(/\.0$/, "").trim();
}

export function baseIndex(registration) {
  return toNumber(registration?.player?.current_index) ??
    toNumber(getSlot(registration)?.manual_index) ??
    toNumber(registration?.reported_index) ??
    toNumber(getScorecard(registration)?.official_index) ??
    toNumber(getScorecard(registration)?.manual_index);
}

export function hasOfficialIndex(registration) {
  return toNumber(registration?.player?.current_index) != null;
}

export function isNewCategory(category) {
  return String(category?.category_system || "legacy") === "new" && Array.isArray(category?.tee_rules);
}

function genderFromAagCategory(value) {
  return Number(value) === 1 ? "female" : "male";
}

function segmentData(reference, holeSegment) {
  if (!reference) return null;
  const segment = normalizeSegment(holeSegment);
  if (["front9", "9"].includes(segment)) return { slope: toNumber(reference.slope_in), course_rating: toNumber(reference.rating_in), par: toNumber(reference.par_in) };
  if (segment === "back9") return { slope: toNumber(reference.slope_out), course_rating: toNumber(reference.rating_out), par: toNumber(reference.par_out) };
  return { slope: toNumber(reference.slope_total), course_rating: toNumber(reference.rating_total), par: toNumber(reference.par_total) };
}

function ruleMatches(rule, index, gender) {
  const numericIndex = toNumber(index);
  const min = toNumber(rule?.index_min);
  const max = toNumber(rule?.index_max);
  if (numericIndex == null || min == null || max == null || numericIndex < min || numericIndex > max) return false;
  const playerGender = normalizeGender(gender);
  const ruleGender = genderFromAagCategory(rule?.reference?.category);
  return !playerGender || playerGender === ruleGender;
}

export function visibleTeeName(value) {
  return String(value || "").trim().replace(/\s+/g, " ").split(" ")[0] || "—";
}

export class OfficializationRules {
  constructor({ tournament, categories, tees = [] }) {
    this.tournament = tournament;
    this.categories = categories || [];
    this.tees = tees || [];
  }

  isGross() { return String(this.tournament?.scoring_mode || "").toLowerCase() === "gross"; }
  isPair() { return this.tournament?.game_modes?.participation_type === "pair"; }
  method() { return this.tournament?.game_modes?.calculation_params?.method || ""; }
  isClassic() { return this.method() === "pair_sum_with_max_gap"; }
  isAmericana() { return this.method() === "individual_percentage"; }

  teeName(teeId) {
    return visibleTeeName(this.tees.find(tee => String(tee.id) === String(teeId))?.name);
  }

  rulesForGender(category, gender) {
    if (!isNewCategory(category)) return [];
    const normalized = normalizeGender(gender);
    return (category.tee_rules || []).filter(rule => !normalized || genderFromAagCategory(rule?.reference?.category) === normalized);
  }

  resolveCategory(category, index, gender, explicitTee = "") {
    if (!category) return null;
    if (!isNewCategory(category)) return { ...category, tee_name: this.teeName(category.tee_id) };
    const rules = this.rulesForGender(category, gender);
    const requestedTee = String(explicitTee || "").trim();
    // Misma regla que admin_oficializacion: en la asignacion automatica no se
    // acepta el primer tee como reemplazo. El indice debe entrar realmente en
    // index_min/index_max. El fallback al primer tee solo existe cuando el
    // administrador esta resolviendo una seleccion explicita en el editor.
    const rule = requestedTee
      ? (rules.find(item => String(item?.aag_teeout_id || "") === requestedTee) ||
        rules.find(item => ruleMatches(item, index, gender)) || rules[0])
      : rules.find(item => ruleMatches(item, index, gender));
    if (!rule?.reference) return null;
    const data = segmentData(rule.reference, category.hole_segment);
    if (!data || [data.slope, data.course_rating, data.par].some(value => value == null)) return null;
    return { ...category, ...data, tee_rule: rule, tee_id: String(rule.aag_teeout_id || ""), aag_teeout_id: String(rule.aag_teeout_id || ""), tee_name: rule.reference.tee_name || "" };
  }

  resolvePlayingTee(category) {
    if (!isNewCategory(category)) return this.resolveCategory(category, 0, category?.gender);
    const teeId = String(category?.playing_tee_aag_teeout_id || "");
    const rule = (category.tee_rules || []).find(item => String(item?.aag_teeout_id || "") === teeId);
    if (!rule?.reference) return null;
    const data = segmentData(rule.reference, category.hole_segment);
    return data ? { ...category, ...data, tee_rule: rule, tee_id: teeId, aag_teeout_id: teeId, tee_name: rule.reference.tee_name || "" } : null;
  }

  adjustedIndex(index, segment) {
    const numeric = toNumber(index);
    if (numeric == null) return null;
    return ["front9", "back9", "9"].includes(normalizeSegment(segment)) ? numeric / 2 : numeric;
  }

  exactCourseHandicap(index, category) {
    const numeric = toNumber(index), slope = toNumber(category?.slope), rating = toNumber(category?.course_rating), par = toNumber(category?.par);
    if ([numeric, slope, rating, par].some(value => value == null)) return null;
    return numeric * slope / 113 + (rating - par);
  }

  playingHandicap(index, category, percentage = 1) {
    const exact = this.exactCourseHandicap(index, category);
    return exact == null ? null : Math.min(roundHalfUp(exact * percentage), 54);
  }

  categoryAccepts(category, handicap) {
    const min = toNumber(category?.playing_handicap_min), max = toNumber(category?.playing_handicap_max);
    if (handicap == null) return false;
    return (min == null || handicap >= min) && (max == null || handicap <= max);
  }

  categoryMatchesGender(category, gender) {
    const wanted = normalizeGender(gender), categoryGender = normalizeGender(category?.gender);
    return !wanted || !categoryGender || wanted === categoryGender;
  }

  suggestCategory(index, gender, mode = "medal") {
    const numeric = toNumber(index);
    if (numeric == null && !this.isGross()) return null;
    for (const category of this.categories) {
      if (isNewCategory(category)) {
        // Los rangos de tee_rules de 9 hoyos estan expresados con el indice
        // dividido por dos y redondeado a un decimal, igual que en el sistema
        // original que hoy funciona.
        const adjusted = roundOneDecimal(this.adjustedIndex(numeric, category.hole_segment));
        const resolved = this.resolveCategory(category, adjusted, gender);
        if (!resolved) continue;
        if (this.isGross()) return resolved;
        const handicap = this.playingHandicap(adjusted, resolved, mode === "americana" ? .85 : 1);
        if (this.categoryAccepts(category, handicap)) return resolved;
      } else {
        if (!this.categoryMatchesGender(category, gender)) continue;
        const min = toNumber(category.index_min), max = toNumber(category.index_max);
        if ((min == null || numeric >= min) && (max == null || numeric <= max)) return this.resolveCategory(category, numeric, gender);
      }
    }
    return null;
  }

  resolvePlayerTee(index, gender) {
    const numeric = toNumber(index);
    if (numeric == null) return null;
    for (const category of this.categories) {
      if (!isNewCategory(category)) continue;
      const adjusted = roundOneDecimal(this.adjustedIndex(numeric, category.hole_segment));
      const resolved = this.resolveCategory(category, adjusted, gender);
      if (resolved) return resolved;
    }
    // Respaldo para estructuras legacy. Los torneos V2 usan tee_rules.
    return this.suggestCategory(numeric, gender);
  }

  single(registration, { categoryId, teeId = "", manualIndex = null } = {}) {
    const gender = registration?.player?.gender;
    const rawIndex = hasOfficialIndex(registration) ? baseIndex(registration) : (toNumber(manualIndex) ?? baseIndex(registration));
    const baseCategory = this.categories.find(category => String(category.id) === String(categoryId)) || this.suggestCategory(rawIndex, gender, this.isAmericana() ? "americana" : "medal");
    if (!baseCategory) return { error: "No se pudo asignar una categoría." };
    if (this.isGross()) {
      const resolvedGross = this.resolveCategory(baseCategory, rawIndex ?? 0, gender, teeId);
      return { category: resolvedGross || baseCategory, officialIndex: null, manualIndex: null, playingHandicap: 0 };
    }
    const adjusted = this.adjustedIndex(rawIndex, baseCategory.hole_segment);
    const category = this.resolveCategory(baseCategory, adjusted, gender, teeId);
    if (!category) return { error: "La categoría no tiene un tee válido para este jugador." };
    const playingHandicap = this.playingHandicap(adjusted, category, this.isAmericana() ? .85 : 1);
    if (adjusted == null || playingHandicap == null) return { error: "Falta índice o información de cancha para calcular el HCP." };
    return { category, officialIndex: rawIndex, manualIndex: adjusted, playingHandicap };
  }

  clampGap(first, second, gap = 5) {
    const a = toNumber(first), b = toNumber(second);
    if (a == null || b == null) return [null, null];
    const low = Math.min(a, b), high = Math.min(Math.max(a, b), low + gap);
    return a <= b ? [low, high] : [high, low];
  }

  classicPair(first, second, overrides = {}) {
    const firstIndex = hasOfficialIndex(first) ? baseIndex(first) : (toNumber(overrides.firstIndex) ?? baseIndex(first));
    const secondIndex = hasOfficialIndex(second) ? baseIndex(second) : (toNumber(overrides.secondIndex) ?? baseIndex(second));
    if (firstIndex == null || secondIndex == null) return { error: "La pareja tiene un índice pendiente." };
    // En Clasico el tee inicial de cada jugador se resuelve solo por su indice
    // y genero. La categoria de la pareja se determina despues de calcular el
    // HCP combinado; no debe condicionar este primer paso.
    const firstTee = this.resolvePlayerTee(firstIndex, first?.player?.gender);
    const secondTee = this.resolvePlayerTee(secondIndex, second?.player?.gender);
    if (!firstTee || !secondTee) return { error: "No se pudo resolver el tee inicial de la pareja." };
    const hcp1 = this.exactCourseHandicap(this.adjustedIndex(firstIndex, firstTee.hole_segment), firstTee);
    const hcp2 = this.exactCourseHandicap(this.adjustedIndex(secondIndex, secondTee.hole_segment), secondTee);
    const [adjusted1, adjusted2] = this.clampGap(hcp1, hcp2, 5);
    if (adjusted1 == null || adjusted2 == null) return { error: "No se pudo calcular el HCP de cancha de la pareja." };
    const exact = (adjusted1 + adjusted2) * .375;
    const playingHandicap = Math.min(roundHalfUp(exact), 54);
    const baseCategory = this.categories.find(category => this.categoryAccepts(category, playingHandicap)) || this.categories[0];
    const category = this.resolvePlayingTee(baseCategory) || baseCategory;
    if (!category) return { error: "La categoría de pareja no tiene tee de juego." };

    // El caballero juega desde el tee obligatorio de la categoria. La dama
    // conserva siempre el tee con el que se calculo su HCP de cancha.
    const firstPlayingTee = normalizeGender(first?.player?.gender) === "female" ? firstTee : category;
    const secondPlayingTee = normalizeGender(second?.player?.gender) === "female" ? secondTee : category;
    return {
      category,
      officialIndex: exact,
      manualIndex: exact,
      playingHandicap,
      firstIndex,
      secondIndex,
      firstCalculationTee: firstTee,
      secondCalculationTee: secondTee,
      firstPlayingTee,
      secondPlayingTee
    };
  }
}
