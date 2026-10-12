import { requireSession } from './auth.js';
import { supabase } from './supabase.js';
await requireSession({admin:true});
const byId=id=>document.getElementById(id);
let imageUrl;
for(const name of ['title','body'])byId(`notice-${name}`).addEventListener('input',()=>{byId(`preview-${name}`).textContent=byId(`notice-${name}`).value;});
byId('notice-image').addEventListener('change',()=>{
  if(imageUrl)URL.revokeObjectURL(imageUrl);
  const file=byId('notice-image').files[0],image=byId('preview-image');image.hidden=true;
  if(!file)return;
  if(!['image/png','image/jpeg','image/webp'].includes(file.type)||file.size>10*1024*1024){byId('notice-status').textContent='Elegí un JPG, PNG o WebP de hasta 10 MB.';byId('notice-image').value='';return;}
  imageUrl=URL.createObjectURL(file);image.src=imageUrl;image.hidden=false;
});
let noticeId=crypto.randomUUID(),uploadUrl=null,busy=false;
byId('notice-image').addEventListener('change',()=>{uploadUrl=null;});
async function prepareImage(file){
  const bitmap=await createImageBitmap(file);
  const canvas=document.createElement('canvas');
  const scale=Math.min(1,1200/Math.max(bitmap.width,bitmap.height));
  canvas.width=Math.max(1,Math.round(bitmap.width*scale));canvas.height=Math.max(1,Math.round(bitmap.height*scale));
  const ctx=canvas.getContext('2d');ctx.fillStyle='white';ctx.fillRect(0,0,canvas.width,canvas.height);ctx.drawImage(bitmap,0,0,canvas.width,canvas.height);bitmap.close();
  const blob=await new Promise(resolve=>canvas.toBlob(resolve,'image/jpeg',.8));
  if(!blob||blob.size>1048576)throw Error('El flyer es demasiado pesado. Probá una imagen más pequeña.');
  return blob;
}
byId('notice-form').addEventListener('submit',async event=>{
  event.preventDefault();if(busy)return;
  if(!confirm('¿Enviar este aviso a los jugadores con notificaciones activadas?'))return;
  busy=true;const button=event.currentTarget.querySelector('[type="submit"]');button.disabled=true;
  try{
    byId('notice-status').textContent='Preparando envío…';
    const file=byId('notice-image').files[0];
    if(file&&!uploadUrl){
      const blob=await prepareImage(file),path=noticeId+'.jpg';
      const uploaded=await supabase.storage.from('club-notice-images').upload(path,blob,{contentType:'image/jpeg',upsert:false});
      if(uploaded.error)throw uploaded.error;
      uploadUrl=supabase.storage.from('club-notice-images').getPublicUrl(path).data.publicUrl;
    }
    const result=await supabase.functions.invoke('club-notifications',{body:{action:'manual',id:noticeId,title:byId('notice-title').value,body:byId('notice-body').value,image_url:uploadUrl}});
    if(result.error)throw result.error;if(result.data?.error)throw Error(result.data.error);
    byId('notice-status').textContent='Aviso guardado. Los envíos se procesan durante el próximo minuto.';
    byId('notice-form').reset();byId('preview-image').hidden=true;noticeId=crypto.randomUUID();uploadUrl=null;
  }catch(error){byId('notice-status').textContent='No se pudo completar el envío: '+error.message;}
  finally{busy=false;button.disabled=false;}
});
