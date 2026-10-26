import { orderedGridBlocks, sequentialLineGroups } from './registration_grid_order.js';
import { escapeHtml, formatDate, notify, setBusy } from './ui.js';
import { isEmpty, isReservation } from './registration_service.js';

const PAGE_WIDTH = 1200, PAGE_HEIGHT = 1697, TABLE_BUDGET = 1460;
const short = name => {
  const [surname, given] = String(name || '').split(',');
  if (given === undefined) return String(name || '');
  const words = surname.trim().split(/\s+/).filter(Boolean);
  const initials = text => text.trim().split(/\s+/).filter(Boolean).map(word => `${word[0].toUpperCase()}.`).join(' ');
  return `${words[0] || ''}${words.length > 1 ? ' ' + initials(words.slice(1).join(' ')) : ''}, ${initials(given)}`;
};
const minutes = (time, add = 0) => {
  const [h,m] = String(time || '').slice(0,5).split(':').map(Number);
  if (!Number.isFinite(h) || !Number.isFinite(m)) return add ? '—' : null;
  const total = (h * 60 + m + add) % 1440;
  return add ? `${String(Math.floor(total/60)).padStart(2,'0')}:${String(total%60).padStart(2,'0')}` : total;
};
const kind = slot => !slot.aag_member_number ? 'manual' : Number(slot.option_club_id) === 408 || /VILLA MAR[IÍ]A/i.test(slot.club_name || '') ? 'member' : 'visitor';
const cell = slot => {
  if (slot?.participant_type === 'blocked') return '<td class="share-blocked">BLOQUEADO</td>';
  if (slot && isReservation(slot)) return '<td class="share-reserved">RESERVADO</td>';
  if (!slot || isEmpty(slot)) return '<td class="share-empty"></td>';
  return `<td class="share-player ${kind(slot)}"><span class="share-name">${escapeHtml(short(slot.display_name))}</span><i class="share-player-bar" aria-hidden="true"></i></td>`;
};
const styles = `
.share-sheet.share-approved{box-sizing:border-box;width:1200px;height:1697px;padding:36px;background:#fff;color:#000;font-family:Arial,Helvetica,sans-serif;overflow:hidden;display:flex;flex-direction:column}
.share-approved .share-header{display:flex;align-items:center;gap:20px;padding:0 0 14px;height:98px;flex-shrink:0}
.share-approved .share-header img{width:66px;height:80px;object-fit:contain}
.share-approved .share-header>div{min-width:0;flex:1}
.share-approved .share-header h1{margin:3px 0 7px;font-size:38px;line-height:1.06;color:#163d2b;white-space:nowrap}
.share-approved .share-header p{margin:0;font-size:18px;font-weight:400;color:#444}
.share-approved .share-club{font-size:18px;letter-spacing:0;font-weight:700;color:#163d2b}
.share-approved .share-rule{height:6px;min-height:6px;margin:0 0 12px;border-radius:0;background:linear-gradient(90deg,#163d2b 0%,#163d2b 80%,#c8a13a 80%,#c8a13a 100%)}
.share-approved table{width:100%;border-collapse:collapse;table-layout:fixed;border:1px solid #8b9890}
.share-approved td{box-sizing:border-box;position:relative;height:var(--share-row);padding:3px 5px;border:1px solid #8b9890;text-align:center;vertical-align:middle;font-size:22px;line-height:1.05;font-weight:700;overflow-wrap:normal;background:#fff;color:#000}
.share-approved .share-player{background:#fff!important;padding-right:16px;padding-left:5px;white-space:nowrap;text-shadow:none}
.share-approved .share-player-bar{position:absolute;right:1px;top:2px;bottom:2px;width:8px;background:#459d68}
.share-approved .visitor .share-player-bar{background:#4899c4}.share-approved .manual .share-player-bar{background:#9b6cb1}
.share-approved .share-section td{height:40px;padding:5px;font-size:23px;font-weight:700;letter-spacing:0;background:#dcece2;color:#163d2b;border:1px solid #8b9890}
.share-approved .share-reference{width:76px;background:#fff!important;font-size:20px!important;color:#222;white-space:nowrap;font-weight:700}
.share-approved .share-col-reference{width:76px}.share-approved .share-col-reference.shotgun{width:82px}
.share-approved .share-extra{width:68px;background:#fff;color:#333;font-size:19px!important}.share-approved .share-col-extra{width:68px}
.share-approved .share-blocked,.share-approved .share-reserved{background:#fff;color:#666;font-size:20px!important;letter-spacing:0}
.share-approved .share-shift-divider td{height:7px;padding:0;background:linear-gradient(#c8a13a,#c8a13a) center / 100% 3px no-repeat;border:0}
.share-approved footer{display:flex;align-items:center;gap:24px;flex-shrink:0;padding:12px 0 0;font-size:15px;color:#444}
.share-approved footer span{display:flex;align-items:center;gap:8px}.share-approved footer strong{margin-left:auto;font-size:14px;font-weight:400;color:#555}
.share-approved .share-legend{display:inline-block;width:8px;height:18px;margin:0;border-radius:0;background:#459d68}.share-approved .share-legend.visitor{background:#4899c4}.share-approved .share-legend.manual{background:#9b6cb1}
`;
function pageGroups(data) {
  const sequential = data.tournament.start_type !== 'simultanea';
  const groups = orderedGridBlocks(data.tournament,data.blocks,data.lines).flatMap(block => {
    const lines = data.lines.filter(l => l.starting_block_id === block.id).sort((a,b) => sequential ? Number(a.display_order || 0)-Number(b.display_order || 0) : Number(a.starting_hole || 0)-Number(b.starting_hole || 0) || Number(/BIS/i.test(a.label || ''))-Number(/BIS/i.test(b.label || '')) || Number(a.display_order || 0)-Number(b.display_order || 0));
    const shifts=sequential?sequentialLineGroups(lines):[{lines}];let offset=0;const breaks=[];for(const shift of shifts){if(offset)breaks.push(offset);offset+=shift.lines.length;}return [{block,lines,breaks,continued:false}];
  }).filter(group => group.lines.length);
  const size = groups => groups.reduce((sum,g) => sum+40+g.lines.length*36+(g.breaks?.length||0)*7,0);
  const pages = []; let current = [];
  for (const group of groups) {
    const parts = size([group]) <= TABLE_BUDGET ? [group] : Array.from({length:Math.ceil(group.lines.length/32)},(_,i) => ({...group,lines:group.lines.slice(i*32,(i+1)*32),breaks:(group.breaks||[]).filter(index=>index>i*32&&index<(i+1)*32).map(index=>index-i*32),continued:i>0}));
    for (const part of parts) {
      if (current.length && size([...current,part]) > TABLE_BUDGET) { pages.push(current);current=[]; }
      current.push(part);
    }
  }
  if (current.length) pages.push(current);
  return pages.length ? pages : [[]];
}
export function buildRegistrationGrid(data) {
  const {tournament,slots} = data, sequential = tournament.start_type !== 'simultanea', holes = Number(tournament.hole_count || 18), pass = sequential && holes === 18, finish = sequential, columns = 5+Number(pass)+Number(finish), pages = pageGroups(data);
  const slotsByLine = new Map();
  for (const slot of slots) { if (!slotsByLine.has(slot.starting_line_id)) slotsByLine.set(slot.starting_line_id,new Map());slotsByLine.get(slot.starting_line_id).set(Number(slot.slot_number),slot); }
  return pages.map((groups,pageIndex) => {
    const count = groups.reduce((n,g) => n+g.lines.length,0), dividers = groups.reduce((n,g) => n+(g.breaks?.length||0),0);
    const rowHeight = Math.min(44,Math.floor((TABLE_BUDGET-groups.length*40-dividers*7)/Math.max(count,1)));
    let rows = '';
    for (const group of groups) {
      const title = sequential ? `SALIDA POR HOYO ${Number(group.lines[0]?.starting_hole || 0)}` : `SALIDA SIMULTÁNEA · ${String(group.block.start_time || group.lines[0]?.line_time || '').slice(0,5)}`;
      rows += `<tr class="share-section"><td colspan="${columns}">${escapeHtml(title)}${group.continued?' · CONTINUACIÓN':''}</td></tr>`;
      group.lines.forEach((line,index) => {
        if (group.breaks?.includes(index)) rows += `<tr class="share-shift-divider"><td colspan="${columns}"></td></tr>`;
        const reference = sequential ? String(line.line_time || '').slice(0,5) : `H${Number(line.starting_hole || 0)}${/BIS/i.test(line.label || '')?' BIS':''}`;
        const map = slotsByLine.get(line.id);
        rows += `<tr><td class="share-reference">${escapeHtml(reference)}</td>${[1,2,3,4].map(n => cell(map?.get(n))).join('')}${pass?`<td class="share-extra">${minutes(line.line_time,150)}</td>`:''}${finish?`<td class="share-extra">${minutes(line.line_time,holes===18?300:150)}</td>`:''}</tr>`;
      });
    }
    return `<section class="share-sheet share-approved" style="--share-row:${rowHeight}px"><style>${styles}</style><header class="share-header"><img src="escudo.png" alt=""><div><div class="share-club">VILLA MARÍA GOLF CLUB</div><h1>${escapeHtml(tournament.name || 'TORNEO')}</h1><p>${formatDate(tournament.tournament_date)} · ${escapeHtml(tournament.game_modes?.name || '')} · ${holes} HOYOS · ${sequential?'SALIDA SECUENCIAL':'SALIDA SIMULTÁNEA'}</p></div></header><div class="share-rule"></div><table><colgroup><col class="share-col-reference${sequential?'':' shotgun'}"><col span="4" class="share-col-player">${pass?'<col class="share-col-extra">':''}${finish?'<col class="share-col-extra">':''}</colgroup><tbody>${rows}</tbody></table><footer><span><i class="share-legend member"></i>Socio VMGC</span><span><i class="share-legend visitor"></i>Invitado</span><span><i class="share-legend manual"></i>Carga manual</span><strong>Planilla actualizada · ${pageIndex+1} / ${pages.length}</strong></footer></section>`;
  }).join('');
}
export async function exportRegistrationGrid({data,button,wrap}) {
  const original=button?.textContent;
  try {
    setBusy(button,true,'Generando grilla…');
    if(typeof window.html2canvas!=='function')throw new Error('No se pudo cargar el generador de imágenes.');
    wrap.innerHTML=buildRegistrationGrid(data);
    await Promise.all([...wrap.querySelectorAll('img')].map(img=>img.complete?Promise.resolve():new Promise(resolve=>{img.onload=img.onerror=resolve;})));
    if(document.fonts?.ready)await document.fonts.ready;
    const measure=document.createElement('canvas').getContext('2d');
    for(const cell of wrap.querySelectorAll('.share-player')) {
      const css=getComputedStyle(cell),available=cell.clientWidth-parseFloat(css.paddingLeft)-parseFloat(css.paddingRight)-2;
      measure.font='700 22px Arial';const width=measure.measureText(cell.textContent).width;
      if(width>available)cell.querySelector('.share-name').style.fontSize=Math.max(8,Math.floor(22*available/width*10)/10)+'px';
    }
    for(const title of wrap.querySelectorAll('h1')){let size=38;while(title.scrollWidth>title.clientWidth&&size>14){title.style.fontSize=(--size)+'px';}}
    await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));
    const canvases=[];
    for(const node of wrap.querySelectorAll('.share-sheet'))canvases.push(await window.html2canvas(node,{backgroundColor:'#fff',scale:/iPad|iPhone|iPod/.test(navigator.userAgent)?1.25:2,useCORS:true,logging:false,width:PAGE_WIDTH,height:PAGE_HEIGHT,windowWidth:PAGE_WIDTH,windowHeight:PAGE_HEIGHT}));
    const base=String(data.tournament.name||'grilla').normalize('NFD').replace(/[\u0300-\u036f]/g,'').replace(/[^a-zA-Z0-9]+/g,'-').replace(/^-+|-+$/g,'').toLowerCase()||'grilla';
    const files=await Promise.all(canvases.map(async(canvas,i)=>new File([await new Promise((resolve,reject)=>canvas.toBlob(blob=>blob?resolve(blob):reject(new Error('No se pudo generar la imagen.')),'image/png'))],`${base}${canvases.length>1?'-hoja-'+(i+1):''}.png`,{type:'image/png'})));
    const mobile=/Android|iPhone|iPad|iPod/i.test(navigator.userAgent)||matchMedia('(pointer: coarse)').matches;
    if(mobile&&navigator.share&&navigator.canShare?.({files})){
      try{await navigator.share({files,title:`Grilla ${data.tournament.name}`,text:'Planilla actualizada ⛳'});return;}catch(error){if(error?.name==='AbortError')return;}
    }
    for(const file of files){const url=URL.createObjectURL(file),link=document.createElement('a');link.href=url;link.download=file.name;document.body.appendChild(link);link.click();link.remove();setTimeout(()=>URL.revokeObjectURL(url),30000);}
  }catch(error){notify(error.message||'No se pudo generar la grilla.','error');}
  finally{setBusy(button,false);if(button)button.textContent=original;}
}
