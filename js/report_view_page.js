import { renderAagReport } from "./aag_sync_report.js";
import { listDailySales, billingToday } from "./misc_billing_service.js";
import { dailySalesContent } from "./misc_billing_report.js";
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

function renderIndex(report) {
  document.title=`Sincronización AAG ${dateTime(report.created_at)}`;
  view.innerHTML=renderAagReport(report);
  document.getElementById("printReport").addEventListener("click",()=>window.print());
  document.getElementById("closeReport").addEventListener("click",()=>window.close());
}

function renderDocument(title,content){
  document.title=title;
  view.innerHTML=`<div class="standalone-report-actions"><button class="btn secondary" type="button" id="closeReport">Cerrar</button><button class="btn primary" type="button" id="printReport">Imprimir A4</button></div>${content}`;
  document.getElementById("printReport").addEventListener("click",()=>window.print());
  document.getElementById("closeReport").addEventListener("click",()=>window.close());
}

try {
  if(type==="varios"){const date=params.get("fecha")||billingToday();renderDocument("Facturación del día",dailySalesContent(await listDailySales(date),date));}
  else if(type==="index")renderIndex(await getAagSyncReport(id));
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
