export const normalizePlayerSearch = value => String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g,'').replace(/[^\p{L}\p{N}]+/gu,' ').trim().toUpperCase();
function fields(player) {
  const linked = player.player || player.players || {};
  const display = String(player.display_name || player.full_name || linked.full_name || '');
  return { last: normalizePlayerSearch(player.last_name || linked.last_name || (display.includes(',') ? display.split(',')[0] : '')), first:normalizePlayerSearch(player.first_name || linked.first_name || ''), display:normalizePlayerSearch(display), member:String(player.aag_member_number || player.enrollment_number || '').trim() };
}
export function playerSearchRank(player, term) {
  const query=normalizePlayerSearch(term), first=query.split(' ')[0] || '', value=fields(player);
  if (/^\d+$/.test(query.replace(/ /g,'')) && value.member===query.replace(/ /g,'')) return 0;
  if (!first) return 9;
  if (value.last===query || value.last===first) return 1;
  if (value.last.split(' ').includes(first)) return 2;
  if (value.last.startsWith(first) || value.last.split(' ').some(word=>word.startsWith(first))) return 3;
  if (value.last.includes(first)) return 4;
  return 5;
}
export function comparePlayerSearch(term) {
  return (a,b) => playerSearchRank(a,term)-playerSearchRank(b,term)
    || Number(b.is_club_member===true || Number(b.option_club_id)===408)-Number(a.is_club_member===true || Number(a.option_club_id)===408)
    || fields(a).last.localeCompare(fields(b).last,'es') || fields(a).display.localeCompare(fields(b).display,'es');
}
export function rankPlayerSearch(rows,term,limit=15) {
  const words=normalizePlayerSearch(term).split(' ').filter(Boolean);
  return rows.filter(player=>{const f=fields(player),text=`${f.last} ${f.first} ${f.display} ${f.member}`;return words.every(w=>text.includes(w));}).sort(comparePlayerSearch(term)).slice(0,limit);
}
// Fetch surname candidates independently so broad first-name matches cannot fill the limit first.
export async function queryPlayerCandidates(client,table,columns,term,limit=40) {
  const words=normalizePlayerSearch(term).split(' ').filter(Boolean), member=words.join('');
  if (!words.length) return [];
  const numeric=/^\d+$/.test(member),memberColumn=table==='players'?'aag_member_number':'enrollment_number';
  const base=()=>client.from(table).select(columns);
  if(numeric){const result=await base().eq(memberColumn,member).limit(limit);if(result.error)throw result.error;return result.data||[];}
  const filterWords=(query)=>{for(const word of words)query=query.or(`search_text.ilike.%${word}%,last_name.ilike.%${word}%,first_name.ilike.%${word}%,full_name.ilike.%${word}%`);return query;};
  const rawFirst=String(term).trim().split(/[\s,]+/)[0].replace(/[^\p{L}\p{N}'-]/gu,'');
  const exact=filterWords(base().ilike('last_name',rawFirst)).order('last_name').order('first_name').limit(limit);
  const prefix=filterWords(base().or(`last_name.ilike.${rawFirst}%,search_text.ilike.${words[0]}%`)).order('last_name').order('first_name').limit(limit);
  const broad=filterWords(base()).order('last_name').order('first_name').limit(limit);
  const results=await Promise.all([exact,prefix,broad]);
  const unique=new Map();
  for(const result of results){if(result.error)throw result.error;for(const player of result.data||[])unique.set(String(player.id||player.enrollment_number||player.aag_member_number),player);}
  return [...unique.values()];
}
export async function hydratePlayerSearchNames(client,rows) {
  const pending=rows.filter(row=>!(row.player?.last_name || row.last_name) && /^\d+$/.test(String(row.aag_member_number||'')));
  const numbers=[...new Set(pending.map(row=>String(row.aag_member_number)))],names=new Map();
  for(let start=0;start<numbers.length;start+=200){
    const {data,error}=await client.from('aag_enrolleds').select('enrollment_number,first_name,last_name').in('enrollment_number',numbers.slice(start,start+200));
    if(error){console.warn('No se pudieron completar los apellidos para búsqueda',error);continue;}
    for(const player of data||[])names.set(String(player.enrollment_number),player);
  }
  for(const row of pending){const player=names.get(String(row.aag_member_number));if(player)row.player={...row.player,first_name:player.first_name,last_name:player.last_name};}
}
