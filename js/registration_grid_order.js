function timeValue(value) {
  const match = String(value || "").match(/^(\d{1,2}):(\d{2})(?::(\d{2}))?/);
  if (!match) return Infinity;
  const [,hours,minutes,seconds="0"] = match;
  if (+hours > 23 || +minutes > 59 || +seconds > 59) return Infinity;
  return +hours * 3600 + +minutes * 60 + +seconds;
}

export function orderedGridBlocks(tournament, blocks, lines = []) {
  const earliest = block => {
    const start = timeValue(block.start_time);
    if (Number.isFinite(start)) return start;
    return Math.min(...lines.filter(line => line.starting_block_id === block.id).map(line => timeValue(line.line_time)));
  };
  return [...blocks].sort((a,b) => {
    if (tournament?.start_type === "simultanea") {
      const difference = earliest(a) - earliest(b);
      if (difference && !Number.isNaN(difference)) return difference;
    }
    return Number(a.display_order || 0) - Number(b.display_order || 0);
  });
}
// Shared by the screen and the exported image. A gap of exactly 10 minutes stays in the same shift.
export function sequentialLineGroups(lines = []) {
  const ordered=[...lines].sort((a,b)=>Number(a.display_order||0)-Number(b.display_order||0));
  const groups=[];
  for(let i=0;i<ordered.length;i++) {
    const before=i?timeValue(ordered[i-1].line_time):Infinity, after=timeValue(ordered[i].line_time);
    if(!groups.length || (Number.isFinite(before)&&Number.isFinite(after)&&after-before>600))groups.push({lines:[]});
    groups.at(-1).lines.push(ordered[i]);
  }
  return groups.map((group,index)=>({...group,label:groups.length===1?'':groups.length===2?(index===0?'Mañana':'Tarde'):String(index+1)}));
}
