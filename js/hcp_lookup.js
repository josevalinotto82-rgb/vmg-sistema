import { supabase } from "./supabase.js";
import { escapeHtml } from "./ui.js";

const number=value=>{if(value==null||value==="")return null;const parsed=Number(String(value).replace(",","."));return Number.isFinite(parsed)?parsed:null};
const normalize=value=>String(value||"").normalize("NFD").replace(/[\u0300-\u036f]/g,"").replace(/,/g," ").replace(/\s+/g," ").trim().toUpperCase();
const gender=value=>["female","f","dama","damas","mujer","femenino"].includes(String(value||"").toLowerCase())?"female":"male";
const parFromHoles=holes=>{const values=(Array.isArray(holes)?holes:[]).map(hole=>number(hole?.Par??hole?.par??hole?.par_value)).filter(value=>value!=null);return values.length?values.reduce((sum,value)=>sum+value,0):null};
const playingHandicap=(index,tee)=>{const slope=number(tee.slope_total),rating=number(tee.calification_total),par=parFromHoles(tee.holes);if([index,slope,rating,par].some(value=>value==null))return null;return Math.min(Math.floor(index*slope/113+(rating-par)+.5),54)};
const recommended=(index,playerGender,tee)=>{if(Number(tee.aag_field_id)!==1466)return false;const name=normalize(tee.tee_name);if(playerGender==="female")return name.includes("ROJ");if(index>=-10&&index<=9)return name.includes("NEGR");if(index>9&&index<=15)return name.includes("AMARILL");return index>15&&index<=54&&name.includes("BLANC")};
const initials=value=>normalize(value).replace(/CLUB|GOLF|COUNTRY/g,"").split(/\s+/).filter(Boolean).slice(0,3).map(word=>word[0]).join("")||"GC";

async function searchPlayers(term){
  const raw=String(term||"").trim(),words=normalize(raw).split(" ").filter(Boolean),pattern=`%${words.join("%")}%`,numeric=/^\d+$/.test(raw.replace(/\s/g,""));
  let query=supabase.from("aag_enrolleds").select("enrollment_number,first_name,last_name,full_name,gender,current_index,club_name,search_text");
  query=numeric?query.eq("enrollment_number",raw.replace(/\s/g,"")):query.ilike("search_text",pattern);
  const{data,error}=await query.limit(8);if(error)throw error;return(data||[]).filter(player=>words.every(word=>normalize(`${player.full_name} ${player.last_name} ${player.first_name} ${player.enrollment_number}`).includes(word)));
}

async function loadTees(player){
  const playerGender=gender(player.gender),category=playerGender==="female"?1:0,index=number(player.current_index);
  if(index==null)throw new Error("El jugador no tiene un Index vigente cargado.");
  const{data,error}=await supabase.from("aag_teeouts").select("id,aag_field_id,aag_teeout_id,teeout_number,tee_name,category,slope_total,calification_total,holes").in("aag_field_id",[1466,2048]).eq("category",category);if(error)throw error;
  return{index,playerGender,tees:(data||[]).sort((a,b)=>[1466,2048].indexOf(Number(a.aag_field_id))-[1466,2048].indexOf(Number(b.aag_field_id))||(number(a.teeout_number)??999)-(number(b.teeout_number)??999)||String(a.tee_name).localeCompare(String(b.tee_name),"es"))};
}

function resultHtml(player,data){
  const name=player.full_name||`${player.last_name||""}, ${player.first_name||""}`,club=player.club_name||"Club no informado",vmgc=normalize(club).includes("VILLA MARIA GOLF"),groups=[1466,2048].map(id=>({id,name:id===1466?"Cancha Adultos":"Cancha Junior",rows:data.tees.filter(tee=>Number(tee.aag_field_id)===id)})).filter(group=>group.rows.length);
  return`<div class="hcp-profile"><header>${vmgc?'<img src="escudo.png" alt="VMGC">':`<span class="hcp-club-avatar">${escapeHtml(initials(club))}</span>`}<div><h2>${escapeHtml(name)}</h2><p>${escapeHtml(club)}</p><small>Matrícula ${escapeHtml(player.enrollment_number||"—")} · Index <b>${data.index.toFixed(1)}</b></small></div></header>${groups.map(group=>`<section><h3>${group.name}</h3>${group.rows.map(tee=>{const hcp=playingHandicap(data.index,tee),par=parFromHoles(tee.holes),isRecommended=recommended(data.index,data.playerGender,tee);return`<article class="hcp-tee-result ${isRecommended?"recommended":""}"><div><strong>${escapeHtml(tee.tee_name||`Tee ${tee.aag_teeout_id}`)}</strong>${isRecommended?'<span>TEE RECOMENDADO</span>':""}</div><dl><div><dt>HCP</dt><dd>${hcp??"—"}</dd></div><div><dt>Slope</dt><dd>${number(tee.slope_total)??"—"}</dd></div><div><dt>Rating</dt><dd>${number(tee.calification_total)?.toFixed(1)??"—"}</dd></div><div><dt>Par</dt><dd>${par??"—"}</dd></div></dl></article>`}).join("")}</section>`).join("")}</div>`;
}

export function mountHcpLookup(host){
  if(!host)return;host.innerHTML=`<section class="home-hcp-card"><div class="home-hcp-copy"><span class="home-hcp-icon">⌕</span><div><strong>Consulta HCP</strong><small>Buscá un jugador por nombre, apellido o matrícula.</small></div></div><div class="home-hcp-search"><input class="control" data-hcp-search autocomplete="off" placeholder="Nombre, apellido o matrícula"><div class="home-hcp-results" data-hcp-results hidden></div></div></section>`;
  const input=host.querySelector("[data-hcp-search]"),results=host.querySelector("[data-hcp-results]");let timer=0,players=[];
  const closeResults=()=>{results.hidden=true;results.innerHTML=""};
  input.addEventListener("input",()=>{clearTimeout(timer);const term=input.value.trim();if(term.length<2)return closeResults();timer=setTimeout(async()=>{results.hidden=false;results.innerHTML='<div class="home-hcp-message">Buscando…</div>';try{players=await searchPlayers(term);results.innerHTML=players.length?players.map((player,index)=>`<button type="button" data-hcp-player="${index}"><strong>${escapeHtml(player.full_name||`${player.last_name||""}, ${player.first_name||""}`)}</strong><small>Matrícula ${escapeHtml(player.enrollment_number||"—")} · Index ${number(player.current_index)?.toFixed(1)??"—"} · ${escapeHtml(player.club_name||"Sin club")}</small></button>`).join(""):'<div class="home-hcp-message">No se encontraron jugadores.</div>'}catch(error){results.innerHTML=`<div class="home-hcp-message error">${escapeHtml(error.message)}</div>`}},280)});
  results.addEventListener("click",async event=>{const button=event.target.closest("[data-hcp-player]");if(!button)return;const player=players[Number(button.dataset.hcpPlayer)];if(!player)return;input.value=player.full_name||`${player.last_name||""}, ${player.first_name||""}`;closeResults();const modal=document.createElement("div");modal.className="drawer open hcp-modal";modal.innerHTML='<section class="drawer-panel hcp-modal-panel"><div class="drawer-head"><div><div class="eyebrow">Consulta AAG</div><h2>HCP por tee</h2></div><button class="btn secondary small" data-close>✕</button></div><div data-content><div class="empty-state compact">Calculando HCP…</div></div></section>';document.body.appendChild(modal);const close=()=>{modal.remove();input.value="";input.focus()};modal.querySelector("[data-close]").onclick=close;modal.onclick=event=>{if(event.target===modal)close()};try{modal.querySelector("[data-content]").innerHTML=resultHtml(player,await loadTees(player))}catch(error){modal.querySelector("[data-content]").innerHTML=`<div class="notice warn">${escapeHtml(error.message)}</div>`}});
  document.addEventListener("click",event=>{if(!host.contains(event.target))closeResults()});
}
