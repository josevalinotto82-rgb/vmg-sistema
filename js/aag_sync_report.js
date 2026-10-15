const esc = value => String(value ?? "").replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"})[c]);

export const indexText = value => value == null || String(value).trim() === "" || !Number.isFinite(Number(value)) ? "—" : Number(value).toFixed(1);
const sections = [
  ["updated","Cambios de Index"],
  ["added","Matrículas detectadas por primera vez en VMGC"],
  ["reactivated","Reactivaciones AAG"],
  ["deactivated","Bajas del padrón AAG"],
  ["incoming","Ingresos a VMGC desde otro club"],
  ["outgoing","Salidas de VMGC hacia otro club"]
];
const list=(data,key)=>Array.isArray(data?.[key]) ? data[key] : [];
const count=(data,key)=>list(data,key).length;
const dateTime=value=>value ? new Intl.DateTimeFormat("es-AR",{dateStyle:"medium",timeStyle:"short",timeZone:"America/Argentina/Cordoba"}).format(new Date(value)) : "Sin registro";

export function syncCountsText(data,legacy={}) {
  if(data?.schema_version!==2 && !Array.isArray(data?.reactivated)) return `Altas: ${legacy.added_count ?? count(data,"added")} · Índices: ${legacy.updated_count ?? count(data,"updated")} · Bajas: ${legacy.deactivated_count ?? count(data,"deactivated")}`;
  return `Nuevas: ${count(data,"added")} · Reactivaciones: ${count(data,"reactivated")} · Bajas AAG: ${count(data,"deactivated")} · Ingresos: ${count(data,"incoming")} · Salidas: ${count(data,"outgoing")} · Índices: ${count(data,"updated")}`;
}

export function syncSummaryHtml(changes) {
  return `<div class="aag-sync-success"><span class="status open">Sincronización correcta</span><h2>Actualización finalizada</h2><div class="aag-report-kpis" style="display:grid;grid-template-columns:repeat(auto-fit,minmax(120px,1fr));gap:12px">${sections.map(([key,label])=>`<div><strong>${count(changes,key)}</strong><span>${esc(label)}</span></div>`).join("")}</div><p>El informe quedó guardado en <b>Configuración → Informes</b>.</p><p>Un jugador puede figurar en más de una categoría. Su habilitación local no se modifica.</p></div>`;
}

function table(items,key,legacy=false) {
  if(!items.length) return '<p class="index-report-empty">Sin movimientos.</p>';
  return `<table class="index-report-table"><thead><tr><th>Matrícula</th><th>Jugador</th><th>Index anterior</th><th>Index actual</th><th>Club anterior</th><th>Club actual / último conocido</th></tr></thead><tbody>${items.map(item=>`<tr><td>${esc(item.matricula || "—")}</td><td>${esc(item.nombre || "—")}${key==="deactivated"?'<br><small>No figura en el padrón recibido; motivo no informado por AAG.</small>':""}</td><td>${indexText(item.old_index)}</td><td>${indexText(key==="deactivated"?null:item.new_index ?? item.index)}</td><td>${esc(item.old_club || "—")}</td><td>${esc(item.new_club || item.club || "—")}</td></tr>`).join("")}</tbody></table>`;
}

export function renderAagReport(report) {
  const data=report.data || {};
  const legacy=data.schema_version!==2;
  const visible=legacy ? [["updated","Cambios de Index"],["added","Altas (informe histórico)"],["deactivated","Bajas (informe histórico)"]] : sections;
  const warning=legacy ? '<p>Informe histórico: las altas y bajas originales no distinguían reactivaciones ni cambios de club. Se conserva el registro original.</p>' : '<p>Se muestran cambios de matrículas que pertenecían o pasan a pertenecer a VMGC. “Primera detección” no certifica que AAG haya emitido una matrícula nueva. Un jugador puede aparecer en varias categorías. La habilitación local y la condición administrativa de socio se conservan.</p>';
  return `<div class="standalone-report-actions"><button class="btn secondary" type="button" id="closeReport">Cerrar</button><button class="btn primary" type="button" id="printReport">Imprimir A4</button></div><main class="index-report-page aag-report-v2"><header class="index-report-head"><img src="escudo.png" alt="Escudo VMGC"><div><small>Villa María Golf Club</small><h1>Sincronización AAG · VMGC</h1><p>${esc(dateTime(report.created_at))}</p></div></header><section class="index-report-kpis" style="grid-template-columns:repeat(auto-fit,minmax(110px,1fr))"><article class="total"><span>Matrículas AAG activas VMGC</span><strong>${esc(report.before_vmgc ?? "—")} → ${esc(report.after_vmgc ?? "—")}</strong></article>${visible.map(([key,label])=>`<article><span>${esc(label)}</span><strong>${count(data,key)}</strong></article>`).join("")}</section>${warning}${visible.map(([key,label])=>`<h2>${esc(label)}</h2>${table(list(data,key),key,legacy)}`).join("")}<footer>Villa María Golf Club · Informe de sincronización AAG</footer></main>`;
}
