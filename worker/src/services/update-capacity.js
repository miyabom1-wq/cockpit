import { budgetStatus } from '../storage/write-budget.js';

// Reserve only the macro publications still due before the UTC budget reset.
// This is a floor for individual jobs, never a stop for the entire scheduler.
export function remainingMacroWrites(now=new Date()){
  const reset=Date.parse(now.toISOString().slice(0,10))+86400000;
  return Math.ceil((reset-now.getTime())/(30*60000))+2;
}
export function updateWriteRequirement(kind,now=new Date()){
  const macro=remainingMacroWrites(now);
  if(kind==='macro')return 1;
  if(kind==='close')return macro+12; // benchmark, part, metadata, publication, signal
  if(kind==='tracked')return macro+24; // preserve one pending close publication cycle
  if(kind==='intraday')return macro+60; // leave room for confirmed close recovery
  return macro+100; // rankings and other optional enrichment
}
export async function updateCapacity(env,kind,now=new Date()){
  if(!env.WRITE_BUDGET)return {allowed:true,kind,required:updateWriteRequirement(kind,now)};
  const status=await budgetStatus(env),remaining=status.limits.background-(status.used.background||0),required=updateWriteRequirement(kind,now);
  return {allowed:remaining>=required,kind,remaining,required,macro_reserve:remainingMacroWrites(now),reset_at:status.reset_at};
}
