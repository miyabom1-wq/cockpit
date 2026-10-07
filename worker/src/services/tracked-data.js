import { ENGINE_VERSION } from '../config.js';
import { expectedConfirmedTradingDate } from '../data/calendar.js';
import { parseJson } from '../utils.js';
export const TRACKED_KEY='tracked:analysis:v1';
export async function getTrackedData(env){return parseJson(await env.COCKPIT_KV.get(TRACKED_KEY),{});}
export function latestAnalysis(...rows){
  return rows.filter(Boolean).sort((a,b)=>{
    const date=String(b.date||'').localeCompare(String(a.date||''));
    if(date)return date;
    const valid=x=>x.engine_version===ENGINE_VERSION&&!!x.momentumState;
    if(valid(a)!==valid(b))return valid(b)?1:-1;
    return (Date.parse(b.price_time||b.updated_at)||0)-(Date.parse(a.price_time||a.updated_at)||0);
  })[0]||{};
}
export function assessedRow(row,market){
  const expected=expectedConfirmedTradingDate(market);
  const stale=!row.date||row.date<expected;
  const mismatch=row.engine_version!==ENGINE_VERSION||!row.momentumState;
  const failed=row.data_quality?.data_valid===false||!Number.isFinite(row.price);
  return {...row,expected_trade_date:expected,data_status:stale?'STALE':failed?'FAILED':mismatch?'SCHEMA_MISMATCH':'CURRENT',assessment_usable:!stale&&!failed&&!mismatch};
}
