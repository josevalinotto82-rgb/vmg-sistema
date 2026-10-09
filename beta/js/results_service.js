import { categoryFromRules } from "./category_snapshot.js";
import { supabase } from "./supabase.js";

const CARD_FIELDS = "id,tournament_id,registration_id,linked_player_id,display_name,aag_member_number,category_id,category_name,tee_name,official_index,playing_handicap,player_1_playing_handicap,player_2_playing_handicap,gross,net,total,card_status,hole_scores,player_gender,hole_segment,starting_time,starting_hole,created_at";

export function normalizeText(value) {
  return String(value || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/,/g, " ").replace(/\s+/g, " ").trim().toLowerCase();
}

export function normalizeGender(value) {
  const gender = normalizeText(value);
  if (["female", "f", "femenino", "mujer", "dama", "damas"].includes(gender)) return "female";
  if (["male", "m", "masculino", "hombre", "caballero", "caballeros"].includes(gender)) return "male";
  return "";
}

export async function loadResultsWorkspace(tournamentId, { publicOnly = false } = {}) {
  if (!tournamentId) throw new Error("Elegí un torneo desde Inicio.");
  let tournamentQuery = supabase.from("tournaments").select("id,name,tournament_date,status,published,hole_count,scoring_mode,data_schema_version,series_id,series_round_number,special_prizes,game_modes(id,name,participation_type,calculation_params)").eq("id", tournamentId).eq("data_schema_version", 2);
  if(publicOnly) tournamentQuery=tournamentQuery.eq("published",true).in("status",["officialized","archived"]);
  const tournamentResult=await tournamentQuery.single();
  if (tournamentResult.error) throw tournamentResult.error;
  const tournament = tournamentResult.data;
  const [categoriesResult, cardsResult, registrationsResult] = await Promise.all([
    supabase.from("tournament_categories").select("id,category_id,name,display_order,hole_segment,playing_handicap_min,playing_handicap_max,playing_tee_aag_teeout_id,tee_rules").eq("tournament_id", tournamentId).order("display_order"),
    supabase.from("scorecards").select(CARD_FIELDS).eq("tournament_id", tournamentId).order("display_name"),
    supabase.from("registrations").select("id,linked_player_id,display_name,aag_member_number,registration_status,player:players!registrations_linked_player_id_fkey(gender,option_club_id,is_club_member)").eq("tournament_id", tournamentId).neq("registration_status", "cancelled")
  ]);
  if (categoriesResult.error) throw categoriesResult.error;
  if (cardsResult.error) throw cardsResult.error;
  if (registrationsResult.error) throw registrationsResult.error;
  let series = null, rounds = [tournament], seriesCards = cardsResult.data || [];
  if (tournament.series_id) {
    const [seriesResult, roundsResult] = await Promise.all([
      supabase.from("tournament_series").select("id,name,description,required_rounds,scoring_mode,best18_enabled,status").eq("id", tournament.series_id).single(),
      (() => {let query=supabase.from("tournaments").select("id,name,tournament_date,series_round_number,status,special_prizes").eq("series_id", tournament.series_id).eq("data_schema_version", 2);if(publicOnly)query=query.eq("published",true).in("status",["officialized","archived"]);return query.order("series_round_number");})()
    ]);
    if (seriesResult.error) throw seriesResult.error;
    if (roundsResult.error) throw roundsResult.error;
    series = seriesResult.data;
    rounds = roundsResult.data || [];
    const ids = rounds.map(round => round.id);
    if (ids.length) {
      const result = await supabase.from("scorecards").select(CARD_FIELDS).in("tournament_id", ids).order("created_at");
      if (result.error) throw result.error;
      seriesCards = result.data || [];
    }
  }
  return { tournament, categories:(categoriesResult.data || []).map(categoryFromRules), cards:cardsResult.data || [], registrations:registrationsResult.data || [], series, rounds, seriesCards };
}

export function isGross(bundle) { return String(bundle.tournament.scoring_mode || "net") === "gross"; }
export function isAmerican(bundle) { return /americana/i.test(bundle.tournament.game_modes?.name || ""); }
export function isPair(bundle) { return bundle.tournament.game_modes?.participation_type === "pair"; }
export function validCard(card) { return String(card?.card_status || "").toLowerCase() === "valid" && Number(card?.gross) > 0; }
export function statusText(card) { const status=String(card?.card_status || "").toLowerCase(); return status === "desc" ? "DESC" : status === "valid" ? "" : "NPT"; }
export function primaryScore(bundle, card, scratch=false) {
  if (!validCard(card)) return Number.POSITIVE_INFINITY;
  if (scratch || isGross(bundle)) return Number(card.gross) || Number.POSITIVE_INFINITY;
  return Number(card.net ?? card.total ?? card.gross) || Number.POSITIVE_INFINITY;
}

function scoreAt(card, hole) {
  const raw = card?.hole_scores?.[hole] ?? card?.hole_scores?.[String(hole)];
  const value = raw && typeof raw === "object" ? raw.strokes : raw;
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : null;
}

function playableHoles(card) {
  const segment = String(card?.hole_segment || "18").toLowerCase();
  if (["front9", "1-9", "1_9", "9_front"].includes(segment)) return Array.from({length:9}, (_,i)=>i+1);
  if (["back9", "10-18", "10_18", "9_back"].includes(segment)) return Array.from({length:9}, (_,i)=>i+10);
  return Array.from({length:18}, (_,i)=>i+1);
}

function holesValue(bundle, card, holes, divisor, scratch) {
  const values = holes.map(hole => scoreAt(card, hole));
  if (values.some(value => value == null)) return Number.POSITIVE_INFINITY;
  const gross = values.reduce((sum,value)=>sum+value,0);
  if (scratch || isGross(bundle) || isAmerican(bundle)) return gross;
  return gross - (Number(card.playing_handicap) || 0) / divisor;
}

function tieBreakCriteria(card) {
  const active = playableHoles(card);
  if (active.length <= 9) return [
    { holes:active, divisor:2 },
    { holes:active.slice(-6), divisor:3 },
    { holes:active.slice(-3), divisor:6 },
    { holes:active.slice(-1), divisor:18 }
  ];
  const back=active.filter(hole=>hole>=10), front=active.filter(hole=>hole<=9);
  return [
    { holes:back, divisor:2 }, { holes:back.slice(-6), divisor:3 },
    { holes:back.slice(-3), divisor:6 }, { holes:back.slice(-1), divisor:18 },
    { holes:front, divisor:2 }, { holes:front.slice(-6), divisor:3 },
    { holes:front.slice(-3), divisor:6 }, { holes:front.slice(-1), divisor:18 }
  ];
}

export function compareCardTieBreak(bundle, a, b, scratch=false) {
  for (const criterion of tieBreakCriteria(a)) {
    const difference=holesValue(bundle,a,criterion.holes,criterion.divisor,scratch)-holesValue(bundle,b,criterion.holes,criterion.divisor,scratch);
    if (Number.isFinite(difference)&&Math.abs(difference)>.00001) return difference;
  }
  if (isAmerican(bundle)) {
    const gapA=Math.abs((Number(a.player_1_playing_handicap)||0)-(Number(a.player_2_playing_handicap)||0));
    const gapB=Math.abs((Number(b.player_1_playing_handicap)||0)-(Number(b.player_2_playing_handicap)||0));
    if(gapA!==gapB)return gapA-gapB;
  }
  return 0;
}

export function compareCards(bundle, a, b, scratch=false) {
  const validA=validCard(a), validB=validCard(b);
  if (validA !== validB) return validA ? -1 : 1;
  if (!validA) return String(a.display_name).localeCompare(String(b.display_name), "es");
  const main = primaryScore(bundle,a,scratch)-primaryScore(bundle,b,scratch);
  if (main) return main;
  const tieBreak=compareCardTieBreak(bundle,a,b,scratch);
  if(tieBreak)return tieBreak;
  return String(a.display_name).localeCompare(String(b.display_name), "es");
}

export function categoryForCard(bundle, card) {
  return bundle.categories.find(category => String(category.id) === String(card.category_id)) || bundle.categories.find(category => normalizeText(category.name) === normalizeText(card.category_name)) || null;
}

export function scratchEligible(card, gender) {
  if (!validCard(card) || normalizeGender(card.player_gender) !== gender) return false;
  const index = Number(card.official_index);
  if (!Number.isFinite(index)) return false;
  return index >= -10 && index <= 9;
}

export async function saveResultsConfiguration(tournamentId, specialPrizes) {
  const result = await supabase.from("tournaments").update({ special_prizes: specialPrizes }).eq("id", tournamentId).eq("data_schema_version", 2).select("special_prizes").single();
  if (result.error) throw result.error;
  return result.data.special_prizes || {};
}

function seriesKey(card) { return card.linked_player_id || card.aag_member_number || normalizeText(card.display_name); }

export function aggregateSeries(bundle) {
  const roundMap = new Map(bundle.rounds.map(round => [round.id, round]));
  const groups = new Map();
  for (const card of bundle.seriesCards) {
    const key=seriesKey(card); if(!groups.has(key))groups.set(key,{key,display_name:card.display_name,aag_member_number:card.aag_member_number,player_gender:card.player_gender,official_index:card.official_index,category_id:card.category_id,category_name:card.category_name,tee_name:card.tee_name,cards:[]});
    const group=groups.get(key); group.cards.push(card);
    const currentRound=Number(roundMap.get(card.tournament_id)?.series_round_number||0),previousRound=Number(roundMap.get(group.latest?.tournament_id)?.series_round_number||-1); if(currentRound>=previousRound){group.latest=card;Object.assign(group,{display_name:card.display_name,player_gender:card.player_gender,official_index:card.official_index,category_id:card.category_id,category_name:card.category_name,tee_name:card.tee_name});}
  }
  return [...groups.values()].map(group=>{
    const valid=group.cards.filter(validCard).sort((a,b)=>Number(roundMap.get(a.tournament_id)?.series_round_number||0)-Number(roundMap.get(b.tournament_id)?.series_round_number||0));
    group.roundValues=bundle.rounds.map(round=>{const card=valid.find(item=>item.tournament_id===round.id);return card?primaryScore(bundle,card,false):null});
    group.roundGross=bundle.rounds.map(round=>{const card=valid.find(item=>item.tournament_id===round.id);return card?primaryScore(bundle,card,true):null});
    group.total=group.roundValues.some(Number.isFinite)?group.roundValues.filter(Number.isFinite).reduce((a,b)=>a+b,0):Number.POSITIVE_INFINITY;
    group.grossTotal=group.roundGross.some(Number.isFinite)?group.roundGross.filter(Number.isFinite).reduce((a,b)=>a+b,0):Number.POSITIVE_INFINITY;
    group.validRounds=valid.length; return group;
  });
}

function roundNumber(bundle, card) {
  return Number(bundle.rounds.find(round=>round.id===card.tournament_id)?.series_round_number||0);
}

export function compareSeriesItems(bundle, a, b, scratch=false, prioritizeRounds=false) {
  if (prioritizeRounds && a.validRounds !== b.validRounds) return b.validRounds-a.validRounds;
  const totalA=scratch?a.grossTotal:a.total,totalB=scratch?b.grossTotal:b.total;
  if (Math.abs(totalA-totalB)>.00001) return totalA-totalB;
  const cardsA=[...a.cards].filter(validCard).sort((x,y)=>roundNumber(bundle,y)-roundNumber(bundle,x));
  const cardsB=[...b.cards].filter(validCard).sort((x,y)=>roundNumber(bundle,y)-roundNumber(bundle,x));
  for(let index=0;index<Math.min(cardsA.length,cardsB.length);index++){
    const difference=primaryScore(bundle,cardsA[index],scratch)-primaryScore(bundle,cardsB[index],scratch);
    if(Math.abs(difference)>.00001)return difference;
  }
  if(cardsA[0]&&cardsB[0]){
    const holes=compareCardTieBreak(bundle,cardsA[0],cardsB[0],scratch);
    if(holes)return holes;
  }
  return String(a.display_name).localeCompare(String(b.display_name),"es");
}
