import { requireSession } from "./auth_beta.js";
import { mountShell, getActiveTournament, setActiveTournament } from "./shell_beta.js";
import { escapeHtml, formatDate, notify, setBusy, showState, confirmAction } from "./ui_beta.js";
import { listOfficializationTournaments, loadOfficialization, buildGroups, saveSingle, savePair, savePayment, saveTournament, nextCouponNumber, isClubMember } from "./officialization_service_beta.js";
import { baseIndex, getLine, getScorecard, hasOfficialIndex, isNewCategory, memberNumber, normalizeGender, toNumber, visibleTeeName } from "./officialization_rules_beta.js";
import { printableGroup, printPreprintedCards } from "./officialization_print_beta.js";
import { supabase } from "./supabase_beta.js";

const PAYMENT_METHODS = { pending: "Pendiente", cash: "Efectivo", credit_card: "Tarjeta crédito", debit_card: "Tarjeta débito", transfer: "Transferencia", current_account: "Cuenta corriente", no_pay: "No paga" };
const context = await requireSession({ admin: true });
mountShell({ context, activeStep: 2 });

const byId = id => document.getElementById(id);
const pageState = byId("pageState"), tableWrap = byId("playersTableWrap"), rowsHost = byId("playerRows");
const playerDrawer = byId("playerDrawer"), paymentsDrawer = byId("paymentsDrawer");
let tournaments = [], bundle = null, groups = [], activeGroup = null, currentFilter = "all", realtimeChannel = null, realtimeTimer = null;

function initials(name) { return String(name || "?").split(/[ ,]+/).filter(Boolean).slice(0, 2).map(part => part[0]).join(""); }
function timeText(value) { return value ? String(value).slice(0, 5) : "—"; }
function money(value) { return Number(value || 0).toLocaleString("es-AR", { style: "currency", currency: "ARS", minimumFractionDigits: 2 }); }
function priceKey(registration) { return `${isClubMember(registration) ? "precio_torneo" : "precio_torneo_invitado"}_${bundle.tournament.id}`; }
function priceInputValue(id) { return parseArgentineNumber(byId(id)?.value); }
function formatMoneyInput(id, value) { const input=byId(id); if(input) input.value=Number(value||0)>0?money(value):""; }
function loadTournamentPrices(){formatMoneyInput("memberPrice",localStorage.getItem(`precio_torneo_${bundle.tournament.id}`));formatMoneyInput("guestPrice",localStorage.getItem(`precio_torneo_invitado_${bundle.tournament.id}`));}
function saveTournamentPrices(){localStorage.setItem(`precio_torneo_${bundle.tournament.id}`,String(priceInputValue("memberPrice")));localStorage.setItem(`precio_torneo_invitado_${bundle.tournament.id}`,String(priceInputValue("guestPrice")));}
function searchText(value) { return String(value || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase(); }
function statusLabel(value) { return ({ ready: "Listo", review: "Revisar", pending: "Pendiente" })[value] || value; }
function statusClass(value) { return value === "ready" ? "open" : value === "review" ? "danger" : "pending"; }
function scorecardForGroup(group) { return group.registrations.map(getScorecard).find(Boolean) || null; }

function savedTeeId(category, score) {
  if (!category || !score || !isNewCategory(category)) return category?.tee_id || "";
  const savedName=searchText(score.tee_name);
  return (category.tee_rules||[]).find(rule=>searchText(rule?.reference?.tee_name)===savedName)?.aag_teeout_id||"";
}

function singlePreview(registration) {
  const score=getScorecard(registration),rawIndex=baseIndex(registration);
  const automatic=bundle.rules.suggestCategory(rawIndex,registration?.player?.gender,bundle.rules.isAmericana()?"americana":"medal");
  const categoryId=score?.category_id||automatic?.id||registration?.category_id;
  const category=bundle.categories.find(item=>String(item.id)===String(categoryId))||automatic;
  const result=bundle.rules.single(registration,{categoryId:category?.id,teeId:savedTeeId(category,score),manualIndex:score?.manual_index??rawIndex});
  return result.error?{error:result.error,category:category||null,playingHandicap:null}:{...result,error:null};
}

function groupPreview(group) {
  if(group.type==="pair"&&bundle.rules.isClassic()){const result=bundle.rules.classicPair(...group.registrations);return result.error?{error:result.error,category:null,handicap:"—",tees:[]}:{category:result.category,handicap:result.playingHandicap,error:null,calculated:result,tees:[result.firstPlayingTee,result.secondPlayingTee]}}
  const values=group.registrations.map(singlePreview),error=values.find(item=>item.error)?.error||null;
  return {error,category:values[0]?.category||null,handicap:group.type==="pair"?values.map(item=>item.playingHandicap??"—").join(" / "):values[0]?.playingHandicap??"—",values,tees:values.map(item=>item.category)};
}

function teeNames(preview) {
  return [...new Set((preview?.tees || []).map(item => visibleTeeName(item?.tee_name)).filter(name => name && name !== "—"))];
}

function groupStatus(group) {
  if (scorecardForGroup(group)?.id) return "ready";
  if (group.registrations.some(reg => reg.needs_admin_review || (baseIndex(reg) == null && !bundle.rules.isGross()))) return "review";
  return "pending";
}

function groupCategory(group) {
  return groupPreview(group).category;
}

function groupSortValue(group) {
  const line = getLine(group.registrations[0]);
  const time = String(line?.line_time || "99:99");
  const hole = Number(line?.starting_hole || 99);
  return `${time}-${String(hole).padStart(2, "0")}-${group.registrations[0]?.display_name || ""}`;
}

function renderTournamentStrip() {
  const ready = groups.filter(group => groupStatus(group) === "ready").length;
  const scorecards = bundle.scorecards.length;
  const paid = bundle.payments.filter(payment => !["pending", "no_pay"].includes(payment.payment_method)).length;
  const mode = bundle.rules.isGross() ? "Gross" : (bundle.tournament.game_modes?.name || "Modalidad");
  byId("tournamentStrip").innerHTML = `<section class="tournament-strip"><div class="tournament-main"><span class="status ${bundle.tournament.status === "officialized" ? "open" : "pending"}">${bundle.tournament.status === "officialized" ? "Guardado" : "Abierto"}</span><h2>${escapeHtml(bundle.tournament.name)}</h2><div class="meta">${formatDate(bundle.tournament.tournament_date)} · ${escapeHtml(mode)} · ${bundle.tournament.hole_count} hoyos</div></div><div class="metric"><strong>${bundle.registrations.length}</strong><span>Inscriptos</span></div><div class="metric"><strong>${ready}/${groups.length}</strong><span>Filas listas</span></div><div class="metric"><strong>${scorecards}</strong><span>Tarjetas creadas</span></div><div class="metric"><strong>${paid}</strong><span>Pagos asentados</span></div></section>`;
}

function rowNames(group) {
  return group.registrations.map(reg => {const benefit=bundle.noPayMap?.get(String(reg.id)),payment=bundle.paymentMap.get(String(reg.id));const badge=payment?.payment_method==="no_pay"?'<small class="benefit-badge ok">No paga</small>':benefit?.suggestNoPay?'<small class="benefit-badge">1.er torneo</small>':benefit?.alreadyUsed?'<small class="benefit-badge used">Beneficio usado</small>':"";return `<div class="player"><span class="player-avatar">${escapeHtml(initials(reg.display_name))}</span><span>${escapeHtml(reg.display_name)}<small class="subtle" style="display:block">Matr. ${escapeHtml(memberNumber(reg) || "—")}</small>${badge}</span></div>`}).join('<div class="pair-divider">con</div>');
}

function rowPayment(group) {
  const methods = group.registrations.map(reg => bundle.paymentMap.get(String(reg.id))?.payment_method || "pending");
  const unique = [...new Set(methods)];
  return unique.length === 1 ? PAYMENT_METHODS[unique[0]] : "Pago individual";
}

function renderRows() {
  const query = searchText(byId("playerSearch").value);
  const visible = [...groups].sort((a, b) => groupSortValue(a).localeCompare(groupSortValue(b))).filter(group => {
    const status = groupStatus(group);
    const haystack = searchText(group.registrations.map(reg => `${reg.display_name} ${memberNumber(reg) || ""} ${reg.club_name || reg.player?.club_name || ""} ${getLine(reg)?.line_time || ""} ${getLine(reg)?.starting_hole || ""}`).join(" "));
    return (!query || haystack.includes(query)) && (currentFilter === "all" || currentFilter === status);
  });
  rowsHost.innerHTML = visible.map(group => {
    const status = groupStatus(group), score = scorecardForGroup(group), preview=groupPreview(group), category = preview.category, line = getLine(group.registrations[0]);
    const indexes = group.registrations.map(reg => baseIndex(reg)).map(value => value == null || bundle.rules.isGross() ? "—" : Number(value).toFixed(1)).join(" / ");
    const handicap = bundle.rules.isGross() ? "—" : preview.handicap;
    const names=teeNames(preview),teeName = names[0] || score?.tee_name || category?.tee_name || (category?.tee_id ? bundle.rules.teeName(category.tee_id) : "—");
    const teesLine=names.length?`<small class="subtle" style="display:block">Tee: ${escapeHtml(names.join(" / "))}</small>`:"";
    return `<tr><td>${rowNames(group)}</td><td><b>${timeText(line?.line_time)}</b><small class="subtle" style="display:block">Hoyo ${escapeHtml(line?.starting_hole || "—")}${line?.label ? ` · ${escapeHtml(line.label)}` : ""}</small></td><td><span class="tee-dot ${teeClass(teeName)}"></span> ${escapeHtml(category?.name || score?.category_name || "Sin asignar")}${teesLine}</td><td>${indexes}</td><td>${handicap}</td><td>${escapeHtml(rowPayment(group))}</td><td><span class="status ${statusClass(status)}">${statusLabel(status)}</span></td><td><button class="btn secondary small" data-review="${escapeHtml(group.key)}">Revisar</button></td></tr>`;
  }).join("") || `<tr><td colspan="8"><div class="empty-state compact">No hay jugadores que coincidan con el filtro.</div></td></tr>`;
  rowsHost.querySelectorAll("[data-review]").forEach(button => button.addEventListener("click", () => openGroup(groups.find(group => group.key === button.dataset.review))));
  const ready = groups.filter(group => groupStatus(group) === "ready").length, review = groups.filter(group => groupStatus(group) === "review").length, pending = groups.length - ready - review;
  byId("playersSummary").textContent = `${ready} listos · ${pending} pendientes · ${review} para revisar`;
  byId("attentionStatus").textContent = review + pending ? `${review + pending} requieren atención` : "Todo listo";
  byId("attentionStatus").className = `status ${review + pending ? "pending" : "open"}`;
}

function teeClass(name) {
  const value = searchText(name);
  if (value.includes("negr")) return "black";
  if (value.includes("amar")) return "yellow";
  if (value.includes("roj")) return "red";
  return "white";
}

function categoryOptions(registration, selectedId) {
  const categories=bundle.categories.some(isNewCategory)?bundle.categories:bundle.categories.filter(category=>bundle.rules.categoryMatchesGender(category,registration?.player?.gender));
  return categories.map(category => `<option value="${category.id}" ${String(category.id) === String(selectedId || "") ? "selected" : ""}>${escapeHtml(category.name)}</option>`).join("");
}

function teeOptions(registration, category, selectedTee = "") {
  if (!category) return '<option value="">Sin tee</option>';
  if (!isNewCategory(category)) return `<option value="${category.tee_id || ""}">${escapeHtml(bundle.rules.teeName(category.tee_id))}</option>`;
  return bundle.rules.rulesForGender(category, registration?.player?.gender).map(rule => `<option value="${escapeHtml(rule.aag_teeout_id)}" ${String(rule.aag_teeout_id) === String(selectedTee || "") ? "selected" : ""}>${escapeHtml(visibleTeeName(rule.reference?.tee_name))}</option>`).join("") || '<option value="">Sin tee compatible</option>';
}

function playerEditor(registration, index, { compact = false } = {}) {
  const score = getScorecard(registration), rawIndex = baseIndex(registration);
  const preview=singlePreview(registration),suggested=preview.category;
  const adjustedIndex = suggested ? bundle.rules.adjustedIndex(rawIndex, suggested.hole_segment) : rawIndex;
  const resolved = suggested ? bundle.rules.resolveCategory(suggested, adjustedIndex, registration?.player?.gender) : null;
  const teeId = savedTeeId(suggested,score) || resolved?.aag_teeout_id || suggested?.tee_id || "";
  const classicLocked = activeGroup?.type === "pair" && bundle.rules.isClassic();
  return `<section class="drawer-player-block" data-player-form="${index}"><div class="drawer-player-heading"><span class="player-avatar">${escapeHtml(initials(registration.display_name))}</span><div><strong>${escapeHtml(registration.display_name)}</strong><small>Matr. ${escapeHtml(memberNumber(registration) || "—")} · ${escapeHtml(registration.club_name || registration.player?.club_name || "Club sin informar")}</small></div></div>${preview.error?`<div class="notice warn" style="margin-bottom:10px">${escapeHtml(preview.error)}</div>`:""}<div class="field-grid ${compact ? "drawer-compact-grid" : ""}"><div class="field"><label>Index AAG</label><input class="control" value="${rawIndex == null || bundle.rules.isGross() ? "—" : Number(rawIndex).toFixed(1)}" readonly></div><div class="field"><label>Index manual</label><input class="control" data-manual-index value="${bundle.rules.isGross() ? "—" : rawIndex == null ? "" : Number(rawIndex).toFixed(1)}" ${hasOfficialIndex(registration) || bundle.rules.isGross() ? "readonly" : ""}></div><div class="field full"><label>Categoría</label><select class="control" data-category ${classicLocked?"disabled":""}>${categoryOptions(registration, suggested?.id)}</select></div><div class="field"><label>Tee</label><select class="control" data-tee ${classicLocked?"disabled":""}>${teeOptions(registration, suggested, teeId)}</select></div><div class="field"><label>HCP de juego</label><input class="control" data-playing-hcp value="${bundle.rules.isGross() ? "—" : preview.playingHandicap ?? ""}" readonly></div></div></section>`;
}

function paymentFields(registration) {
  const payment = bundle.paymentMap.get(String(registration.id)) || {};
  const benefit=bundle.noPayMap?.get(String(registration.id)),suggestedMethod=payment.payment_method||(benefit?.suggestNoPay?"no_pay":"cash"),defaultPrice = suggestedMethod==="no_pay"?0:(localStorage.getItem(priceKey(registration)) || "0");
  const benefitNotice=!payment.payment_method&&benefit?.suggestNoPay?'<div class="notice success benefit-notice">Sugerencia automática: socio VMGC en su primer torneo del mes. Se propone <b>No paga</b>, pero podés cambiarlo.</div>':!payment.payment_method&&benefit?.alreadyUsed?`<div class="notice warn benefit-notice">Este socio ya utilizó el beneficio mensual${benefit.detail?.tournament?.name?` en ${escapeHtml(benefit.detail.tournament.name)}`:""}.</div>`:"";
  return `<section class="drawer-section"><div class="drawer-section-title">Pago y cupón</div>${benefitNotice}${activeGroup.registrations.length > 1 ? `<div class="field"><label>Jugador que paga</label><select class="control" id="paymentPlayer">${activeGroup.registrations.map(reg => `<option value="${reg.id}" ${reg.id === registration.id ? "selected" : ""}>${escapeHtml(reg.display_name)}</option>`).join("")}</select></div>` : ""}<div class="field-grid"><div class="field"><label>Forma de pago</label><select class="control" id="paymentMethod">${Object.entries(PAYMENT_METHODS).map(([value, label]) => `<option value="${value}" ${value === suggestedMethod ? "selected" : ""}>${label}</option>`).join("")}</select></div><div class="field"><label>Importe</label><input class="control" id="paymentAmount" inputmode="decimal" value="${payment.amount ?? defaultPrice}"></div><div class="field"><label>Fecha</label><input class="control" id="paymentDate" type="date" value="${payment.payment_date || new Date().toISOString().slice(0, 10)}"></div><div class="field"><label>Concepto</label><input class="control" id="paymentConcept" value="${escapeHtml(payment.concept || "Green fee / derecho de torneo")}"></div></div></section>`;
}

function classicCalculationHtml(calculated) {
  if (calculated?.error) return `<div class="notice warn">${escapeHtml(calculated.error)}</div>`;
  const tees=[...new Set([calculated?.firstPlayingTee,calculated?.secondPlayingTee].map(item=>visibleTeeName(item?.tee_name)).filter(name=>name&&name!=="—"))];
  return `<div class="score-summary"><div class="score-box"><strong>${calculated?.playingHandicap ?? "—"}</strong><span>HCP pareja</span></div><div class="score-box"><strong>${escapeHtml(calculated?.category?.name || "—")}</strong><span>Categoría</span></div><div class="score-box"><strong>${escapeHtml(tees.join(" / ") || "—")}</strong><span>Tee${tees.length>1?"s":""} de juego</span></div></div><p class="subtle" style="margin-top:10px">Brecha máxima de 5 golpes de cancha y 3/8 de la suma ajustada. Las damas conservan su tee de cálculo.</p>`;
}

function recalculateClassic() {
  if (!activeGroup || activeGroup.type !== "pair" || !bundle.rules.isClassic()) return;
  const forms = activeGroup.registrations.map((_, index) => formData(index));
  const calculated = bundle.rules.classicPair(activeGroup.registrations[0], activeGroup.registrations[1], { firstIndex: forms[0]?.manualIndex, secondIndex: forms[1]?.manualIndex });
  const host = byId("classicCalculation");
  if (host) host.innerHTML = classicCalculationHtml(calculated);
}

function openGroup(group) {
  if (!group) return;
  activeGroup = group;
  byId("drawerTitle").textContent = group.type === "pair" ? "Administrar pareja" : "Administrar jugador";
  const status = groupStatus(group);
  let body = `<div class="notice ${status === "review" ? "warn" : status === "ready" ? "success" : ""}">Estado actual: <strong>${statusLabel(status)}</strong>${bundle.rules.isGross() ? " · Torneo Gross: no se calcula Index ni HCP." : ""}</div>`;
  if (group.type === "pair" && bundle.rules.isClassic()) {
    const calculated = bundle.rules.classicPair(...group.registrations);
    body += group.registrations.map((reg, index) => playerEditor(reg, index, { compact: true })).join("") + `<section class="drawer-section pair-calculation"><div class="drawer-section-title">Cálculo Fourball Clásico</div><div id="classicCalculation">${classicCalculationHtml(calculated)}</div></section>`;
  } else body += group.registrations.map((reg, index) => playerEditor(reg, index)).join("");
  body += paymentFields(group.registrations[0]);
  byId("drawerContent").innerHTML = body;
  bindDrawerCalculations();
  playerDrawer.classList.add("open"); playerDrawer.setAttribute("aria-hidden", "false");
}

function formData(index) {
  const host = byId("drawerContent").querySelector(`[data-player-form="${index}"]`);
  return { categoryId: host?.querySelector("[data-category]")?.value || null, teeId: host?.querySelector("[data-tee]")?.value || "", manualIndex: toNumber(host?.querySelector("[data-manual-index]")?.value) };
}

function recalculateForm(index) {
  const registration = activeGroup?.registrations[index], host = byId("drawerContent").querySelector(`[data-player-form="${index}"]`);
  if (!registration || !host) return;
  if (activeGroup.type === "pair" && bundle.rules.isClassic()) { recalculateClassic(); return; }
  const category = bundle.categories.find(item => String(item.id) === String(host.querySelector("[data-category]")?.value));
  const tee = host.querySelector("[data-tee]");
  if (tee && category) tee.innerHTML = teeOptions(registration, category, tee.value);
  const result = bundle.rules.single(registration, formData(index));
  host.querySelector("[data-playing-hcp]").value = bundle.rules.isGross() ? "—" : result.error ? "Revisar" : result.playingHandicap;
}

function bindDrawerCalculations() {
  byId("drawerContent").querySelectorAll("[data-player-form]").forEach(host => {
    const index = Number(host.dataset.playerForm);
    host.querySelector("[data-category]")?.addEventListener("change", () => recalculateForm(index));
    host.querySelector("[data-tee]")?.addEventListener("change", () => recalculateForm(index));
    host.querySelector("[data-manual-index]")?.addEventListener("input", event => {if(!(activeGroup.type==="pair"&&bundle.rules.isClassic())){const registration=activeGroup.registrations[index],suggested=bundle.rules.suggestCategory(toNumber(event.target.value),registration?.player?.gender,bundle.rules.isAmericana()?"americana":"medal"),select=host.querySelector("[data-category]");if(suggested?.id&&select)select.value=suggested.id}recalculateForm(index)});
    recalculateForm(index);
  });
  byId("paymentPlayer")?.addEventListener("change", event => {
    const registration = activeGroup.registrations.find(reg => String(reg.id) === String(event.target.value));
    const payment = bundle.paymentMap.get(String(registration.id)) || {};
    const benefit=bundle.noPayMap?.get(String(registration.id)),method=payment.payment_method||(benefit?.suggestNoPay?"no_pay":"cash");
    byId("paymentMethod").value = method;
    byId("paymentAmount").value = payment.amount ?? (method==="no_pay"?0:localStorage.getItem(priceKey(registration)) ?? 0);
    byId("paymentDate").value = payment.payment_date || new Date().toISOString().slice(0, 10);
  });
  byId("paymentMethod")?.addEventListener("change", event => { const method=event.target.value,registration=selectedPaymentRegistration();byId("paymentAmount").value=["pending","no_pay"].includes(method)?0:(bundle.paymentMap.get(String(registration.id))?.amount??localStorage.getItem(priceKey(registration))??0); });
}

function selectedPaymentRegistration() { return activeGroup.registrations.find(reg => String(reg.id) === String(byId("paymentPlayer")?.value)) || activeGroup.registrations[0]; }
function readPayment() { return { method: byId("paymentMethod")?.value || "pending", amount: parseArgentineNumber(byId("paymentAmount")?.value), date: byId("paymentDate")?.value, concept: byId("paymentConcept")?.value }; }
function parseArgentineNumber(value) { const normalized = String(value || "0").replace(/\$/g, "").replace(/\s/g, "").replace(/\./g, "").replace(",", "."); return Number(normalized) || 0; }

async function persistActiveGroup({ payment = true } = {}) {
  if (!activeGroup) throw new Error("No hay jugador seleccionado.");
  const forms = activeGroup.registrations.map((_, index) => formData(index));
  if (activeGroup.type === "pair") await savePair(bundle, activeGroup, forms); else await saveSingle(bundle, activeGroup.registrations[0], forms[0]);
  if (payment) await savePayment(bundle, selectedPaymentRegistration(), readPayment());
}

async function reloadActive() {
  bundle = await loadOfficialization(bundle.tournament.id); groups = buildGroups(bundle); renderAll();
}

function scheduleRealtimeReload(){clearTimeout(realtimeTimer);realtimeTimer=setTimeout(()=>{const editing=playerDrawer.classList.contains("open")||paymentsDrawer.classList.contains("open")||document.activeElement?.matches("input,select,textarea");if(!editing)reloadActive().catch(console.warn)},500)}
function subscribeTournament(tournamentId){if(realtimeChannel)supabase.removeChannel(realtimeChannel);realtimeChannel=supabase.channel(`adm-torneo-beta-${tournamentId}`).on("postgres_changes",{event:"*",schema:"public",table:"registrations",filter:`tournament_id=eq.${tournamentId}`},scheduleRealtimeReload).on("postgres_changes",{event:"*",schema:"public",table:"scorecards",filter:`tournament_id=eq.${tournamentId}`},scheduleRealtimeReload).on("postgres_changes",{event:"*",schema:"public",table:"tournament_payments",filter:`tournament_id=eq.${tournamentId}`},scheduleRealtimeReload).on("postgres_changes",{event:"*",schema:"public",table:"players"},scheduleRealtimeReload).subscribe()}

async function saveActive() {
  setBusy(byId("savePlayerButton"), true, "Guardando…");
  try { await persistActiveGroup(); closeDrawer(playerDrawer); await reloadActive(); notify("Jugador guardado correctamente."); }
  catch (error) { console.error(error); notify(error.message, "error"); }
  finally { setBusy(byId("savePlayerButton"), false); }
}

async function saveOnlyPayment(){const button=byId("savePaymentButton");setBusy(button,true,"Guardando…");try{const registration=selectedPaymentRegistration();await savePayment(bundle,registration,readPayment());await reloadActive();activeGroup=groups.find(group=>group.registrations.some(item=>String(item.id)===String(registration.id)))||activeGroup;openGroup(activeGroup);notify("Pago guardado correctamente.")}catch(error){notify(error.message,"error")}finally{setBusy(button,false)}}

function couponHtml(registration, payment, number) {
  const line = getLine(registration);
  return `<div class="ticket-80"><div style="text-align:center;font-size:14px;font-weight:700">Villa María Golf Club</div><div style="text-align:center;font-size:12px">Cupón de pago NO FISCAL</div><div style="border-top:1px dashed #000;margin:6px 0"></div><div style="font-size:12px;line-height:1.5"><div><b>Cupón:</b> ${escapeHtml(number)}</div><div><b>Fecha:</b> ${formatDate(payment.date)}</div><div><b>Torneo:</b> ${escapeHtml(bundle.tournament.name)}</div><div><b>Fecha torneo:</b> ${formatDate(bundle.tournament.tournament_date)}</div><div><b>Jugador:</b> ${escapeHtml(registration.display_name)}</div><div><b>Matrícula:</b> ${escapeHtml(memberNumber(registration) || "—")}</div><div><b>Salida:</b> ${timeText(line?.line_time)} · Hoyo ${escapeHtml(line?.starting_hole || "—")}</div><div><b>Concepto:</b> ${escapeHtml(payment.concept)}</div><div><b>Importe:</b> ${money(payment.amount)}</div><div><b>Forma de pago:</b> ${escapeHtml(PAYMENT_METHODS[payment.method])}</div></div><div style="border-top:1px dashed #000;margin:6px 0"></div><div style="font-size:11px;text-align:center">NO VÁLIDO COMO FACTURA</div></div>`;
}

async function printCoupon() {
  setBusy(byId("couponButton"), true, "Imprimiendo…");
  try {
    const registration = selectedPaymentRegistration(), payment = readPayment();
    await savePayment(bundle, registration, payment);
    if (["pending","no_pay"].includes(payment.method)) throw new Error(payment.method === "no_pay" ? "La opción No paga quedó guardada y no genera cupón." : "Elegí una forma de pago antes de imprimir el cupón.");
    const number = await nextCouponNumber();
    if (typeof window.imprimirTicketQZ !== "function") throw new Error("No se encontró la conexión con QZ Tray.");
    await window.imprimirTicketQZ(couponHtml(registration, payment, number));
    notify("Pago guardado y cupón enviado a QZ.");
  } catch (error) { console.error(error); notify(error.message, "error"); }
  finally { setBusy(byId("couponButton"), false); }
}

function printGroups(targetGroups) {
  if (!targetGroups.length) throw new Error("No hay tarjetas listas para imprimir.");
  const cards = [], errors = [];
  // La impresion conserva exactamente el orden operativo de la tabla:
  // horario, hoyo y nombre.
  const orderedGroups=[...targetGroups].sort((a,b)=>groupSortValue(a).localeCompare(groupSortValue(b),"es",{numeric:true,sensitivity:"base"}));
  for (const group of orderedGroups) {
    try { cards.push(printableGroup(bundle, group)); }
    catch (error) { errors.push(`${group.registrations.map(item=>item.display_name).join(" / ")}: ${error.message}`); }
  }
  if (!cards.length) throw new Error(errors[0] || "No hay tarjetas completas para imprimir.");
  printPreprintedCards(byId("printRoot"), cards);
  if (errors.length) notify(`${cards.length} tarjeta(s) preparadas · ${errors.length} pendientes de revisión.`, "error");
}

async function printActiveCard() {
  setBusy(byId("cardButton"), true, "Preparando…");
  try { await persistActiveGroup({ payment: false }); await reloadActive(); const refreshed = groups.find(group => group.key === activeGroup.key) || activeGroup; printGroups([refreshed]); notify("Tarjeta preparada para imprimir."); }
  catch (error) { console.error(error); notify(error.message, "error"); }
  finally { setBusy(byId("cardButton"), false); }
}

async function saveReady() {
  setBusy(byId("saveReadyButton"), true, "Guardando…"); let saved = 0; const errors = [];
  try {
    for (const group of groups.filter(item => groupStatus(item) !== "ready")) {
      try { if (group.type === "pair") await savePair(bundle, group, group.registrations.map(() => ({}))); else await saveSingle(bundle, group.registrations[0], {}); saved++; }
      catch (error) { errors.push(`${group.registrations.map(reg => reg.display_name).join(" / ")}: ${error.message}`); }
    }
    await reloadActive();
    notify(errors.length ? `${saved} guardados · ${errors.length} requieren revisión.` : `${saved} jugadores o parejas guardados.` , errors.length ? "error" : "success");
  } finally { setBusy(byId("saveReadyButton"), false); }
}

async function printAllCards() {
  const accepted=await confirmAction({title:"Imprimir tarjetas",message:"Se crearán las scorecards completas que falten y se enviarán las tarjetas al formato A4 preimpreso.",confirmText:"Preparar impresión"});if(!accepted)return;
  const button=byId("printReadyButton"); setBusy(button,true,"Preparando…"); const errors=[];
  try {
    for (const group of groups.filter(item=>groupStatus(item)!=="ready")) {
      try { if(group.type==="pair")await savePair(bundle,group,group.registrations.map(()=>({})));else await saveSingle(bundle,group.registrations[0],{}); }
      catch(error){errors.push(`${group.registrations.map(item=>item.display_name).join(" / ")}: ${error.message}`)}
    }
    await reloadActive();
    const readyGroups=groups.filter(item=>groupStatus(item)==="ready");
    printGroups(readyGroups);
    notify(errors.length?`${readyGroups.length} tarjeta(s) impresas · ${errors.length} pendientes.`:`${readyGroups.length} tarjeta(s) preparadas sobre formulario preimpreso.`,errors.length?"error":"success");
  } catch(error){notify(error.message,"error")} finally{setBusy(button,false)}
}

function renderPayments() {
  const totals = {};
  for (const method of Object.keys(PAYMENT_METHODS)) totals[method] = { count: 0, amount: 0 };
  for (const payment of bundle.payments) { const item = totals[payment.payment_method] || totals.pending; item.count++; item.amount += Number(payment.amount || 0); }
  const grandTotal = Object.values(totals).reduce((sum, item) => sum + item.amount, 0);
  byId("paymentsContent").innerHTML = `<div class="kpis payment-kpis">${Object.entries(totals).filter(([,item])=>item.count).map(([method,item])=>`<div class="kpi"><span>${escapeHtml(PAYMENT_METHODS[method])}</span><strong>${money(item.amount)}</strong><small>${item.count} jugador(es)</small></div>`).join("") || '<div class="notice">Todavía no hay pagos asentados.</div>'}</div><div class="payment-total"><span>Total registrado</span><strong>${money(grandTotal)}</strong></div><div class="table-wrap" style="margin-top:16px"><table class="table"><thead><tr><th>Jugador</th><th>Método</th><th>Importe</th></tr></thead><tbody>${bundle.payments.map(payment=>`<tr><td>${escapeHtml(payment.display_name)}</td><td>${escapeHtml(PAYMENT_METHODS[payment.payment_method]||payment.payment_method)}</td><td>${money(payment.amount)}</td></tr>`).join("")}</tbody></table></div>`;
}

function printPaymentsReport() {
  const rows = bundle.registrations.map(registration => {
    const payment = bundle.paymentMap.get(String(registration.id)) || { payment_method:"pending", amount:0, payment_date:null };
    return { name:registration.display_name || "Sin nombre", number:memberNumber(registration)||"—", method:payment.payment_method||"pending", amount:Number(payment.amount||0), date:payment.payment_date };
  }).sort((a,b)=>a.name.localeCompare(b.name,"es",{sensitivity:"base"}));
  const methods = Object.fromEntries(Object.keys(PAYMENT_METHODS).map(key=>[key,{count:0,total:0}]));
  rows.forEach(row=>{const item=methods[row.method]||methods.pending;item.count++;item.total+=row.amount});
  const total=rows.reduce((sum,row)=>sum+row.amount,0), popup=window.open("","_blank"), logoUrl=new URL("escudo.png",location.href).href;
  if(!popup)return notify("Permití ventanas emergentes para imprimir el informe.","error");
  popup.document.write(`<!doctype html><html><head><meta charset="utf-8"><title>Informe de pagos</title><style>@page{size:A4 portrait;margin:12mm}*{box-sizing:border-box}body{font-family:Arial,sans-serif;color:#13251a;margin:0}.head{display:flex;align-items:center;gap:16px;border-bottom:5px solid #0d3b25;padding-bottom:12px}.head img{width:58px;height:68px;object-fit:contain}.head h1{margin:0;color:#0d3b25;font-size:24px}.head p{margin:4px 0 0;color:#657168}.meta{display:grid;grid-template-columns:2fr 1fr 1fr 1fr;gap:8px;margin:16px 0}.box{border:1px solid #cfd9d2;border-radius:9px;padding:9px}.box b{display:block;font-size:10px;text-transform:uppercase;color:#657168}.total{background:#0d3b25;color:#fff}.total strong{font-size:20px}table{width:100%;border-collapse:collapse;margin-top:12px;font-size:10px}th{background:#176b3c;color:#fff;text-align:left;padding:7px}td{border-bottom:1px solid #dce4de;padding:6px}.num{text-align:right}.summary{display:grid;grid-template-columns:repeat(3,1fr);gap:7px;margin-top:12px}.summary div{border:1px solid #d8e1da;border-radius:8px;padding:8px}.summary b,.summary span{display:block}.summary span{color:#66736b;font-size:9px}.actions{margin-bottom:12px}.actions button{border:0;border-radius:8px;background:#176b3c;color:#fff;padding:9px 15px;font-weight:700}@media print{.actions{display:none}}</style></head><body><div class="actions"><button onclick="print()">Imprimir A4</button></div><header class="head"><img src="${logoUrl}"><div><h1>Informe de pagos</h1><p>Villa María Golf Club · Control de caja</p></div></header><section class="meta"><div class="box"><b>Torneo</b><strong>${escapeHtml(bundle.tournament.name)}</strong><br>${formatDate(bundle.tournament.tournament_date)}</div><div class="box"><b>Precio socio</b><strong>${money(priceInputValue("memberPrice"))}</strong></div><div class="box"><b>Precio invitado</b><strong>${money(priceInputValue("guestPrice"))}</strong></div><div class="box total"><b>Total recaudado</b><strong>${money(total)}</strong></div></section><section class="summary">${Object.entries(methods).map(([key,item])=>`<div><span>${escapeHtml(PAYMENT_METHODS[key])}</span><b>${item.count} · ${money(item.total)}</b></div>`).join("")}</section><h2>Detalle por jugador</h2><table><thead><tr><th>Jugador</th><th>Matrícula</th><th>Fecha</th><th>Forma de pago</th><th class="num">Importe</th></tr></thead><tbody>${rows.map(row=>`<tr><td>${escapeHtml(row.name)}</td><td>${escapeHtml(row.number)}</td><td>${row.date?formatDate(row.date):"—"}</td><td>${escapeHtml(PAYMENT_METHODS[row.method]||row.method)}</td><td class="num">${money(row.amount)}</td></tr>`).join("")}</tbody></table></body></html>`);
  popup.document.close();
}

function renderAll() { renderTournamentStrip(); renderRows(); loadTournamentPrices(); pageState.classList.add("hidden"); tableWrap.classList.remove("hidden"); byId("saveTournamentButton").disabled = bundle.tournament.status === "officialized"; byId("saveTournamentButton").textContent = bundle.tournament.status === "officialized" ? "Torneo guardado" : "Guardar torneo"; byId("continueCardsLink").href = `tarjetas_beta.html?torneo=${encodeURIComponent(bundle.tournament.id)}`; }

async function selectTournament(id) {
  const tournament = tournaments.find(item => String(item.id) === String(id)); if (!tournament) return;
  setActiveTournament(tournament); history.replaceState({}, "", `oficializacion_beta.html?torneo=${encodeURIComponent(id)}`); showState(pageState, "Cargando torneo…"); tableWrap.classList.add("hidden");
  bundle = await loadOfficialization(id); groups = buildGroups(bundle); renderAll(); subscribeTournament(id);
}

function closeDrawer(drawer) { drawer.classList.remove("open"); drawer.setAttribute("aria-hidden", "true"); }

byId("playerSearch").addEventListener("input", renderRows);
byId("statusFilters").querySelectorAll("[data-filter]").forEach(button => button.addEventListener("click", () => { byId("statusFilters").querySelectorAll("[data-filter]").forEach(item => item.classList.remove("active")); button.classList.add("active"); currentFilter = button.dataset.filter; renderRows(); }));
byId("drawerClose").addEventListener("click", () => closeDrawer(playerDrawer));
byId("paymentsClose").addEventListener("click", () => closeDrawer(paymentsDrawer));
byId("savePlayerButton").addEventListener("click", saveActive);
byId("savePaymentButton").addEventListener("click", saveOnlyPayment);
byId("couponButton").addEventListener("click", printCoupon);
byId("cardButton").addEventListener("click", printActiveCard);
byId("saveReadyButton").addEventListener("click", saveReady);
byId("paymentsSummaryButton").addEventListener("click", () => { renderPayments(); paymentsDrawer.classList.add("open"); paymentsDrawer.setAttribute("aria-hidden", "false"); });
byId("printPaymentsButton").addEventListener("click", printPaymentsReport);
byId("printReadyButton").addEventListener("click", printAllCards);
for(const id of ["memberPrice","guestPrice"]){byId(id).addEventListener("focus",()=>{const value=priceInputValue(id);byId(id).value=value?String(Math.round(value)):""});byId(id).addEventListener("blur",()=>{const value=priceInputValue(id);saveTournamentPrices();formatMoneyInput(id,value)})}
byId("saveTournamentButton").addEventListener("click", async () => {
  const pending = groups.filter(group => groupStatus(group) !== "ready");
  if (pending.length) return notify(`Faltan ${pending.length} fila(s) por guardar.`, "error");
  const accepted = await confirmAction({ title: "Guardar torneo", message: `¿Querés guardar “${bundle.tournament.name}”?`, confirmText: "Guardar" });
  if (!accepted) return;
  try { await saveTournament(bundle.tournament.id); await reloadActive(); notify("Torneo guardado correctamente."); } catch (error) { notify(error.message, "error"); }
});

try {
  if(!localStorage.getItem("ticket_branch_code")){const email=String(context.user?.email||"").toLowerCase(),branches={"lau_m2000@hotmail.com":"S1","giselaantonino@gmail.com":"S2"};localStorage.setItem("ticket_branch_code",branches[email]||"S1")}
  tournaments = await listOfficializationTournaments();
  if (!tournaments.length) throw new Error("No hay torneos V2 abiertos o guardados.");
  const requested = new URLSearchParams(location.search).get("torneo") || getActiveTournament().id;
  const selected = tournaments.find(item => String(item.id) === String(requested));
  if (!selected) throw new Error("Elegí el torneo desde el Panel para administrar sus jugadores.");
  await selectTournament(selected.id);
} catch (error) { console.error(error); showState(pageState, error.message, "error"); }
window.addEventListener("beforeunload",()=>{if(realtimeChannel)supabase.removeChannel(realtimeChannel)});
