import { smaSeries, emaSeries } from '../indicators/moving-averages.js';
import { rsiWilder, atrWilder } from '../indicators/wilder.js';
import { candleMetrics } from '../indicators/candles.js';
import { dailyRegimeAt } from './regime.js';
import { volumeAt, intradayAdjustedRatio } from './volume.js';
import { rsAt } from './relative-strength.js';
import { detectSetup } from './setup.js';
import { classifyCandidate } from './candidate-board.js';
import { validateRow } from './data-quality.js';
import { finite, pct, round } from '../utils.js';
import { ENGINE_VERSION, themeOf } from '../config.js';

export function prepareSeries(rows){
  const clean=(rows||[]).filter(r=>r&&finite(r.close)).sort((a,b)=>String(a.date).localeCompare(String(b.date)));
  const close=clean.map(r=>Number(r.close));
  return{rows:clean,close,sma5:smaSeries(close,5),sma25:smaSeries(close,25),sma50:smaSeries(close,50),sma200:smaSeries(close,200),ema65:emaSeries(close,65),rsi14:rsiWilder(close,14),atr14:atrWilder(clean,14)};
}
export function analyzePreparedAt(prepared,index,{symbol,name,market,benchmarkMap,secondaryBenchmarkMap=null,expectedDate=null,closeConfirmed=true,requireCloseConfirmed=false,snapshotId=null,source='Yahoo Finance',context={},volumeCurveFraction=null,volumeCurveLabel=null}={}){
  const row=prepared.rows[index];if(!row)return null;
  const prev=prepared.rows[index-1],candle=candleMetrics(row),volume=volumeAt(prepared.rows,index,20),regime=dailyRegimeAt(prepared,index),rs=rsAt(prepared,index,benchmarkMap),secondaryRs=secondaryBenchmarkMap?rsAt(prepared,index,secondaryBenchmarkMap):{};
  const change_pct=prev?pct(row.close,prev.close):null,div25=finite(prepared.sma25[index])?pct(row.close,prepared.sma25[index]):null;
  const div50=finite(prepared.sma50[index])?pct(row.close,prepared.sma50[index]):null,div200=finite(prepared.sma200[index])?pct(row.close,prepared.sma200[index]):null;
  const data_quality=validateRow(row,{expectedDate,closeConfirmed,requireCloseConfirmed,snapshotId,source});
  const base={
    symbol,name:name||symbol,market,theme:themeOf(symbol),date:row.date,price:round(row.close,4),open:round(row.open,4),high:round(row.high,4),low:round(row.low,4),volume:round(row.volume,0),
    change_pct:round(change_pct),sma5:round(prepared.sma5[index],4),sma25:round(prepared.sma25[index],4),sma50:round(prepared.sma50[index],4),sma200:round(prepared.sma200[index],4),ema65:round(prepared.ema65[index],4),
    div25:round(div25),div50:round(div50),div200:round(div200),rsi14:round(prepared.rsi14[index],2),rsi:round(prepared.rsi14[index],2),atr14:round(prepared.atr14[index],4),
    close_pos:round(candle?.close_pos,3),upper_ratio:round(candle?.upper_ratio,3),lower_ratio:round(candle?.lower_ratio,3),body_ratio:round(candle?.body_ratio,3),
    vol_ratio:volume.vol_ratio,effective_vol_ratio:closeConfirmed?volume.vol_ratio:intradayAdjustedRatio(volume.vol_ratio,null,volumeCurveFraction),avg_volume20:round(volume.avg_volume20,0),
    volume_curve_fraction:closeConfirmed?1:round(volumeCurveFraction,4),volume_estimation:closeConfirmed?'確定出来高':(volumeCurveLabel||'市場共通U字カーブによる暫定推計'),
    ret5:rs.ret5,ret20:rs.ret20,rs5:rs.rs5,rs20:rs.rs20,benchmark_ret5:rs.benchmark_ret5,benchmark_ret20:rs.benchmark_ret20,secondary_rs5:secondaryRs.rs5??null,secondary_rs20:secondaryRs.rs20??null,secondary_benchmark_ret5:secondaryRs.benchmark_ret5??null,secondary_benchmark_ret20:secondaryRs.benchmark_ret20??null,
    regime,long_stage:`${regime.code} ${regime.label}`,stage:`${regime.code} ${regime.label}`,stage_code:regime.code,data_quality,
    source,engine_version:ENGINE_VERSION,snapshot_id:snapshotId,close_confirmed:!!closeConfirmed
  };
  base.setup=detectSetup(prepared,index,{...volume,candle});base.setup_code=base.setup?.code||null;base.setup_label=base.setup?.label||null;
  const classification=classifyCandidate(base,{...context});
  base.entry_lane=classification.lane;base.entry_label=classification.label;base.entry_quality=classification.quality;base.entry_reason=classification.reasons;base.risk_reason=classification.risks;
  base.audit={
    data:{trade_date:row.date,close_confirmed:!!closeConfirmed,source,snapshot_id:snapshotId,engine:ENGINE_VERSION,quality:data_quality},
    price:{open:base.open,high:base.high,low:base.low,close:base.price,volume:base.volume,avg_volume20:base.avg_volume20,vol_ratio:base.vol_ratio,effective_vol_ratio:base.effective_vol_ratio,volume_curve_fraction:base.volume_curve_fraction,volume_estimation:base.volume_estimation},
    technical:{sma25:base.sma25,sma50:base.sma50,sma200:base.sma200,ema65:base.ema65,div25:base.div25,rsi14_wilder:base.rsi14,atr14_wilder:base.atr14,rs5:base.rs5,rs20:base.rs20,secondary_rs5:base.secondary_rs5,secondary_rs20:base.secondary_rs20,close_pos:base.close_pos,upper_ratio:base.upper_ratio},
    candidate:{lane:base.entry_lane,label:base.entry_label,quality:base.entry_quality,conditions:classification.conditions,reasons:classification.reasons,risks:classification.risks}
  };
  return base;
}
export function analyzeSeriesLatest(rows,options={}){const p=prepareSeries(rows);return analyzePreparedAt(p,p.rows.length-1,options);}
