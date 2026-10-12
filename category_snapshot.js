// Tournament rules are historical snapshots; never join live AAG data here.
export function categoryFromRules(row) {
  const rules=Array.isArray(row?.tee_rules)?row.tee_rules:[];
  const classification=rules[0]?.classification;
  const values=key=>rules.map(rule=>rule[key]).filter(value=>value!==null&&value!==undefined&&value!==''&&Number.isFinite(Number(value))).map(Number);
  const min=values('index_min'),max=values('index_max');
  const genders=[...new Set(rules.map(rule=>rule.gender??(rule.reference?.category===1?'female':rule.reference?.category===0?'male':null)).filter(Boolean))];
  return {...row,gender:classification?classification.gender:(genders.length===1?genders[0]:null),index_min:classification?classification.index_min:(min.length?Math.min(...min):null),index_max:classification?classification.index_max:(max.length?Math.max(...max):null)};
}
