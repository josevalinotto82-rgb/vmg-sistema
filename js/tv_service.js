import { supabase } from "./supabase.js";

export const TV_SETTINGS_ID="main",TV_BUCKET="tv-media";
export async function listTvTournaments(){
  const{data,error}=await supabase.from("tournaments").select("id,name,tournament_date,status,series_id,data_schema_version").eq("data_schema_version",2).order("tournament_date",{ascending:false}).limit(60);if(error)throw error;return data||[];
}
export async function loadTvSettings(){
  const{data,error}=await supabase.from("tv_settings").select("*").eq("id",TV_SETTINGS_ID).single();if(error)throw error;return data;
}
export async function saveTvSettings(payload){
  const{data,error}=await supabase.from("tv_settings").update({...payload,updated_at:new Date().toISOString()}).eq("id",TV_SETTINGS_ID).select("*").single();if(error)throw error;return data;
}
export function publicTvMediaUrl(path){return `${supabase.storage.from(TV_BUCKET).getPublicUrl(path).data.publicUrl}?v=${Date.now()}`}
export async function listTvFolder(folder){
  const{data,error}=await supabase.storage.from(TV_BUCKET).list(folder,{limit:100,sortBy:{column:"name",order:"asc"}});if(error)throw error;return(data||[]).filter(file=>file.name&&!file.name.startsWith("."));
}
export async function removeTvFolder(folder){
  const files=await listTvFolder(folder),paths=files.map(file=>`${folder}/${file.name}`);if(!paths.length)return 0;const{error}=await supabase.storage.from(TV_BUCKET).remove(paths);if(error)throw error;return paths.length;
}
export async function removeTvFile(path){const{error}=await supabase.storage.from(TV_BUCKET).remove([path]);if(error)throw error}
export async function uploadTvFile(path,file,{contentType,cacheControl="60"}={}){const{error}=await supabase.storage.from(TV_BUCKET).upload(path,file,{contentType:contentType||file.type,cacheControl,upsert:true});if(error)throw error}
