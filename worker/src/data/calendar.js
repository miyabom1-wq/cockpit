function nthWeekday(year, month, weekday, n) {
  const first = new Date(Date.UTC(year, month - 1, 1)).getUTCDay();
  return 1 + ((weekday - first + 7) % 7) + (n - 1) * 7;
}
function lastWeekday(year, month, weekday) {
  const last = new Date(Date.UTC(year, month, 0));
  return last.getUTCDate() - ((last.getUTCDay() - weekday + 7) % 7);
}
function equinox(year, autumn = false) {
  const base = autumn ? 23.2488 : 20.8431;
  return Math.floor(base + 0.242194 * (year - 1980) - Math.floor((year - 1980) / 4));
}
function jpBaseHoliday(d) {
  const y = d.getUTCFullYear(), m = d.getUTCMonth() + 1, day = d.getUTCDate();
  const fixed = new Set(['1-1','2-11','2-23','4-29','5-3','5-4','5-5','8-11','11-3','11-23']);
  if (fixed.has(`${m}-${day}`)) return true;
  if (m === 1 && day === nthWeekday(y, 1, 1, 2)) return true;
  if (m === 7 && day === nthWeekday(y, 7, 1, 3)) return true;
  if (m === 9 && day === nthWeekday(y, 9, 1, 3)) return true;
  if (m === 10 && day === nthWeekday(y, 10, 1, 2)) return true;
  if (m === 3 && day === equinox(y, false)) return true;
  if (m === 9 && day === equinox(y, true)) return true;
  return false;
}
function isJpSubstituteHoliday(d) {
  // 1973年以降: 日曜の祝日の直後にある最初の非祝日を振替休日とする。
  // 連休（例: 5/3〜5/5）の後ろへ繰り越される火曜・水曜も扱う。
  for (let back=1; back<=7; back++) {
    const prev = new Date(d.getTime()-back*86400000);
    if (prev.getUTCDay()===0 && jpBaseHoliday(prev)) {
      let candidate = new Date(prev.getTime()+86400000);
      while (jpBaseHoliday(candidate)) candidate = new Date(candidate.getTime()+86400000);
      return candidate.toISOString().slice(0,10)===d.toISOString().slice(0,10);
    }
  }
  return false;
}
export function isJpHoliday(date) {
  const d = new Date(date);
  const dow = d.getUTCDay(), m = d.getUTCMonth() + 1, day = d.getUTCDate();
  if (dow === 0 || dow === 6 || (m === 12 && day === 31) || (m === 1 && day <= 3)) return true;
  if (jpBaseHoliday(d) || isJpSubstituteHoliday(d)) return true;
  const prev = new Date(d.getTime() - 86400000), next = new Date(d.getTime() + 86400000);
  if (jpBaseHoliday(prev) && jpBaseHoliday(next)) return true;
  return false;
}
function easterSunday(year) {
  const a=year%19,b=Math.floor(year/100),c=year%100,d=Math.floor(b/4),e=b%4,f=Math.floor((b+8)/25);
  const g=Math.floor((b-f+1)/3),h=(19*a+b-d-g+15)%30,i=Math.floor(c/4),k=c%4;
  const l=(32+2*e+2*i-h-k)%7,m=Math.floor((a+11*h+22*l)/451);
  const month=Math.floor((h+l-7*m+114)/31),day=((h+l-7*m+114)%31)+1;
  return new Date(Date.UTC(year, month - 1, day));
}
function usBaseHoliday(d) {
  const y=d.getUTCFullYear(),m=d.getUTCMonth()+1,day=d.getUTCDate();
  const fixed = new Set(['1-1','6-19','7-4','12-25']);
  if (fixed.has(`${m}-${day}`)) return true;
  if (m===1&&day===nthWeekday(y,1,1,3)) return true;
  if (m===2&&day===nthWeekday(y,2,1,3)) return true;
  if (m===5&&day===lastWeekday(y,5,1)) return true;
  if (m===9&&day===nthWeekday(y,9,1,1)) return true;
  if (m===11&&day===nthWeekday(y,11,4,4)) return true;
  const gf = new Date(easterSunday(y).getTime()-2*86400000);
  return gf.getUTCMonth()===d.getUTCMonth()&&gf.getUTCDate()===day;
}
export function isUsHoliday(date) {
  const d = new Date(date), dow = d.getUTCDay();
  if (dow === 0 || dow === 6) return true;
  if (usBaseHoliday(d)) return true;
  if (dow===1) { const p=new Date(d.getTime()-86400000); if(usBaseHoliday(p)) return true; }
  if (dow===5) { const n=new Date(d.getTime()+86400000); if(usBaseHoliday(n)) return true; }
  return false;
}
export function isTradingDay(market, date) {
  return market === 'us' ? !isUsHoliday(date) : !isJpHoliday(date);
}
export function previousTradingDate(market, value = new Date()) {
  let d = new Date(value);
  d = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  for (let i=0;i<15;i++) {
    if (isTradingDay(market,d)) return d.toISOString().slice(0,10);
    d = new Date(d.getTime()-86400000);
  }
  return d.toISOString().slice(0,10);
}
export function expectedTradingDate(market, now = new Date()) {
  const jst = new Date(now.getTime()+9*3600000);
  const jstDate = new Date(Date.UTC(jst.getUTCFullYear(),jst.getUTCMonth(),jst.getUTCDate()));
  if (market === 'jp') return previousTradingDate('jp', jstDate);
  const minute = jst.getUTCHours()*60+jst.getUTCMinutes();
  const openMinute = isUsDst(now) ? 22*60+30 : 23*60+30;
  // 米国の取引日はJST夜の寄りから同日扱い。それまでは直前の米国営業日を期待する。
  const basis = minute >= openMinute ? jstDate : new Date(jstDate.getTime()-86400000);
  return previousTradingDate('us', basis);
}
export function isUsDst(date = new Date()) {
  const y=date.getUTCFullYear(),mar=new Date(Date.UTC(y,2,1)),nov=new Date(Date.UTC(y,10,1));
  const start=Date.UTC(y,2,1+((7-mar.getUTCDay())%7)+7),end=Date.UTC(y,10,1+((7-nov.getUTCDay())%7));
  const cur=Date.UTC(y,date.getUTCMonth(),date.getUTCDate());
  return cur>=start&&cur<end;
}
