(function (global) {
  'use strict';
  const retired = {
    tournament_categories: new Set(['gender','index_min','index_max','tee_id','slope','course_rating','par']),
    scorecards: new Set(['tee_id','net_1','net_2'])
  };
  function splitFields(text) {
    let depth=0,start=0,fields=[];
    for(let i=0;i<text.length;i++){
      if(text[i]==='(')depth++;
      if(text[i]===')')depth--;
      if(text[i]===','&&depth===0){fields.push(text.slice(start,i).trim());start=i+1;}
    }
    fields.push(text.slice(start).trim());return fields.filter(Boolean);
  }
  function selectSnapshotFields(table, text='*') {
    let needsRules=false;
    const fields=splitFields(text).flatMap(field=>{
      const open=field.indexOf('(');
      if(open>=0){
        const relation=field.slice(0,open),name=relation.split(':').at(-1).split('!')[0];
        return [relation+'('+selectSnapshotFields(name,field.slice(open+1,-1))+')'];
      }
      const name=field.split(':').at(-1);
      if(retired[table]?.has(name)){needsRules=true;return [];}
      return [field];
    });
    if(table==='tournament_categories'&&needsRules&&!fields.includes('*')&&!fields.includes('tee_rules'))fields.push('tee_rules');
    // Always return a valid projection even when the old request named only retired columns.
    if(!fields.length)fields.push(table==='tournament_categories'?'tee_rules':'id');
    return fields.join(',');
  }
  function normalizeData(value) {
    if(Array.isArray(value)){value.forEach(normalizeData);return value;}
    if(!value||typeof value!=='object')return value;
    Object.values(value).forEach(normalizeData);
    if(Array.isArray(value.tee_rules)){
      const first=value.tee_rules[0],classification=first?.classification;
      if(classification){
        for(const key of ['gender','index_min','index_max','slope','course_rating','par'])value[key]=classification[key]??null;
        value.tee_id=first.legacy_tee_id??null;
      }
    }
    return value;
  }
  function snapshotPayload(table,payload) {
    if(Array.isArray(payload))return payload.map(row=>snapshotPayload(table,row));
    if(!payload||!retired[table])return payload;
    const row={...payload};
    const present=Object.keys(row).filter(key=>retired[table].has(key));
    if(table==='tournament_categories'&&present.length){
      if(!Array.isArray(row.tee_rules)||!row.tee_rules.length)throw new Error('La categoría debe guardar sus reglas V2 completas antes de modificar datos de clasificación.');
      row.tee_rules=row.tee_rules.map(rule=>({...rule}));
      const first=row.tee_rules[0];
      first.classification={...(first.classification||{})};
      for(const key of present){if(key==='tee_id')first.legacy_tee_id=row[key];else first.classification[key]=row[key];}
    }
    for(const key of present)delete row[key];
    return row;
  }
  function wrapBuilder(builder,table) {
    return new Proxy(builder,{get(target,key){
      if(key==='then')return (resolve,reject)=>target.then(result=>{
        if(result&&!result.error)normalizeData(result.data);
        return resolve?resolve(result):result;
      },reject);
      const member=Reflect.get(target,key,target);
      if(typeof member!=='function')return member;
      return (...args)=>{
        if(key==='select')args[0]=selectSnapshotFields(table,args[0]||'*');
        if(['insert','update','upsert'].includes(key))args[0]=snapshotPayload(table,args[0]);
        const result=member.apply(target,args);
        return result&&typeof result==='object'&&typeof result.then==='function'?wrapBuilder(result,table):result;
      };
    }});
  }
  function wrapClient(client) {
    if(client.__vmgcSnapshots)return client;
    const from=client.from.bind(client);
    client.from=table=>wrapBuilder(from(table),table);
    Object.defineProperty(client,'__vmgcSnapshots',{value:true});
    return client;
  }
  global.VMGCSnapshot={wrapClient,selectSnapshotFields,normalizeData,snapshotPayload,
    createClient:(...args)=>wrapClient(global.supabase.createClient(...args))};
})(globalThis);
