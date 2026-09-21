import { baseIndex, getLine, getScorecard, isNewCategory, memberNumber, toNumber, visibleTeeName } from "./officialization_rules_beta.js";
import { escapeHtml, formatDate } from "./ui_beta.js";

const HOLE_LEFT = {1:32.5,2:39,3:46,4:52.5,5:59.5,6:66.5,7:73,8:80,9:86,10:102,11:108.5,12:115,13:122,14:128.5,15:135,16:141.5,17:148,18:155};
const text = value => escapeHtml(String(value ?? ""));
const timeText = value => value ? String(value).slice(0,5) : "—";
const fontPlayer = value => String(value || "").length > 38 ? 10 : String(value || "").length > 30 ? 11 : 12;
const fontTournament = value => String(value || "").length > 35 ? 12 : String(value || "").length > 24 ? 15 : 24;
const teeText = value => [...new Set(String(value || "").split("/").map(item => visibleTeeName(item)).filter(item => item && item !== "—"))].join(" / ") || "—";

function holeLabel(line) {
  const label = String(line?.label || "").trim();
  if (label) return /hoyo/i.test(label) ? label : `Hoyo ${label}`;
  return line?.starting_hole ? `Hoyo ${line.starting_hole}` : "—";
}

function teeIdFromScore(bundle, category, score) {
  if (!isNewCategory(category)) return category?.tee_id || "";
  const name = String(score?.tee_name || "").trim().toLowerCase();
  const match = (category?.tee_rules || []).find(rule => String(rule?.reference?.tee_name || "").trim().toLowerCase() === name);
  return match?.aag_teeout_id || "";
}

function singleData(bundle, registration) {
  const score = getScorecard(registration), raw = baseIndex(registration);
  const category = bundle.categories.find(item => String(item.id) === String(score?.category_id || registration.category_id)) || bundle.rules.suggestCategory(raw, registration?.player?.gender, bundle.rules.isAmericana() ? "americana" : "medal");
  const calculated = bundle.rules.single(registration, { categoryId: category?.id, teeId: teeIdFromScore(bundle, category, score), manualIndex: score?.manual_index ?? raw });
  return calculated.error ? { error: calculated.error, score, category } : { ...calculated, score };
}

function strokesOnHole(handicap, holeHandicap) {
  const hcp = Number(handicap || 0), order = Number(holeHandicap || 0);
  if (!hcp || !order) return "";
  const absolute = Math.abs(hcp), base = Math.floor(absolute / 18), remainder = absolute % 18;
  const strokes = hcp > 0 ? base + (order <= remainder ? 1 : 0) : base + (order >= 19 - remainder ? 1 : 0);
  if (!strokes) return "";
  return hcp > 0 ? String(Math.min(strokes,3)) : `+${Math.min(strokes,3)}`;
}

function holeHandicap(category, hole) {
  const holes = category?.tee_rule?.reference?.holes || category?.tee_reference?.holes || [];
  const found = holes.find(item => Number(item?.hole ?? item?.HoleNumber) === Number(hole));
  return toNumber(found?.handicap ?? found?.Handicap);
}

function americanaMarks(firstHandicap, secondHandicap, firstCategory, secondCategory) {
  let html = "";
  for (let hole=1; hole<=18; hole++) {
    const first = strokesOnHole(firstHandicap, holeHandicap(firstCategory, hole));
    const second = strokesOnHole(secondHandicap, holeHandicap(secondCategory, hole));
    if (first) html += `<div class="tj-hole-stroke" style="left:${HOLE_LEFT[hole]}mm;top:125mm">${text(first)}</div>`;
    if (second) html += `<div class="tj-hole-stroke" style="left:${HOLE_LEFT[hole]}mm;top:133mm">${text(second)}</div>`;
  }
  return html;
}

function cardHtml({ bundle, players, handicap="", index="", tee="—", marks="" }) {
  const line = getLine(players[0]) || getLine(players[1]), pair = players.length > 1;
  const names = players.map(player => String(player.display_name || "").trim().replace(/\s+/g," "));
  const numbers = players.map(player => memberNumber(player) || "—").join("/");
  const details = `${timeText(line?.line_time)} hs. / Tee: ${teeText(tee)} / ${holeLabel(line)}`;
  if (bundle.rules.isGross()) { handicap = ""; index = ""; marks = ""; }
  return `<div class="tarjeta-page"><div class="tarjeta-landscape"><div class="tj-field tj-tournament" style="font-size:${fontTournament(bundle.tournament.name)}px">${text(bundle.tournament.name)}</div><div class="tj-field tj-date">${text(formatDate(bundle.tournament.tournament_date))}</div><div class="tj-field ${pair?"tj-player-pair":"tj-player-single"}" style="font-size:${fontPlayer(names[0])}px">${text(names[0])}</div>${pair?`<div class="tj-field tj-player-two" style="font-size:${fontPlayer(names[1])}px">${text(names[1])}</div>`:""}<div class="tj-field tj-handicap">${text(handicap)}</div><div class="tj-field tj-number">${text(numbers)}</div><div class="tj-field tj-index">${index?`(${text(index)})<br>INDEX`:""}</div><div class="tj-field tj-details">${text(details)}</div>${marks}</div></div>`;
}

export function printableGroup(bundle, group) {
  if (group.type === "pair" && bundle.rules.isClassic()) {
    const result = bundle.rules.classicPair(group.registrations[0], group.registrations[1]);
    if (result.error) throw new Error(result.error);
    const tees = [result.firstPlayingTee?.tee_name, result.secondPlayingTee?.tee_name].filter(Boolean).join("/");
    return cardHtml({ bundle, players:group.registrations, handicap:result.playingHandicap, index:group.registrations.map(player => baseIndex(player) ?? "—").join("/"), tee:tees || result.category?.tee_name });
  }
  if (group.type === "pair" && bundle.rules.isAmericana()) {
    const first = singleData(bundle, group.registrations[0]), second = singleData(bundle, group.registrations[1]);
    if (first.error || second.error) throw new Error(first.error || second.error);
    return cardHtml({ bundle, players:group.registrations, handicap:`${first.playingHandicap}/${second.playingHandicap}`, index:group.registrations.map(player => baseIndex(player) ?? "—").join("/"), tee:first.category?.tee_name === second.category?.tee_name ? first.category?.tee_name : `${visibleTeeName(first.category?.tee_name)}/${visibleTeeName(second.category?.tee_name)}`, marks:americanaMarks(first.playingHandicap,second.playingHandicap,first.category,second.category) });
  }
  const result = singleData(bundle, group.registrations[0]);
  if (result.error) throw new Error(result.error);
  return cardHtml({ bundle, players:group.registrations, handicap:result.playingHandicap, index:baseIndex(group.registrations[0]) ?? "", tee:result.category?.tee_name });
}

export function preprintedCardCss() {
  return `<style>@page{size:A4 portrait;margin:0}@media print{html,body{margin:0!important;padding:0!important;width:210mm!important;background:#fff!important}.topbar,[data-app-shell],main,.drawer,.toast{display:none!important}#printRoot{display:block!important;position:absolute!important;inset:0 auto auto 0;width:210mm!important;margin:0!important;padding:0!important;background:#fff!important}}.tarjeta-page{position:relative;width:210mm;height:297mm;margin:0;padding:0;overflow:hidden;background:#fff;page-break-after:always;break-after:page}.tarjeta-page:last-child{page-break-after:auto;break-after:auto}.tarjeta-landscape{position:absolute;width:297mm;height:210mm;left:0;top:297mm;transform-origin:top left;transform:rotate(-90deg);font-family:Arial,sans-serif;color:#000}.tj-field{position:absolute;height:7mm;line-height:7mm;font-weight:700;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.tj-tournament{left:34mm;top:39mm;width:70mm;text-align:center}.tj-date{left:107mm;top:39mm;width:25mm;text-align:center;font-size:18px}.tj-player-pair{left:34mm;top:54mm;width:50mm}.tj-player-single{left:34mm;top:54mm;width:70mm}.tj-player-two{left:85mm;top:54mm;width:50mm;text-align:right}.tj-handicap{left:136mm;top:54mm;width:27mm;text-align:center;font-size:15px}.tj-number{left:170mm;top:54mm;width:27mm;text-align:center;font-size:14px}.tj-index{left:120mm;top:39mm;width:60mm;text-align:center;font-size:14px;line-height:1.05}.tj-details{left:99mm;top:67mm;width:100mm;text-align:center;font-size:18px}.tj-hole-stroke{position:absolute;width:4mm;height:3mm;line-height:3mm;font-size:8px;font-weight:700;text-align:center}</style>`;
}

export function printPreprintedCards(root, htmlCards) {
  root.innerHTML = preprintedCardCss() + htmlCards.join("");
  document.body.classList.add("printing-scorecards");
  setTimeout(() => window.print(), 100);
  setTimeout(() => { document.body.classList.remove("printing-scorecards"); root.innerHTML=""; }, 1200);
}
