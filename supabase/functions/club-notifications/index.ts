import { createClient } from 'npm:@supabase/supabase-js@2.117.2';
const cors={'Access-Control-Allow-Origin':'*','Access-Control-Allow-Headers':'authorization,apikey,content-type,x-client-info,x-supabase-api-version,x-dispatch-key','Access-Control-Allow-Methods':'POST,OPTIONS'};
const db=createClient(Deno.env.get('SUPABASE_URL')!,Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,{auth:{persistSession:false}});
const reply=(data:unknown,status=200)=>Response.json(data,{status,headers:cors});
function config(){let c;try{c=JSON.parse(Deno.env.get('FIREBASE_SERVICE_ACCOUNT')||'{}');}catch{throw Error('Configuración de Firebase inválida');}if(c.project_id!=='villa-maria-golf'||!c.private_key||!c.client_email)throw Error('Configuración de Firebase incompleta');return c;}
const b64=(bytes:Uint8Array)=>btoa(String.fromCharCode(...bytes)).replace(/=/g,'').replace(/\+/g,'-').replace(/\//g,'_');
const encoded=(v:unknown)=>b64(new TextEncoder().encode(JSON.stringify(v)));
async function oauth(){
 const c=config(),now=Math.floor(Date.now()/1000);
 const text=encoded({alg:'RS256',typ:'JWT'})+'.'+encoded({iss:c.client_email,scope:'https://www.googleapis.com/auth/firebase.messaging',aud:'https://oauth2.googleapis.com/token',iat:now,exp:now+3600});
 const pem=c.private_key.replace(/-----[^-]+-----/g,'').replace(/\s/g,'');
 const key=await crypto.subtle.importKey('pkcs8',Uint8Array.from(atob(pem),c=>c.charCodeAt(0)),{name:'RSASSA-PKCS1-v1_5',hash:'SHA-256'},false,['sign']);
 const assertion=text+'.'+b64(new Uint8Array(await crypto.subtle.sign('RSASSA-PKCS1-v1_5',key,new TextEncoder().encode(text))));
 const r=await fetch('https://oauth2.googleapis.com/token',{method:'POST',body:new URLSearchParams({grant_type:'urn:ietf:params:oauth:grant-type:jwt-bearer',assertion})});
 const result=await r.json();if(!r.ok||!result.access_token)throw Error('Firebase no autorizó el envío');return result.access_token;
}
Deno.serve(async req=>{
 if(req.method==='OPTIONS')return new Response('ok',{headers:cors});
 if(req.method!=='POST')return reply({error:'Método inválido'},405);
 try{
 const input=await req.json(),dispatch=req.headers.get('x-dispatch-key');
 if(input.action==='dispatch'||input.action==='dispatch-health'){
  if(!dispatch)return reply({error:'No autorizado'},401);
  const check=await db.rpc('push_authorize',{p_secret:dispatch});if(check.error||check.data!==true)return reply({error:'No autorizado'},401);
  if(input.action==='dispatch-health'){await oauth();return reply({configured:true,firebase_authorized:true});}
  const batch=await db.rpc('push_claim');if(batch.error)throw Error('No se pudo leer la cola');
  if(!batch.data.length)return reply({processed:0});
  const access=await oauth();let sent=0;
  await Promise.all(batch.data.map(async(d:any)=>{
   try{
    const binding=await db.rpc('push_device_current',{p_token:d.token,p_user:d.user_id});
    if(binding.error)throw Error('DEVICE_CHECK');
    if(binding.data!==true){await db.rpc('push_finish',{p_id:d.delivery_id,p_success:false,p_error:'DEVICE_CHANGED',p_invalid:false});return;}
    const {data:p,error}=await db.from('profiles').select('active').eq('id',d.user_id).maybeSingle();
    if(error)throw Error('PROFILE_CHECK');
    if(!p?.active){await db.rpc('push_finish',{p_id:d.delivery_id,p_success:false,p_error:'INACTIVE_USER',p_invalid:true});return;}
    const message:any={token:d.token,notification:{title:d.title,body:d.body},data:{notice_id:d.notice_id,destination:d.destination},android:{priority:'HIGH',notification:{tag:d.notice_id}}};
    if(d.image_url){message.notification.image=d.image_url;message.android.notification.image=d.image_url;}
    const r=await fetch('https://fcm.googleapis.com/v1/projects/villa-maria-golf/messages:send',{method:'POST',headers:{Authorization:'Bearer '+access,'Content-Type':'application/json'},body:JSON.stringify({message})});
    const result=await r.json();
    const invalid=result.error?.details?.some((v:any)=>v.errorCode==='UNREGISTERED')===true;
    await db.rpc('push_finish',{p_id:d.delivery_id,p_success:r.ok,p_error:r.ok?null:String(result.error?.status||'FCM_ERROR'),p_invalid:invalid});
    if(r.ok)sent++;
   }catch{await db.rpc('push_finish',{p_id:d.delivery_id,p_success:false,p_error:'DELIVERY_ERROR',p_invalid:false});}
  }));
  return reply({processed:batch.data.length,sent});
 }
 const jwt=(req.headers.get('authorization')||'').replace(/^Bearer /i,'');
 const {data:{user},error:authError}=await db.auth.getUser(jwt);
 if(authError||!user)return reply({error:'Iniciá sesión'},401);
 const {data:profile,error:profileError}=await db.from('profiles').select('role,active').eq('id',user.id).single();
 if(profileError||!profile.active)return reply({error:'Usuario inactivo'},403);
 if(['register','unregister'].includes(input.action)){
  if(typeof input.token!=='string'||input.token.length<30||input.token.length>4096)return reply({error:'Código inválido'},400);
  const result=await db.rpc(input.action==='register'?'push_register':'push_unregister',{p_user:user.id,p_token:input.token});
  if(result.error)throw Error('No se pudo registrar el dispositivo');
  return reply({ok:true});
 }
 if(profile.role!=='admin')return reply({error:'Acceso de administrador requerido'},403);
 if(input.action==='health'){config();await oauth();return reply({configured:true,firebase_authorized:true});}
 if(input.action==='manual'){
  const title=String(input.title||'').trim(),body=String(input.body||'').trim();
  if(!title||title.length>100||!body||body.length>1000)return reply({error:'Revisá título y mensaje'},400);
  if(!/^[0-9a-f-]{36}$/i.test(input.id||''))return reply({error:'Identificador inválido'},400);
  const base=Deno.env.get('SUPABASE_URL')+'/storage/v1/object/public/club-notice-images/';
  const image=input.image_url||null;
  if(image&&(!image.startsWith(base)||image.length>1000))return reply({error:'Flyer inválido'},400);
  const {data,error}=await db.from('club_notices').insert({id:input.id,title,body,image_url:image,kind:'manual',created_by:user.id}).select('id').single();
  if(error?.code==='23505')return reply({ok:true,id:input.id});
  if(error)throw Error('No se pudo guardar el aviso');
  return reply({ok:true,id:data.id});
 }
 return reply({error:'Acción inválida'},400);
 }catch(error){return reply({error:error instanceof Error?error.message:'Error al procesar el aviso'},500);}
});
