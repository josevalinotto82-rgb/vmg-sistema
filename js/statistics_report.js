import { escapeHtml, formatDate } from "./ui.js";
const fmt = value => value == null ? "—" : Number(value).toFixed(2).replace(".", ",");
const vsPar = value => value == null ? "—" : `${value >= 0 ? "+" : ""}${fmt(value)}`;

export function statisticsContent(report, meta) {
  const detail = report.holes.filter(row => row.count);
  return `<div class="statistics-report-context"><strong>${escapeHtml(meta.tournaments.map(item => item.name).join(" · "))}</strong><span>Index: ${escapeHtml(meta.indexMin || "Sin mínimo")} a ${escapeHtml(meta.indexMax || "Sin máximo")}</span></div>
    <div class="statistics-kpis"><div><strong>${meta.tournaments.length}</strong><span>Torneos</span></div><div><strong>${report.cards}</strong><span>Tarjetas incluidas</span></div><div><strong>${report.observations}</strong><span>Hoyos evaluados</span></div><div><strong>${report.excluded}</strong><span>Tarjetas excluidas</span></div></div>
    <h3>Ranking de dificultad</h3><div class="statistics-ranking">${report.ranking.map((row,index) => `<div><b>${index+1}°</b><strong>Hoyo ${row.hole}</strong><span>${vsPar(row.averageVsPar)} vs par</span></div>`).join("")}</div>
    <h3>Detalle por hoyo</h3><div class="statistics-hole-grid">${detail.map(row => `<article class="statistics-hole-card"><header><strong>Hoyo ${row.hole}</strong><span>${row.count} muestras</span></header><dl><div><dt>Par</dt><dd>${escapeHtml(row.par ?? "—")}</dd></div><div><dt>HCP</dt><dd>${escapeHtml(row.handicap ?? "—")}</dd></div><div><dt>Prom. golpes</dt><dd>${fmt(row.average)}</dd></div><div><dt>Prom. vs par</dt><dd>${vsPar(row.averageVsPar)}</dd></div></dl><div class="statistics-score-counts">${[["Águilas",row.eagles],["Birdies",row.birdies],["Par",row.pars],["Bogey",row.bogeys],["Doble +",row.doublePlus]].map(([name,value]) => `<span><b>${value}</b>${name}</span>`).join("")}</div></article>`).join("") || '<div class="empty-state">No hay hoyos con datos válidos para estos filtros.</div>'}</div>`;
}

export function statisticsPrintDocument(report, meta, baseUrl = location.href) {
  const rows = report.holes.filter(row => row.count);
  return `<!doctype html><html lang="es"><head><meta charset="utf-8"><base href="${escapeHtml(baseUrl)}"><title>Estadísticas · Villa María Golf Club</title><style>
    @page { size:A4 portrait; margin:14mm; }
    * { box-sizing:border-box; } body { margin:0; color:#17221c; font:11px Arial,sans-serif; }
    header { display:flex; align-items:center; gap:14px; padding-bottom:12px; border-bottom:3px solid #166534; } header img { width:45px; height:55px; object-fit:contain; } h1 { margin:4px 0; font-size:21px; } header p { margin:3px 0; } h2 { font-size:14px; margin:16px 0 7px; }
    .meta { margin:12px 0; line-height:1.6; overflow-wrap:anywhere; } .totals { display:flex; gap:20px; margin:12px 0; } .totals strong { font-size:14px; }
    table { width:100%; border-collapse:collapse; table-layout:fixed; font-size:9.5px; } th,td { border-bottom:1px solid #dfe7e1; padding:7px 2px; text-align:center; overflow-wrap:anywhere; } th { background:#edf5ef; } thead { display:table-header-group; } tr { break-inside:avoid; } .ranking { columns:3; column-gap:14px; line-height:1.7; } .ranking div { break-inside:avoid; } footer { margin-top:15px; padding-top:7px; border-top:1px solid #dfe7e1; font-size:9px; }
    </style></head><body><header><img src="escudo.png" alt="Escudo VMGC"><div><p>Villa María Golf Club</p><h1>Informe de estadísticas</h1><p>Dificultad y resultados por hoyo</p></div></header>
    <section class="meta"><b>Torneos:</b> ${meta.tournaments.map(item => `${escapeHtml(item.name)} (${formatDate(item.tournament_date)})`).join(" · ")}<br><b>Index:</b> ${escapeHtml(meta.indexMin || "Sin mínimo")} a ${escapeHtml(meta.indexMax || "Sin máximo")}</section>
    <section class="totals"><span><strong>${report.cards}</strong> tarjetas incluidas</span><span><strong>${report.observations}</strong> hoyos evaluados</span><span><strong>${report.excluded}</strong> tarjetas excluidas</span></section>
    <h2>Ranking de dificultad</h2><div class="ranking">${report.ranking.map((row,index) => `<div><b>${index+1}.</b> Hoyo ${row.hole} · ${vsPar(row.averageVsPar)} vs par</div>`).join("") || "Sin datos"}</div>
    <h2>Detalle por hoyo</h2><table><thead><tr>${["Hoyo","Par","HCP","Muestras","Prom. golpes","Prom. vs par","Águilas","Birdies","Par","Bogey","Doble +"].map(name=>`<th>${name}</th>`).join("")}</tr></thead><tbody>${rows.map(row=>`<tr>${[row.hole,row.par??"—",row.handicap??"—",row.count,fmt(row.average),vsPar(row.averageVsPar),row.eagles,row.birdies,row.pars,row.bogeys,row.doublePlus].map(value=>`<td>${escapeHtml(value)}</td>`).join("")}</tr>`).join("")}</tbody></table><footer>Villa María Golf Club · Informe de estadísticas</footer></body></html>`;
}

export function printStatisticsReport(report, meta) {
  const frame = document.createElement("iframe");
  frame.title = "Impresión de estadísticas";
  frame.style.cssText = "position:fixed;left:-10000px;width:800px;height:1100px;border:0";
  frame.onload = async () => {
    await Promise.all([...frame.contentDocument.images].map(img => img.decode().catch(() => {})));
    frame.contentWindow.addEventListener("afterprint", () => frame.remove(), {once:true});
    frame.contentWindow.focus();
    frame.contentWindow.print();
  };
  frame.srcdoc = statisticsPrintDocument(report, meta);
  document.body.appendChild(frame);
}