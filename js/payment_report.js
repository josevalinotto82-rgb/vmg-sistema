import { escapeHtml, formatDate } from "./ui.js";
import { memberNumber } from "./officialization_rules.js";

export const PAYMENT_METHODS = { pending:"Pendiente", cash:"Efectivo", credit_card:"Tarjeta crédito", debit_card:"Tarjeta débito", transfer:"Transferencia", current_account:"Cuenta corriente", no_pay:"No paga" };
const money=value=>Number(value||0).toLocaleString("es-AR",{style:"currency",currency:"ARS",minimumFractionDigits:2});

export function buildPaymentReport(bundle,{filter="all",memberPrice=0,guestPrice=0}={}){
  const rows=bundle.registrations.map(registration=>{const payment=bundle.paymentMap.get(String(registration.id))||{};return{name:registration.display_name||"Sin nombre",number:memberNumber(registration)||"—",method:payment.payment_method||"pending",amount:Number(payment.amount||0),date:payment.payment_date}}).sort((a,b)=>a.name.localeCompare(b.name,"es",{sensitivity:"base"}));
  const visible=filter==="all"?rows:rows.filter(row=>row.method===filter),total=visible.reduce((sum,row)=>sum+row.amount,0);
  const summary=Object.keys(PAYMENT_METHODS).filter(key=>filter==="all"||key===filter).map(key=>{const selected=visible.filter(row=>row.method===key);return`<div><span>${escapeHtml(PAYMENT_METHODS[key])}</span><b>${selected.length} · ${money(selected.reduce((sum,row)=>sum+row.amount,0))}</b></div>`}).join("");
  return `<main class="payment-report-page"><header class="payment-report-head"><img src="escudo.png" alt="Escudo VMGC"><div><h1>Informe de pagos</h1><p>Villa María Golf Club · Control de caja</p></div></header><section class="payment-report-meta"><div><b>Torneo</b><strong>${escapeHtml(bundle.tournament.name)}</strong><br>${formatDate(bundle.tournament.tournament_date)}</div><div><b>Precio socio</b><strong>${money(memberPrice)}</strong></div><div><b>Precio invitado</b><strong>${money(guestPrice)}</strong></div><div class="total"><b>Total recaudado</b><strong>${money(total)}</strong></div></section><section class="payment-report-summary">${summary}</section><h2>Detalle por jugador</h2><table class="payment-report-table"><thead><tr><th>Jugador</th><th>Matrícula</th><th>Fecha</th><th>Forma de pago</th><th>Importe</th></tr></thead><tbody>${visible.map(row=>`<tr><td>${escapeHtml(row.name)}</td><td>${escapeHtml(row.number)}</td><td>${row.date?formatDate(row.date):"—"}</td><td>${escapeHtml(PAYMENT_METHODS[row.method]||row.method)}</td><td>${money(row.amount)}</td></tr>`).join("")}</tbody></table><footer>Villa María Golf Club · Informe administrativo de pagos</footer></main>`;
}

export function paymentReportOptions(tournamentId){return{memberPrice:Number(localStorage.getItem(`precio_torneo_${tournamentId}`)||0),guestPrice:Number(localStorage.getItem(`precio_torneo_invitado_${tournamentId}`)||0)}};
