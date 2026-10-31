import { loadTeeRecommendations, saveTeeRecommendations, TEE_NAMES } from './tee_recommendation_service.js';
import { escapeHtml, notify } from './ui.js';

const indexText=n=>Number(n).toLocaleString('es-AR',{maximumFractionDigits:2});
export async function mountTeeRecommendationSettings(host) {
  let snapshot=null,busy=false;
  const showError=message=>{const notice=host.querySelector('[data-tee-message]');if(notice){notice.className='notice warn';notice.hidden=false;notice.textContent=message;}};
  const readMale=()=>[...host.querySelectorAll('[data-tee-row]')].map(row=>({tee:row.querySelector('select').value,max_index:row.querySelector('input').value.trim()===''?null:Number(row.querySelector('input').value)}));
  const render=(male=snapshot.rules.male)=>{
    const used=new Set(male.map(rule=>rule.tee));
    host.innerHTML=`<form data-tee-form><div class="notice info">El primer rango empieza en Index -10. Cada límite incluye ese valor; el siguiente comienza por encima de ese límite. El último termina en 54.</div><div class="notice" data-tee-message role="status" hidden></div><section class="tee-rules-section"><div class="tee-rules-heading"><div><div class="eyebrow">Tees recomendados</div><h3>Caballeros</h3></div><button class="btn secondary small" type="button" data-tee-add ${male.length===4?'disabled':''}>＋ Agregar rango</button></div><div class="tee-rules-labels"><span>Tee</span><span>Desde</span><span>Hasta incluido</span><span></span></div>${male.map((rule,i)=>`<div class="tee-rule-row" data-tee-row><select class="control" aria-label="Tee del rango ${i+1}">${TEE_NAMES.map(name=>`<option value="${name}" ${name===rule.tee?'selected':''} ${used.has(name)&&name!==rule.tee?'disabled':''}>${name}</option>`).join('')}</select><span class="tee-rule-from" data-tee-from>${i===0?'-10 incluido':male[i-1].max_index==null?'Completá el anterior':'Más de '+indexText(male[i-1].max_index)}</span><input class="control" aria-label="Límite superior del rango ${i+1}" type="number" min="-10" max="54" step="any" required value="${rule.max_index??''}" ${i===male.length-1?'readonly':''}><button class="btn secondary small" type="button" data-tee-remove="${i}" aria-label="Quitar rango ${i+1}" ${male.length===1?'disabled':''}>×</button></div>`).join('')}<p class="subtle">Podés usar entre uno y cuatro rangos, sin repetir tees.</p></section><section class="tee-rules-section"><div class="eyebrow">Configuración actual</div><h3>Damas</h3><div class="tee-rules-readonly">${snapshot.rules.female.map((rule,i)=>`<span><b>${escapeHtml(rule.tee)}</b> · ${i===0?'Desde -10':'Más de '+indexText(snapshot.rules.female[i-1].max_index)} hasta ${indexText(rule.max_index)}</span>`).join('')}</div><p class="subtle">La configuración de damas se conserva sin cambios.</p></section><div class="tee-rules-preview" data-tee-preview></div><div class="tee-rules-actions"><button class="btn primary" type="submit">Guardar reglas</button><button class="btn secondary" type="button" data-tee-reload>Recargar</button></div><p class="subtle tee-rules-date">Última actualización: ${snapshot.updated_at?escapeHtml(new Date(snapshot.updated_at).toLocaleString('es-AR')):'Sin registro'}</p></form>`;
    const updatePreview=()=>{
      const rows=readMale();host.querySelectorAll('[data-tee-from]').forEach((el,i)=>el.textContent=i===0?'-10 incluido':rows[i-1].max_index==null?'Completá el anterior':'Más de '+indexText(rows[i-1].max_index));
      host.querySelector('[data-tee-preview]').textContent=rows.map((r,i)=>`${r.tee}: ${i===0?'-10':'más de '+indexText(rows[i-1].max_index??0)} a ${r.max_index==null?'…':indexText(r.max_index)}`).join(' · ');
    };
    host.querySelectorAll('[data-tee-row] input').forEach(input=>input.addEventListener('input',updatePreview));
    host.querySelectorAll('[data-tee-row] select').forEach(select=>select.addEventListener('change',()=>render(readMale())));
    host.querySelector('[data-tee-add]').onclick=()=>{
      const rows=readMale();if(rows.length>=4)return;
      const previous=rows.length>1?rows.at(-2).max_index:-10;
      if(previous==null || previous>=53.9){showError('Reducí el límite del penúltimo rango antes de agregar otro.');return;}
      rows.at(-1).max_index=Math.round(((previous+54)/2)*10)/10;
      rows.push({tee:TEE_NAMES.find(name=>!rows.some(rule=>rule.tee===name)),max_index:54});render(rows);
    };
    host.querySelectorAll('[data-tee-remove]').forEach(button=>button.onclick=()=>{const rows=readMale();rows.splice(Number(button.dataset.teeRemove),1);rows.at(-1).max_index=54;render(rows);});
    host.querySelector('[data-tee-reload]').onclick=()=>reload();
    host.querySelector('[data-tee-form]').onsubmit=async event=>{
      event.preventDefault();if(busy)return;busy=true;
      const rules={male:readMale(),female:snapshot.rules.female.map(rule=>({...rule}))};const controls=[...host.querySelectorAll('button,input,select')].map(el=>({el,disabled:el.disabled}));controls.forEach(({el})=>el.disabled=true);
      try{
        const result=await saveTeeRecommendations(snapshot,rules);snapshot=result.settings;
        if(!host.isConnected)return;
        render();
        if(result.conflict)showError('Otro administrador modificó estas reglas. Se recargó la configuración actual; revisala antes de volver a guardar.');
        else notify('Reglas de tee guardadas.','success');
      }catch(error){showError(error.message||'No se pudieron guardar las reglas.');controls.forEach(({el,disabled})=>el.disabled=disabled);}
      finally{busy=false;}
    };
    updatePreview();
  };
  const reload=async()=>{
    host.innerHTML='<div class="empty-state compact">Cargando reglas de tee…</div>';
    try{snapshot=await loadTeeRecommendations();if(host.isConnected)render();}
    catch(error){if(host.isConnected){host.innerHTML='<div class="notice warn" data-tee-message></div><button class="btn secondary" data-retry>Cargar de nuevo</button>';showError(error.message);host.querySelector('[data-retry]').onclick=reload;}}
  };
  await reload();
}
