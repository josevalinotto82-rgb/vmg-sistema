import { requireSession } from "./auth.js";
import { escapeHtml, notify } from "./ui.js";
import { listTvFolder, publicTvMediaUrl, removeTvFile, removeTvFolder, uploadTvFile } from "./tv_service.js";

const context=await requireSession();if(context.profile.role!=="admin"){location.replace("panel.html");throw new Error("Acceso restringido")}
const byId=id=>document.getElementById(id),FOLDERS={photos:"leaderboard",fixed:"fixed",sponsors:"sponsors",audio:"audio"},MAX_PHOTOS=10,MAX_SPONSORS=20,MAX_AUDIO=30*1024*1024;
const setMain=(text,type="info")=>{const node=byId("tvMediaState");node.textContent=text;node.className=`status ${type}`};
const setText=(id,text)=>{byId(id).textContent=text};
const formatBytes=bytes=>{const n=Number(bytes||0);return n>=1048576?`${(n/1048576).toFixed(2)} MB`:`${Math.round(n/1024)} KB`};
const loadImage=file=>new Promise((resolve,reject)=>{const image=new Image(),url=URL.createObjectURL(file);image.onload=()=>{URL.revokeObjectURL(url);resolve(image)};image.onerror=()=>{URL.revokeObjectURL(url);reject(new Error(`No se pudo leer ${file.name}`))};image.src=url});
async function imageBlob(file,{format="jpeg",maxWidth=1600,quality=.75}={}){
  const image=await loadImage(file),scale=Math.min(1,maxWidth/image.width),canvas=document.createElement("canvas");canvas.width=Math.round(image.width*scale);canvas.height=Math.round(image.height*scale);const context=canvas.getContext("2d");if(format==="jpeg"){context.fillStyle="#fff";context.fillRect(0,0,canvas.width,canvas.height)}context.drawImage(image,0,0,canvas.width,canvas.height);
  const blob=await new Promise(resolve=>canvas.toBlob(resolve,format==="png"?"image/png":"image/jpeg",quality));if(!blob)throw new Error(`No se pudo optimizar ${file.name}`);return blob;
}
function mediaCard(path,file,compact=false){return`<article class="tv-media-item ${compact?"compact":""}"><img src="${publicTvMediaUrl(path)}" alt="${escapeHtml(file.name)}"><div><strong>${escapeHtml(file.name)}</strong><small>${formatBytes(file.metadata?.size)}</small></div></article>`}
async function renderFolder(folder,gridId,statusId,compact=false){
  const files=await listTvFolder(folder);byId(gridId).innerHTML=files.map(file=>mediaCard(`${folder}/${file.name}`,file,compact)).join("")||'<div class="empty-state compact">No hay archivos cargados.</div>';setText(statusId,files.length?`${files.length} archivo(s) actual(es).`:"Sin archivos cargados.");return files;
}
async function renderFixed(type){
  const filename=type==="logo"?"logo.png":"qr.png",gridId=type==="logo"?"tvLogoGrid":"tvQrGrid",statusId=type==="logo"?"tvLogoStatus":"tvQrStatus",path=`${FOLDERS.fixed}/${filename}`;byId(gridId).innerHTML=`<article class="tv-media-item compact"><img src="${publicTvMediaUrl(path)}" alt="${type}" onerror="this.closest('article').remove();document.getElementById('${statusId}').textContent='No hay archivo cargado.'"><div><strong>${escapeHtml(path)}</strong></div></article>`;setText(statusId,path);
}
async function renderAudio(){
  const files=await listTvFolder(FOLDERS.audio),exists=files.some(file=>file.name==="musica.mp3");byId("tvAudioPlayer").innerHTML=exists?`<audio controls preload="none"><source src="${publicTvMediaUrl("audio/musica.mp3")}" type="audio/mpeg"></audio>`:'<div class="empty-state compact">No hay música cargada.</div>';setText("tvAudioStatus",exists?`Música actual · ${formatBytes(files.find(file=>file.name==="musica.mp3")?.metadata?.size)}`:"Sin música cargada.");
}
async function refreshAll(){setMain("Actualizando biblioteca…","pending");try{await Promise.all([renderFolder(FOLDERS.photos,"tvPhotoGrid","tvPhotoStatus"),renderFixed("logo"),renderFixed("qr"),renderAudio(),renderFolder(FOLDERS.sponsors,"tvSponsorGrid","tvSponsorStatus")]);setMain("Biblioteca actualizada","open")}catch(error){setMain("Error de lectura","danger");notify(error.message||"No se pudo leer TV Multimedia.","error")}}
async function replacePhotos(){
  const files=[...(byId("tvPhotoInput").files||[])];if(!files.length)return notify("Seleccioná al menos una foto.","error");if(files.length>MAX_PHOTOS)return notify(`Podés subir hasta ${MAX_PHOTOS} fotos.`,"error");
  const button=byId("uploadTvPhotos");button.disabled=true;
  try{const ready=[];for(let i=0;i<files.length;i++){setText("tvPhotoStatus",`Optimizando ${i+1}/${files.length}…`);ready.push({name:`foto_${String(i+1).padStart(2,"0")}.jpg`,blob:await imageBlob(files[i],{format:"jpeg",maxWidth:1600,quality:.75})})}await removeTvFolder(FOLDERS.photos);for(let i=0;i<ready.length;i++){setText("tvPhotoStatus",`Subiendo ${i+1}/${ready.length}…`);await uploadTvFile(`${FOLDERS.photos}/${ready[i].name}`,ready[i].blob,{contentType:"image/jpeg"})}byId("tvPhotoInput").value="";await renderFolder(FOLDERS.photos,"tvPhotoGrid","tvPhotoStatus");notify("Fotos del TV reemplazadas.","success")}
  catch(error){setText("tvPhotoStatus",`Error: ${error.message}`);notify(error.message,"error")}finally{button.disabled=false}
}
async function replaceFixed(type){
  const input=byId(type==="logo"?"tvLogoInput":"tvQrInput"),file=input.files?.[0];if(!file)return notify("Seleccioná una imagen.","error");const button=byId(type==="logo"?"uploadTvLogo":"uploadTvQr"),filename=type==="logo"?"logo.png":"qr.png";button.disabled=true;
  try{const blob=await imageBlob(file,{format:"png",maxWidth:type==="logo"?1200:900});await uploadTvFile(`${FOLDERS.fixed}/${filename}`,blob,{contentType:"image/png"});input.value="";await renderFixed(type);notify(`${type==="logo"?"Logo":"QR"} actualizado.`,"success")}catch(error){notify(error.message,"error")}finally{button.disabled=false}
}
async function replaceSponsors(){
  const files=[...(byId("tvSponsorInput").files||[])];if(!files.length)return notify("Seleccioná al menos un sponsor.","error");if(files.length>MAX_SPONSORS)return notify(`Podés subir hasta ${MAX_SPONSORS} sponsors.`,"error");const button=byId("uploadTvSponsors");button.disabled=true;
  try{const ready=[];for(let i=0;i<files.length;i++){setText("tvSponsorStatus",`Optimizando ${i+1}/${files.length}…`);ready.push({name:`sponsor_${String(i+1).padStart(2,"0")}.png`,blob:await imageBlob(files[i],{format:"png",maxWidth:1400})})}await removeTvFolder(FOLDERS.sponsors);for(let i=0;i<ready.length;i++){setText("tvSponsorStatus",`Subiendo ${i+1}/${ready.length}…`);await uploadTvFile(`${FOLDERS.sponsors}/${ready[i].name}`,ready[i].blob,{contentType:"image/png"})}byId("tvSponsorInput").value="";await renderFolder(FOLDERS.sponsors,"tvSponsorGrid","tvSponsorStatus");notify("Sponsors reemplazados.","success")}catch(error){setText("tvSponsorStatus",`Error: ${error.message}`);notify(error.message,"error")}finally{button.disabled=false}
}
async function replaceAudio(){
  const file=byId("tvAudioInput").files?.[0];if(!file)return notify("Seleccioná un archivo MP3.","error");if(file.type!=="audio/mpeg"&&!/\.mp3$/i.test(file.name))return notify("El archivo debe ser MP3.","error");if(file.size>MAX_AUDIO)return notify("El MP3 supera los 30 MB.","error");const button=byId("uploadTvAudio");button.disabled=true;
  try{setText("tvAudioStatus",`Subiendo ${file.name} · ${formatBytes(file.size)}…`);await uploadTvFile("audio/musica.mp3",file,{contentType:"audio/mpeg"});byId("tvAudioInput").value="";await renderAudio();notify("Música del TV actualizada.","success")}catch(error){setText("tvAudioStatus",`Error: ${error.message}`);notify(error.message,"error")}finally{button.disabled=false}
}
async function deleteFolder(folder,grid,statusId,message){
  if(!confirm(message))return;try{const count=await removeTvFolder(folder);await renderFolder(folder,grid,statusId);notify(count?`Se eliminaron ${count} archivo(s).`:"No había archivos para borrar.","success")}catch(error){notify(error.message,"error")}
}
function bindFilePicker(buttonId,inputId,statusId,label){
  const button=byId(buttonId),input=byId(inputId);
  button.addEventListener("click",()=>input.click());
  input.addEventListener("change",()=>{
    const files=[...(input.files||[])];
    if(!files.length)return;
    const names=files.slice(0,3).map(file=>file.name).join(", "),more=files.length>3?` y ${files.length-3} más`:"";
    setText(statusId,`${files.length} ${label}${files.length===1?"":"s"} seleccionado${files.length===1?"":"s"}: ${names}${more}.`);
  });
}
bindFilePicker("chooseTvPhotos","tvPhotoInput","tvPhotoStatus","foto");
bindFilePicker("chooseTvLogo","tvLogoInput","tvLogoStatus","imagen");
bindFilePicker("chooseTvQr","tvQrInput","tvQrStatus","imagen");
bindFilePicker("chooseTvAudio","tvAudioInput","tvAudioStatus","archivo");
bindFilePicker("chooseTvSponsors","tvSponsorInput","tvSponsorStatus","sponsor");
byId("uploadTvPhotos").addEventListener("click",replacePhotos);byId("deleteTvPhotos").addEventListener("click",()=>deleteFolder(FOLDERS.photos,"tvPhotoGrid","tvPhotoStatus","¿Borrar todas las fotos actuales del TV?"));
byId("uploadTvLogo").addEventListener("click",()=>replaceFixed("logo"));byId("uploadTvQr").addEventListener("click",()=>replaceFixed("qr"));byId("uploadTvSponsors").addEventListener("click",replaceSponsors);byId("deleteTvSponsors").addEventListener("click",()=>deleteFolder(FOLDERS.sponsors,"tvSponsorGrid","tvSponsorStatus","¿Borrar todos los sponsors actuales?"));
byId("uploadTvAudio").addEventListener("click",replaceAudio);byId("deleteTvAudio").addEventListener("click",async()=>{if(!confirm("¿Borrar la música ambiental actual?"))return;try{await removeTvFile("audio/musica.mp3");await renderAudio();notify("Música eliminada.","success")}catch(error){notify(error.message,"error")}});
byId("refreshTvMedia").addEventListener("click",refreshAll);byId("closeTvMedia").addEventListener("click",()=>{if(window.opener)window.close();else location.href="panel.html"});
await refreshAll();
