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
function list(data,key) {
  if (data?.club_id != null && Number(data.club_id)!==408) return [];
  return (Array.isArray(data?.[key]) ? data[key] : []).filter(item=>{
    const ids=[item.old_club_id,item.new_club_id,item.option_club_id,item.club_id]
      .filter(value=>value!=null && String(value).trim()!=='' && Number.isFinite(Number(value))).map(Number);
    // Older VMGC reports did not include club IDs on each row.
    return !ids.length || ids.includes(408);
  });
}
const count=(data,key)=>list(data,key).length;
const dateTime=value=>value ? new Intl.DateTimeFormat("es-AR",{dateStyle:"medium",timeStyle:"short",timeZone:"America/Argentina/Cordoba"}).format(new Date(value)) : "Sin registro";

export function syncCountsText(data,legacy={}) {
  if(data?.schema_version!==2 && !Array.isArray(data?.reactivated)) {
    return [["updated","Índices",legacy.updated_count],["added","Altas",legacy.added_count],["deactivated","Bajas",legacy.deactivated_count]]
      .map(([key,label,saved])=>[label,Array.isArray(data?.[key])?count(data,key):Number(saved)||0])
      .filter(([,value])=>value>0).map(([label,value])=>`${label}: ${value}`).join(" · ") || "Sin cambios en VMGC";
  }
  return [["updated","Índices"],["added","Nuevas"],["reactivated","Reactivaciones"],["deactivated","Bajas AAG"],["incoming","Ingresos"],["outgoing","Salidas"]]
    .filter(([key])=>count(data,key)>0).map(([key,label])=>`${label}: ${count(data,key)}`).join(" · ") || "Sin cambios en VMGC";
}

export function syncSummaryHtml(changes) {
  return `<div class="aag-sync-success"><span class="status open">Sincronización correcta</span><h2>Actualización finalizada</h2>${sections.every(([key])=>count(changes,key)===0)?'<p>Sin cambios en los jugadores de VMGC.</p>':''}<div class="aag-report-kpis" style="display:grid;grid-template-columns:repeat(auto-fit,minmax(120px,1fr));gap:12px">${sections.filter(([key])=>count(changes,key)>0).map(([key,label])=>`<div><strong>${count(changes,key)}</strong><span>${esc(label)}</span></div>`).join("")}</div><p>El informe quedó guardado en <b>Configuración → Informes</b>.</p></div>`;
}

function table(items,key,legacy=false) {
  if(!items.length) return '<p class="index-report-empty">Sin movimientos.</p>';
  return `<table class="index-report-table"><thead><tr><th>Matrícula</th><th>Jugador</th><th>Index anterior</th><th>Index actual</th><th>Club anterior</th><th>Club actual / último conocido</th></tr></thead><tbody>${items.map(item=>`<tr><td>${esc(item.matricula || "—")}</td><td>${esc(item.nombre || "—")}${key==="deactivated"?'<br><small>No figura en el padrón recibido; motivo no informado por AAG.</small>':""}</td><td>${indexText(item.old_index)}</td><td>${indexText(key==="deactivated"?null:item.new_index ?? item.index)}</td><td>${esc(item.old_club || "—")}</td><td>${esc(item.new_club || item.club || "—")}</td></tr>`).join("")}</tbody></table>`;
}

export function renderAagReport(report) {
  const data=report.data || {};
  const legacy=data.schema_version!==2;
  const visible=legacy ? [["updated","Cambios de Index"],["added","Altas (informe histórico)"],["deactivated","Bajas (informe histórico)"]] : sections;
  const populated=visible.filter(([key])=>count(data,key)>0);
  return `<div class="standalone-report-actions"><button class="btn secondary" type="button" id="closeReport">Cerrar</button><button class="btn primary" type="button" id="printReport">Imprimir A4</button></div><main class="index-report-page aag-report-v2"><header class="index-report-head"><img src="escudo.png" alt="Escudo VMGC"><div><small>Villa María Golf Club</small><h1>Sincronización AAG · VMGC</h1><p>${esc(dateTime(report.created_at))}</p></div></header><section class="index-report-kpis" style="grid-template-columns:repeat(auto-fit,minmax(110px,1fr))">${Number(report.before_vmgc)>0 || Number(report.after_vmgc)>0 ? `<article class="total"><span>Matrículas AAG activas VMGC</span><strong>${esc(report.before_vmgc ?? "—")} → ${esc(report.after_vmgc ?? "—")}</strong></article>` : ""}${populated.map(([key,label])=>`<article><span>${esc(label)}</span><strong>${count(data,key)}</strong></article>`).join("")}</section>${populated.map(([key,label])=>`<h2>${esc(label)}</h2>${table(list(data,key),key,legacy)}`).join("")}${populated.length?'':'<p class="index-report-empty">Sin cambios en los jugadores de VMGC.</p>'}<footer>Villa María Golf Club · Informe de sincronización AAG</footer></main>`;
}
