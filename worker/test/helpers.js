export class MockKV{
  constructor(seed={}){this.map=new Map(Object.entries(seed));this.writes=0;this.deletes=0;}
  async get(k){return this.map.has(k)?this.map.get(k):null;}
  async put(k,v){this.map.set(k,String(v));this.writes++;}
  async delete(k){this.map.delete(k);this.deletes++;}
  async list(){return{keys:[...this.map.keys()].map(name=>({name}))};}
}
export function syntheticRows(count=300,end='2026-07-16'){
  const out=[],endDate=new Date(end+'T00:00:00Z');let days=[];for(let d=new Date(endDate);days.length<count;d=new Date(d.getTime()-86400000)){if(d.getUTCDay()!==0&&d.getUTCDay()!==6)days.push(new Date(d));}days.reverse();
  for(let i=0;i<days.length;i++){const base=100+i*.25+Math.sin(i/8)*2,open=base-.4,close=base+.4,high=base+1.2,low=base-1.1;out.push({date:days[i].toISOString().slice(0,10),time:Math.floor(days[i].getTime()/1000),open,high,low,close,volume:1000000+i*1000,adj_close:close});}
  return out;
}
export function yahooResult(rows,symbol='TEST'){
  return{meta:{symbol,currency:'JPY',exchangeName:'JPX',marketState:'CLOSED',regularMarketPrice:rows.at(-1).close,regularMarketTime:rows.at(-1).time},timestamp:rows.map(x=>x.time),indicators:{quote:[{open:rows.map(x=>x.open),high:rows.map(x=>x.high),low:rows.map(x=>x.low),close:rows.map(x=>x.close),volume:rows.map(x=>x.volume)}],adjclose:[{adjclose:rows.map(x=>x.adj_close??x.close)}]},events:{}};
}
