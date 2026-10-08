import { requireSession } from "./auth.js";
import { getAagSyncReport } from "./aag_sync_service.js";
import { escapeHtml } from "./ui.js";
import { loadOfficialization } from "./officialization_service.js";
import { loadResultsWorkspace } from "./results_service.js";
import { buildPaymentReport, paymentReportOptions } from "./payment_report.js";
import { buildTournamentReport } from "./results_report.js";

await requireSession({ admin: true });

const params = new URLSearchParams(location.search);
const type = params.get("tipo");
const id = params.get("id");
const tournamentId = params.get("torneo");
const paymentFilter = params.get("filtro") || "all";
const state = document.getElementById("reportState");
const view = document.getElementById("reportView");
const indexText = value => Number.isFinite(Number(value)) ? Number(value).toFixed(1) : "—";
const dateTime = value => value ? new Intl.DateTimeFormat("es-AR", { dateStyle:"medium", timeStyle:"short", timeZone:"America/Argentina/Cordoba" }).format(new Date(value)) : "Sin registro";

function rows(items, kind) {
  if (!items?.length) return '<p class="index-report-empty">Sin movimientos.</p>';
  const head = kind === "updated" ? "<th>Matrícula</th><th>Jugador</th><th>Index anterior</th><th>Index nuevo</th>" : kind === "added" ? "<th>Matrícula</th><th>Jugador</th><th>Index</th>" : "<th>Matrícula</th><th>Jugador</th><th>Último Index</th>";
  const body = items.map(item => `<tr><td>${escapeHtml(item.matricula || "—")}</td><td>${escapeHtml(item.nombre || "—")}</td>${kind === "updated" ? `<td>${indexText(item.old_index)}</td><td><strong>${indexText(item.new_index)}</strong></td>` : kind === "added" ? `<td>${indexText(item.index)}</td>` : `<td>${indexText(item.old_index)}</td>`}</tr>`).join("");
  return `<table class="index-report-table"><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table>`;
}

function renderIndex(report) {
  const data = report.data || {}, added = data.added || [], updated = data.updated || [], deactivated = data.deactivated || [];
  document.title = `Actualización de Index ${dateTime(report.created_at)}`;
  view.innerHTML = `<div class="standalone-report-actions"><button class="btn secondary" type="button" id="closeReport">Cerrar</button><button class="btn primary" type="button" id="printReport">Imprimir A4</button></div><main class="index-report-page"><header class="index-report-head"><img src="escudo.png" alt="Escudo VMGC"><div><small>Villa María Golf Club</small><h1>Actualización de Index AAG</h1><p>Sincronización realizada el ${dateTime(report.created_at)}</p></div></header><section class="index-report-kpis"><article class="total"><span>Socios VMGC</span><strong>${report.before_vmgc ?? "—"} → ${report.after_vmgc ?? "—"}</strong></article><article><span>Altas</span><strong>${added.length}</strong></article><article><span>Cambios de Index</span><strong>${updated.length}</strong></article><article><span>Bajas</span><strong>${deactivated.length}</strong></article></section><h2>Cambios de Index</h2>${rows(updated,"updated")}<h2>Altas nuevas</h2>${rows(added,"added")}<h2>Bajas del padrón VMGC</h2>${rows(deactivated,"deactivated")}<footer>Villa María Golf Club · Informe administrativo de sincronización AAG</footer></main>`;
  document.getElementById("printReport").addEventListener("click", () => window.print());
  document.getElementById("closeReport").addEventListener("click", () => window.close());
}

function renderDocument(title,content){
  document.title=title;
  view.innerHTML=`<div class="standalone-report-actions"><button class="btn secondary" type="button" id="closeReport">Cerrar</button><button class="btn primary" type="button" id="printReport">Imprimir A4</button></div>${content}`;
  document.getElementById("printReport").addEventListener("click",()=>window.print());
  document.getElementById("closeReport").addEventListener("click",()=>window.close());
}

try {
  if(type==="index")renderIndex(await getAagSyncReport(id));
  else if(type==="pagos"){
    const bundle=await loadOfficialization(tournamentId);
    renderDocument(`Pagos · ${bundle.tournament.name}`,buildPaymentReport(bundle,{...paymentReportOptions(bundle.tournament.id),filter:paymentFilter}));
  }else if(type==="resultados"){
    const bundle=await loadResultsWorkspace(tournamentId);
    renderDocument(`Resultados · ${bundle.tournament.name}`,buildTournamentReport(bundle));
  }else throw new Error("Tipo de informe no reconocido.");
  state.hidden = true;
} catch (error) {
  state.textContent = error.message || "No se pudo preparar el informe.";
  state.classList.add("error");
}
