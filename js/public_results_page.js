import { listPublicTournaments, loadPublicResults } from "./public_results_service.js";
import { resultsContent, bindResultsAccordions } from "./results_view.js";
import { normalizeText } from "./results_service.js";
import { escapeHtml, formatDate } from "./ui.js";

export async function mountPublicResults(host) {
  let tournaments=[],listQuery="",listDate="",offset=0,request=0;
  const pageSize=20;
  const fail=error=>{if(host.isConnected)host.innerHTML=`<div class="notice error">${escapeHtml(error.message||"No se pudo cargar la información.")}</div><button class="btn secondary" data-retry>Volver a intentar</button>`,host.querySelector('[data-retry]').onclick=()=>mountPublicResults(host);};
  function showList() {
    request++;
    host.innerHTML='<div class="public-result-filters"><div class="field"><label for="publicTournamentSearch">Buscar torneo</label><input id="publicTournamentSearch" class="control" data-search placeholder="Nombre del torneo"></div><div class="field"><label for="publicTournamentDate">Fecha del torneo</label><input id="publicTournamentDate" class="control" type="date" data-date></div><button class="btn secondary" type="button" data-clear-date>Ver todas las fechas</button></div><div data-list></div>';
    const search=host.querySelector('[data-search]');search.value=listQuery;
    const date=host.querySelector('[data-date]');date.value=listDate;
    const paint=()=>{
      const filtered=tournaments.filter(t=>normalizeText(t.name).includes(normalizeText(listQuery))&&(!listDate||String(t.tournament_date||'').slice(0,10)===listDate));
      const list=host.querySelector('[data-list]');
      list.innerHTML=`<p class="muted">${filtered.length} torneos publicados</p><div class="public-tournament-grid">${filtered.slice(offset,offset+pageSize).map(t=>`<button class="card public-tournament" type="button" data-tournament="${escapeHtml(t.id)}"><span class="eyebrow">${formatDate(t.tournament_date)}</span><strong>${escapeHtml(t.name)}</strong><span>${escapeHtml(t.game_modes?.name||"Torneo")} · ${t.hole_count||18} hoyos</span><span class="btn secondary">Ver resultados →</span></button>`).join('')||'<div class="empty-state">No hay torneos publicados que coincidan.</div>'}</div><div class="public-pagination"><button class="btn secondary" data-prev ${offset===0?'disabled':''}>Anterior</button><span>${filtered.length?Math.floor(offset/pageSize)+1:0} / ${Math.ceil(filtered.length/pageSize)}</span><button class="btn secondary" data-next ${offset+pageSize>=filtered.length?'disabled':''}>Siguiente</button></div>`;
      list.querySelectorAll('[data-tournament]').forEach(button=>button.onclick=()=>showTournament(button.dataset.tournament));
      list.querySelector('[data-prev]').onclick=()=>{offset-=pageSize;paint();};
      list.querySelector('[data-next]').onclick=()=>{offset+=pageSize;paint();};
    };
    search.oninput=()=>{listQuery=search.value;offset=0;paint();};
    date.oninput=()=>{listDate=date.value;offset=0;paint();};
    host.querySelector('[data-clear-date]').onclick=()=>{listDate='';date.value='';offset=0;paint();};
    paint();
  }
  async function showTournament(id) {
    const token=++request;
    host.innerHTML='<div class="empty-state">Cargando resultados…</div>';
    try {
      const bundle=await loadPublicResults(id);
      if(token!==request||!host.isConnected)return;
      host.innerHTML=`<div class="public-result-heading"><button class="btn secondary" data-list-back>← Torneos</button><div><h2>${escapeHtml(bundle.tournament.name)}</h2><span>${formatDate(bundle.tournament.tournament_date)} · ${escapeHtml(bundle.tournament.game_modes?.name||"Torneo")}</span></div></div><div class="public-result-filters"><div class="field"><label>Buscar jugador o matrícula</label><input class="control" data-player-search placeholder="Nombre o matrícula"></div>${bundle.series?'<div class="field"><label>Clasificación</label><select class="control" data-view><option value="day">Resultados del día</option><option value="series">Acumulado</option><option value="best18">Mejor 18</option><option value="best36">Mejor 36</option></select></div>':''}</div><div data-rankings></div>`;
      const paint=()=>{const rankings=host.querySelector('[data-rankings]');rankings.innerHTML=resultsContent(bundle,{query:host.querySelector('[data-player-search]').value,view:host.querySelector('[data-view]')?.value||'day'});bindResultsAccordions(rankings);};
      host.querySelector('[data-list-back]').onclick=showList;
      host.querySelector('[data-player-search]').oninput=paint;
      if(bundle.series)host.querySelector('[data-view]').onchange=paint;
      paint();
    }catch(error){if(token===request)fail(error);}
  }
  try{tournaments=await listPublicTournaments();if(host.isConnected)showList();}catch(error){fail(error);}
}
