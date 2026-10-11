import { createClient } from 'npm:@supabase/supabase-js@2.117.2';
const headers={'Access-Control-Allow-Origin':'*','Access-Control-Allow-Headers':'authorization,apikey,content-type,x-client-info,x-supabase-api-version','Access-Control-Allow-Methods':'POST,OPTIONS'};
const respond=(data:unknown,status=200)=>Response.json(data,{status,headers});
const url=Deno.env.get('SUPABASE_URL')!;
const admin=createClient(url,Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,{auth:{persistSession:false,autoRefreshToken:false}});
Deno.serve(async req=>{
 if(req.method==='OPTIONS')return new Response('ok',{headers});
 if(req.method!=='POST')return respond({error:'Método inválido'},405);
 try{
 const jwt=(req.headers.get('authorization')||'').replace(/^Bearer /i,'');
 const {data:{user},error}=await admin.auth.getUser(jwt);
 if(error||!user?.email)return respond({error:'Iniciá sesión nuevamente.'},401);
 const input=await req.json();
 if(input.confirm!==true||typeof input.password!=='string'||!input.password)return respond({error:'Ingresá tu contraseña para confirmar.'},400);
 const verifier=createClient(url,Deno.env.get('SUPABASE_ANON_KEY')!,{auth:{persistSession:false,autoRefreshToken:false}});
 const checked=await verifier.auth.signInWithPassword({email:user.email,password:input.password});
 if(checked.error||checked.data.user?.id!==user.id)return respond({error:'La contraseña no es correcta.'},403);
 const profile=await admin.from('profiles').select('role').eq('id',user.id).single();
 if(profile.error)return respond({error:'No se pudo verificar la cuenta.'},500);
 if(profile.data.role==='admin'){
 const others=await admin.from('profiles').select('id',{count:'exact',head:true}).eq('role','admin').eq('active',true).neq('id',user.id);
 if(others.error||!others.count)return respond({error:'Primero asigná otro administrador al sistema del club.'},409);
 }
 const signedOut=await admin.auth.admin.signOut(jwt,'global');
 if(signedOut.error)return respond({error:'No se pudo cerrar la sesión. Intentá nuevamente.'},500);
 const deleted=await admin.auth.admin.deleteUser(user.id,false);
 if(deleted.error)return respond({error:'No se pudo eliminar la cuenta. Intentá nuevamente o contactá al club.'},500);
 return respond({ok:true});
 }catch{return respond({error:'No se pudo procesar la solicitud.'},500);}
});
