import { supabase } from "./supabase_beta.js";
import { OfficializationRules, baseIndex, getLine, getScorecard, getSlot, isNewCategory, memberNumber, normalizeGender } from "./officialization_rules_beta.js";

const emptyHoles = () => Object.fromEntries(Array.from({ length: 18 }, (_, index) => [String(index + 1), null]));

export async function listOfficializationTournaments() {
  const { data, error } = await supabase.from("tournaments").select("id,name,tournament_date,status,published,hole_count,start_type,scoring_mode,data_schema_version,game_mode_id,game_modes(id,name,participation_type,calculation_params)").eq("data_schema_version", 2).in("status", ["open", "officialized"]).order("tournament_date", { ascending: false });
  if (error) throw error;
  return data || [];
}

export async function loadOfficialization(tournamentId) {
  const [tournamentResult, categoryResult, teeResult, registrationResult, scorecardResult, paymentResult] = await Promise.all([
    supabase.from("tournaments").select("id,name,tournament_date,status,published,hole_count,start_type,scoring_mode,data_schema_version,game_mode_id,game_modes(id,name,participation_type,calculation_params)").eq("id", tournamentId).eq("data_schema_version", 2).single(),
    supabase.from("tournament_categories").select("id,category_id,category_system,name,index_min,index_max,tee_id,display_order,gender,slope,course_rating,par,hole_segment,tee_rules,playing_handicap_min,playing_handicap_max,playing_tee_aag_teeout_id").eq("tournament_id", tournamentId).order("display_order"),
    supabase.from("tees").select("id,name,display_order").order("display_order"),
    supabase.from("registrations").select("id,tournament_id,linked_player_id,display_name,participant_type,aag_member_number,club_name,country,reported_index,category_id,registration_status,needs_admin_review,partner_registration_id,starting_line_id,line_slot_id,created_at,player:players!linked_player_id(gender,aag_member_number,current_index,club_name,option_club_id),line_slot:line_slots(id,manual_index,aag_member_number),starting_line:starting_lines!registrations_starting_line_id_fkey(id,line_time,starting_hole,label)").eq("tournament_id", tournamentId).neq("registration_status", "cancelled").order("created_at"),
    supabase.from("scorecards").select("id,tournament_id,registration_id,linked_player_id,display_name,aag_member_number,official_index,manual_index,playing_handicap,player_1_playing_handicap,player_2_playing_handicap,category_id,category_name,tee_id,tee_name,card_status,aag_exportable,export_ready,hole_segment,slope,course_rating,par,hole_scores,starting_time,starting_hole").eq("tournament_id", tournamentId),
    supabase.from("tournament_payments").select("*").eq("tournament_id", tournamentId)
  ]);
  for (const result of [tournamentResult, categoryResult, teeResult, registrationResult, scorecardResult]) if (result.error) throw result.error;
  if (paymentResult.error) console.warn("No se pudieron cargar los pagos", paymentResult.error);
  const tournament = tournamentResult.data;
  const registrations = registrationResult.data || [];
  const scorecards = scorecardResult.data || [];
  const scoreByRegistration = new Map(scorecards.map(card => [String(card.registration_id), card]));
  const registrationIds = new Set(registrations.map(registration => String(registration.id)));
  for (const registration of registrations) {
    registration.line_slot = Array.isArray(registration.line_slot) ? registration.line_slot[0] || null : registration.line_slot;
    registration.starting_line = Array.isArray(registration.starting_line) ? registration.starting_line[0] || null : registration.starting_line;
    registration.scorecard = scoreByRegistration.get(String(registration.id)) || null;
  }
  for (const card of scorecards) {
    if (!registrationIds.has(String(card.registration_id))) continue;
    const owner = registrations.find(registration => String(registration.id) === String(card.registration_id));
    const partner = owner?.partner_registration_id ? registrations.find(registration => String(registration.id) === String(owner.partner_registration_id)) : null;
    if (partner && !partner.scorecard) partner.scorecard = card;
  }
  const payments = paymentResult.error ? [] : paymentResult.data || [];
  const paymentMap = new Map(payments.map(payment => [String(payment.registration_id), payment]));
  const noPayMap = await loadMonthlyNoPaySuggestions(tournament, registrations);
  return { tournament, categories: categoryResult.data || [], tees: teeResult.data || [], registrations, scorecards, payments, paymentMap, noPayMap, rules: new OfficializationRules({ tournament, categories: categoryResult.data || [], tees: teeResult.data || [] }) };
}

function playerBenefitKey(registration) {
  if (registration?.linked_player_id) return `player:${registration.linked_player_id}`;
  const number=memberNumber(registration); if(number)return `aag:${number}`;
  return `name:${String(registration?.display_name||"").toLowerCase().trim()}`;
}

async function loadMonthlyNoPaySuggestions(tournament, registrations) {
  const result=new Map(), members=registrations.filter(isClubMember);
  if(!tournament?.tournament_date||!members.length)return result;
  const date=new Date(`${tournament.tournament_date}T00:00:00`), first=`${date.getFullYear()}-${String(date.getMonth()+1).padStart(2,"0")}-01`, lastDate=new Date(date.getFullYear(),date.getMonth()+1,0), last=`${lastDate.getFullYear()}-${String(lastDate.getMonth()+1).padStart(2,"0")}-${String(lastDate.getDate()).padStart(2,"0")}`;
  const tournamentsResult=await supabase.from("tournaments").select("id,name,tournament_date").gte("tournament_date",first).lte("tournament_date",last);
  if(tournamentsResult.error){console.warn("No se pudo revisar el beneficio mensual",tournamentsResult.error);return result}
  const otherIds=(tournamentsResult.data||[]).map(item=>item.id).filter(id=>String(id)!==String(tournament.id)), tournamentMap=new Map((tournamentsResult.data||[]).map(item=>[String(item.id),item]));
  let used=[];
  if(otherIds.length){const paymentResult=await supabase.from("tournament_payments").select("tournament_id,linked_player_id,aag_member_number,display_name,payment_method").in("tournament_id",otherIds).eq("payment_method","no_pay");if(!paymentResult.error)used=paymentResult.data||[];else console.warn("No se pudo revisar pagos No paga",paymentResult.error)}
  const usedMap=new Map(used.map(payment=>{const key=payment.linked_player_id?`player:${payment.linked_player_id}`:payment.aag_member_number?`aag:${String(payment.aag_member_number).replace(/\.0$/,"")}`:`name:${String(payment.display_name||"").toLowerCase().trim()}`;return[key,{payment,tournament:tournamentMap.get(String(payment.tournament_id))||null}]}));
  for(const member of members){const detail=usedMap.get(playerBenefitKey(member));result.set(String(member.id),{suggestNoPay:!detail,alreadyUsed:!!detail,detail:detail||null})}
  return result;
}

export function buildGroups(bundle) {
  const { registrations, rules } = bundle;
  if (!rules.isPair()) return registrations.map(registration => ({ type: "single", registrations: [registration], key: registration.id }));
  const used = new Set(), groups = [];
  for (const registration of registrations) {
    if (used.has(String(registration.id))) continue;
    const partner = registrations.find(candidate => String(candidate.id) === String(registration.partner_registration_id));
    used.add(String(registration.id));
    if (partner) used.add(String(partner.id));
    groups.push({ type: partner ? "pair" : "single", registrations: partner ? [registration, partner] : [registration], key: partner ? [registration.id, partner.id].sort().join(":") : registration.id });
  }
  return groups;
}

function categorySnapshot(category, rules) {
  return {
    category_name: category?.name || null,
    tee_name: category?.tee_name || (category?.tee_id ? rules.teeName(category.tee_id) : null),
    hole_segment: category?.hole_segment || null,
    slope: category?.slope ?? null,
    course_rating: category?.course_rating ?? null,
    par: category?.par ?? null
  };
}

async function updateRegistration(registration, categoryId, officialIndex) {
  const number = memberNumber(registration);
  const payload = { category_id: categoryId, registration_status: "confirmed", needs_admin_review: false };
  if (number) payload.aag_member_number = number;
  if (officialIndex != null) payload.reported_index = officialIndex;
  const { error } = await supabase.from("registrations").update(payload).eq("id", registration.id);
  if (error) throw error;
  if (registration.line_slot_id) {
    const slotPayload = {};
    if (number) slotPayload.aag_member_number = number;
    if (officialIndex != null) slotPayload.manual_index = officialIndex;
    if (Object.keys(slotPayload).length) {
      const { error: slotError } = await supabase.from("line_slots").update(slotPayload).eq("id", registration.line_slot_id);
      if (slotError) throw slotError;
    }
  }
}

async function upsertScorecard(registration, payload) {
  const existing = getScorecard(registration);
  if (existing?.id) {
    const { hole_scores, ...safePayload } = payload;
    const { error } = await supabase.from("scorecards").update({ ...safePayload, card_status: existing.card_status || "npt" }).eq("id", existing.id);
    if (error) throw error;
    return existing.id;
  }
  const { data, error } = await supabase.from("scorecards").insert({ tournament_id: registration.tournament_id, registration_id: registration.id, linked_player_id: registration.linked_player_id, display_name: registration.display_name, aag_member_number: memberNumber(registration), ...payload }).select("id").single();
  if (error) throw error;
  return data.id;
}

export async function saveSingle(bundle, registration, form = {}) {
  const data = bundle.rules.single(registration, form);
  if (data.error) throw new Error(data.error);
  const line = getLine(registration), category = data.category;
  await upsertScorecard(registration, {
    category_id: category.id,
    tee_id: isNewCategory(category) ? null : category.tee_id || null,
    official_index: data.officialIndex,
    manual_index: data.manualIndex,
    playing_handicap: data.playingHandicap,
    player_1_playing_handicap: null,
    player_2_playing_handicap: null,
    starting_time: line?.line_time || null,
    starting_hole: line?.starting_hole || null,
    card_status: "npt",
    aag_member_number: memberNumber(registration),
    player_gender: normalizeGender(registration?.player?.gender) || null,
    aag_exportable: !!memberNumber(registration),
    hole_scores: emptyHoles(),
    ...categorySnapshot(category, bundle.rules)
  });
  await updateRegistration(registration, category.id, data.officialIndex);
  return data;
}

export async function savePair(bundle, group, forms = []) {
  const [first, second] = group.registrations;
  if (!second) return saveSingle(bundle, first, forms[0]);
  const line = getLine(first) || getLine(second);
  let payload, category, firstData, secondData;
  if (bundle.rules.isClassic()) {
    const data = bundle.rules.classicPair(first, second, { firstIndex: forms[0]?.manualIndex, secondIndex: forms[1]?.manualIndex });
    if (data.error) throw new Error(data.error);
    category = data.category;
    payload = { category_id: category.id, tee_id: isNewCategory(category) ? null : category.tee_id || null, official_index: data.officialIndex, manual_index: data.manualIndex, playing_handicap: data.playingHandicap, player_1_playing_handicap: null, player_2_playing_handicap: null, display_name: `${first.display_name} / ${second.display_name}` };
    firstData = secondData = { category, officialIndex: null };
  } else {
    firstData = bundle.rules.single(first, forms[0]); secondData = bundle.rules.single(second, forms[1]);
    if (firstData.error || secondData.error) throw new Error(firstData.error || secondData.error);
    category = firstData.category;
    payload = { category_id: category.id, tee_id: isNewCategory(category) ? null : category.tee_id || null, official_index: firstData.officialIndex, manual_index: firstData.manualIndex, playing_handicap: firstData.playingHandicap, player_1_playing_handicap: firstData.playingHandicap, player_2_playing_handicap: secondData.playingHandicap, display_name: `${first.display_name} (${firstData.playingHandicap}) / ${second.display_name} (${secondData.playingHandicap})` };
  }
  await upsertScorecard(first, { ...payload, starting_time: line?.line_time || null, starting_hole: line?.starting_hole || null, card_status: "npt", aag_member_number: null, player_gender: null, aag_exportable: false, hole_scores: emptyHoles(), ...categorySnapshot(category, bundle.rules) });
  await updateRegistration(first, firstData.category.id, firstData.officialIndex ?? baseIndex(first));
  await updateRegistration(second, secondData.category.id, secondData.officialIndex ?? baseIndex(second));
  return { firstData, secondData, category };
}

export async function savePayment(bundle, registration, payment) {
  const payload = { tournament_id: bundle.tournament.id, registration_id: registration.id, linked_player_id: registration.linked_player_id || null, display_name: registration.display_name || "Sin nombre", aag_member_number: memberNumber(registration), payment_method: payment.method || "pending", payment_date: payment.date || new Date().toISOString().slice(0, 10), amount: ["pending", "no_pay"].includes(payment.method) ? 0 : Number(payment.amount || 0), concept: payment.concept || "Green fee / derecho de torneo", updated_at: new Date().toISOString() };
  let result = await supabase.from("tournament_payments").upsert(payload, { onConflict: "registration_id" }).select("*").single();
  if (result.error && String(result.error.message || "").toLowerCase().includes("concept")) {
    const { concept, ...withoutConcept } = payload;
    result = await supabase.from("tournament_payments").upsert(withoutConcept, { onConflict: "registration_id" }).select("*").single();
  }
  if (result.error) throw result.error;
  return result.data;
}

export async function saveTournament(tournamentId) {
  const { error } = await supabase.from("tournaments").update({ status: "officialized" }).eq("id", tournamentId);
  if (error) throw error;
}

export async function nextCouponNumber() {
  const branchCode = String(localStorage.getItem("ticket_branch_code") || "").trim();
  if (!branchCode) throw new Error("Esta computadora no tiene configurada la sucursal de cupones.");
  const { data, error } = await supabase.rpc("get_next_ticket_number", { p_branch_code: branchCode });
  if (error) throw error;
  return data;
}

export function isClubMember(registration) {
  const club = String(registration?.club_name || registration?.player?.club_name || "").toLowerCase();
  const clubId = String(registration?.player?.option_club_id || "");
  return clubId === "408" || club.includes("villa maría golf") || club.includes("villa maria golf");
}
