import { getLatestIndexJob, startIndexJob, decideIndexJob, retryIndexJob, getAagSyncReport } from './aag_sync_service.js';
import { syncSummaryHtml } from './aag_sync_report.js';
import { escapeHtml, notify, confirmAction } from './ui.js';
const active=new Set(['queued','preparing','review','ready','applying']);
let current=null,dialog=null,timer=null,refreshing=false,started=false,seenVersion='',acting=false,completedNoticeVisible=false;
const key='vmgc:index-job:';
const text=job=>job?.message||'Actualización de Index';
const name=player=>player?.full_name||[player?.last_name,player?.first_name].filter(Boolean).join(', ');
const reportUrl=job=>'report_view.html?tipo=index&id='+encodeURIComponent(job.history_id);
function notification(job){
  if(active.has(job.status)){localStorage.setItem(key+'tracking',job.id);return;}
  if(localStorage.getItem(key+'tracking')!==job.id||localStorage.getItem(key+'notified')===job.id+':'+job.status)return;
  if(job.status==='completed')completedNoticeVisible=true;
  localStorage.setItem(key+'notified',job.id+':'+job.status);
  const message=job.status==='completed'?'La actualización de Index terminó. El informe está disponible.':'La actualización de Index necesita atención. Abrí el seguimiento para ver el detalle.';
  notify(message,job.status==='completed'?'success':'error');
  if(document.hidden&&'Notification'in window&&Notification.permission==='granted'){
    try { const alert=new Notification('Villa María Golf Club · Index',{body:message,tag:'vmgc-index-'+job.id,icon:'escudo.png'});
    alert.onclick=()=>{window.focus();openView();alert.close();}; } catch(_) { /* In-app notice remains available on browsers without desktop notification support. */ }
  }
  if(job.status==='completed')document.dispatchEvent(new CustomEvent('vmgc:index-updated'));
}
function renderBanner(){
  let banner=document.getElementById('aagBackgroundBanner');
  if(!current||(current.status==='completed'&&!completedNoticeVisible)||(!active.has(current.status)&&localStorage.getItem(key+'dismissed')===current.id)){banner?.remove();return;}
  if(!banner){banner=document.createElement('aside');banner.id='aagBackgroundBanner';banner.className='aag-job-banner';banner.setAttribute('aria-live','polite');document.body.appendChild(banner);}
  banner.innerHTML=`<button type="button" data-open-index-job><strong>Index · ${current.status==='completed'?'Finalizado':current.status==='review'?'Revisión pendiente':current.status==='failed'?'Necesita atención':'En segundo plano'}</strong><span>${escapeHtml(text(current))}</span></button>${active.has(current.status)?'':'<button type="button" data-dismiss-index-job aria-label="Ocultar aviso">×</button>'}`;
  banner.querySelector('[data-open-index-job]').onclick=openView;
  banner.querySelector('[data-dismiss-index-job]')?.addEventListener('click',()=>{localStorage.setItem(key+'dismissed',current.id);banner.remove();});
}
async function renderDialog(){
  if(!dialog?.isConnected||!current||acting)return;
  const body=dialog.querySelector('[data-index-job-body]');
  body.innerHTML=`<div class="notice ${current.status==='failed'?'warn':current.status==='completed'?'success':'info'}"><strong>${escapeHtml(text(current))}</strong>${current.status==='failed'?`<p>${escapeHtml(current.error_text||'No se pudo completar.')}</p>`:''}</div><p class="subtle">Podés cerrar esta ventana y seguir trabajando. La actualización continúa en el servidor.</p>`;
  if(current.status==='review'){
    const item=current.pending?.[0];
    if(item){body.innerHTML+=`<section class="aag-association"><strong>${escapeHtml(name(item.aag))}</strong><p>Matrícula ${escapeHtml(item.aag.aag_member_number)} · Index ${escapeHtml(item.aag.current_index??'—')}</p><h3>¿Es alguno de estos jugadores manuales?</h3>${item.candidates.map((candidate,index)=>`<button type="button" class="aag-candidate" data-job-candidate="${index}"><span><strong>${escapeHtml(name(candidate))}</strong><small>Index ${escapeHtml(candidate.current_index??'—')}</small></span><b>Asociar</b></button>`).join('')}<button type="button" class="btn secondary" data-job-skip>Crear jugador nuevo / no asociar</button></section>`;
      const decide=async playerId=>{acting=true;body.querySelectorAll('button').forEach(button=>button.disabled=true);try{const {job}=await decideIndexJob(current.id,item.aag.aag_member_number,playerId);current=job;seenVersion='';}catch(error){notify(error.message,'error');}finally{acting=false;await refresh(true);await renderDialog();}};
      body.querySelectorAll('[data-job-candidate]').forEach(button=>button.onclick=()=>decide(item.candidates[Number(button.dataset.jobCandidate)].id));
      body.querySelector('[data-job-skip]').onclick=()=>decide(null);
    }
  }
  if(current.status==='completed'&&current.history_id){
    body.innerHTML+=`<a class="btn primary" href="${reportUrl(current)}" target="_blank" rel="noopener">Ver informe / imprimir</a><div data-job-summary></div>`;
    const id=current.id,target=body.querySelector('[data-job-summary]');
    try{const report=await getAagSyncReport(current.history_id);if(target.isConnected&&current.id===id)target.innerHTML=syncSummaryHtml(report.data||{});}catch(_){/* The saved report remains accessible through its link. */}
  }
  if(current.status==='failed'){
    const button=document.createElement('button');button.className='btn primary';button.textContent='Reintentar actualización';body.appendChild(button);
    button.onclick=async()=>{button.disabled=true;try{const {job}=await retryIndexJob(current.id);current=job;seenVersion='';await refresh(true);}catch(error){notify(error.message,'error');button.disabled=false;}};
  }
  if('Notification'in window&&Notification.permission==='default'){
    const button=document.createElement('button');button.className='btn secondary';button.textContent='Activar avisos en esta PC';body.appendChild(button);button.onclick=async()=>{await Notification.requestPermission();button.remove();};
  }
}
function openView(){
  dialog?.remove();dialog=document.createElement('div');dialog.id='aagSyncDialog';dialog.className='drawer open aag-sync-dialog';
  dialog.innerHTML='<section class="drawer-panel aag-sync-panel"><div class="drawer-head"><div><div class="eyebrow">Sincronización oficial</div><h2>Actualizar Index</h2></div><button type="button" class="btn secondary small" data-job-close aria-label="Cerrar seguimiento">✕</button></div><div data-index-job-body></div></section>';
  const close=()=>{dialog.remove();dialog=null;};dialog.querySelector('[data-job-close]').onclick=close;dialog.onclick=event=>{if(event.target===dialog)close();};document.body.appendChild(dialog);renderDialog();
}
async function refresh(force=false){
  if(refreshing)return;refreshing=true;
  try{const job=await getLatestIndexJob();if(job){current=job;notification(job);renderBanner();const version=job.id+job.updated_at+job.status;if(force||version!==seenVersion){seenVersion=version;await renderDialog();}}}catch(_){/* A temporary network failure does not cancel a server task. */}
  finally{refreshing=false;clearTimeout(timer);timer=setTimeout(()=>refresh(),document.hidden?30000:10000);}
}
export function mountBackgroundIndexMonitor(){
  if(started)return;started=true;refresh();window.addEventListener('focus',()=>refresh());document.addEventListener('visibilitychange',()=>{if(!document.hidden)refresh();});
}
export async function startBackgroundIndex(){
  try{
    const existing=await getLatestIndexJob();
    if(existing&&active.has(existing.status)){current=existing;openView();return;}
    if(!await confirmAction({title:'Actualizar Index',message:'La actualización trabajará en segundo plano. Podés seguir usando el sistema y te avisaremos al terminar.',confirmText:'Iniciar actualización'}))return;
    const {job}=await startIndexJob();current=job;localStorage.setItem(key+'tracking',job.id);seenVersion='';renderBanner();openView();await refresh(true);
  }catch(error){notify(error.message||'No se pudo iniciar la actualización.','error');}
}
