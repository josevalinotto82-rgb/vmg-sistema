import { supabase } from './supabase.js';
import { getAuthContext } from './auth.js';

export const TEE_FIELD_ID = 1466;
export const TEE_NAMES = ['Negro','Amarillo','Blanco','Rojo'];
const fields = 'aag_field_id,rules,revision,updated_at';
export const normalizeTee = value => String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g,'').trim().toLowerCase().replace(/negras?|negros?/g,'negro').replace(/amarillas?|amarillos?/g,'amarillo').replace(/blancas?|blancos?/g,'blanco').replace(/rojas?|rojos?/g,'rojo').match(/\b(negro|amarillo|blanco|rojo)\b/)?.[1] || '';

export function validateTeeRules(rules) {
  const result = {};
  for (const gender of ['male','female']) {
    const rows = rules?.[gender], label = gender === 'male' ? 'Caballeros' : 'Damas';
    if (!Array.isArray(rows) || rows.length < 1 || rows.length > 4) throw new Error(`${label}: debe haber entre uno y cuatro rangos.`);
    const used = new Set();let previous = -10;
    result[gender] = rows.map((row,index) => {
      if (!TEE_NAMES.includes(row.tee) || used.has(row.tee)) throw new Error(`${label}: elegí tees válidos sin repetirlos.`);
      const max = row.max_index;
      if (typeof max !== 'number' || !Number.isFinite(max) || max < -10 || max > 54 || (index > 0 && max <= previous)) throw new Error(`${label}: los límites deben estar ordenados, entre -10 y 54.`);
      used.add(row.tee);previous = max;return {tee:row.tee,max_index:max};
    });
    if (previous !== 54) throw new Error(`${label}: el último rango debe terminar en 54.`);
  }
  return result;
}
export async function loadTeeRecommendations() {
  const {data,error} = await supabase.from('tee_recommendation_settings').select(fields).eq('aag_field_id',TEE_FIELD_ID).maybeSingle();
  if (error) throw error;
  if (!data) throw new Error('No se encontró la configuración de tees de Villa María Golf.');
  return {...data,rules:validateTeeRules(data.rules)};
}
export function recommendedTeeName(settings,index,gender) {
  if(index == null || index === '') return null;
  const number=Number(index);
  if(!Number.isFinite(number) || number < -10 || number > 54) return null;
  const rules=settings?.rules?.[gender];
  return Array.isArray(rules) ? rules.find(rule=>number<=rule.max_index)?.tee || null : null;
}
export function isRecommendedTee(settings,index,gender,tee) {
  if(Number(tee?.aag_field_id)!==TEE_FIELD_ID)return false;
  const name=recommendedTeeName(settings,index,gender);
  return !!name && normalizeTee(name)===normalizeTee(tee.tee_name);
}
export async function saveTeeRecommendations(snapshot,rules) {
  const context=await getAuthContext({force:true});
  if(!context.session || !context.profile?.active || context.profile.role!=='admin')throw new Error('Solo un administrador activo puede modificar los tees recomendados.');
  if(Number(snapshot?.aag_field_id)!==TEE_FIELD_ID || !/^\d+$/.test(String(snapshot?.revision)))throw new Error('Recargá la configuración antes de guardar.');
  const payload=validateTeeRules(rules);
  const {data,error}=await supabase.from('tee_recommendation_settings').update({rules:payload}).eq('aag_field_id',TEE_FIELD_ID).eq('revision',snapshot.revision).select(fields).maybeSingle();
  if(error)throw error;
  if(!data)return {conflict:true,settings:await loadTeeRecommendations()};
  const settings={...data,rules:validateTeeRules(data.rules)};
  document.dispatchEvent(new CustomEvent('vmgc:tee-recommendations-updated',{detail:settings}));
  return {conflict:false,settings};
}
