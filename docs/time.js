(function(root){
  const parts=(instant,zone)=>Object.fromEntries(new Intl.DateTimeFormat('en-CA',{timeZone:zone,year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',second:'2-digit',hourCycle:'h23'}).formatToParts(new Date(instant)).filter(p=>p.type!=='literal').map(p=>[p.type,p.value]));
  function localDate(instant,zone){const p=parts(instant,zone);return `${p.year}-${p.month}-${p.day}`;}
  function localInput(instant,zone){const p=parts(instant,zone);return `${p.year}-${p.month}-${p.day}T${p.hour}:${p.minute}`;}
  function localInstant(date,time,zone){
    const [y,m,d]=date.split('-').map(Number),[h,min]=time.split(':').map(Number);
    const wall=Date.UTC(y,m-1,d,h,min);let candidate=wall;
    for(let i=0;i<4;i++){const p=parts(candidate,zone);const rendered=Date.UTC(+p.year,+p.month-1,+p.day,+p.hour,+p.minute);const delta=wall-rendered;candidate+=delta;if(!delta)break;}
    const expected=`${date}T${time}`;
    if(localInput(candidate,zone)!==expected)throw new Error('该当地时间处于夏令时跳时区间，请选择其他时间。');
    for(const offset of [-7200000,-3600000,-1800000,1800000,3600000,7200000])if(localInput(candidate+offset,zone)===expected)throw new Error('该当地时间因夏令时回拨出现两次，请选择回拨时段以外的时间。');
    return candidate;
  }
  function addDay(date){return new Date(Date.parse(date+'T12:00:00Z')+86400000).toISOString().slice(0,10);}
  function bounds(event,date){
    if(!event.start)return {start:null,end:null};
    const start=localInstant(date,event.start,event.zone);let end=null;
    if(event.end){end=localInstant(event.endDate||date,event.end,event.endZone||event.zone);if(end<start&&!event.endDate)end=localInstant(addDay(date),event.end,event.endZone||event.zone);}
    return {start,end};
  }
  function schedule(events,date,now){
    const timed=events.map(event=>({event,...bounds(event,date)})).filter(x=>x.start!==null).sort((a,b)=>a.start-b.start);
    const active=timed.filter(x=>x.end!==null&&x.start<=now&&now<x.end);
    const recent=timed.filter(x=>x.start<=now).at(-1);
    // A point is a recent scheduled milestone, never an invented activity duration.
    if(recent&&recent.end===null&&!active.includes(recent))active.push(recent);
    return {active,recent,next:timed.find(x=>x.start>now),timed};
  }
  function dayIndex(days,now){
    const first=localInstant(days[0].date,'00:00',days[0].zone);
    if(now<first)return {index:0,phase:'before'};
    const last=days.at(-1);if(now>=localInstant(addDay(last.date),'00:00',last.zone))return {index:days.length-1,phase:'after'};
    for(let i=days.length-1;i>=0;i--)if(now>=localInstant(days[i].date,'00:00',days[i].zone))return {index:i,phase:'during'};
    return {index:0,phase:'before'};
  }
  root.TripTime={parts,localDate,localInput,localInstant,bounds,schedule,dayIndex,addDay};
})(typeof window==='undefined'?globalThis:window);
