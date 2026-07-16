import { finite } from '../utils.js';
export function validateRow(row,{expectedDate=null,closeConfirmed=false,requireCloseConfirmed=false,snapshotId=null,source='Yahoo Finance'}={}) {
  const reasons=[];
  if(!row)reasons.push('日足なし');
  else{
    if(expectedDate&&row.date!==expectedDate)reasons.push(`最終バー日不一致 ${row.date||'—'} / 期待 ${expectedDate}`);
    if(![row.open,row.high,row.low,row.close].every(finite))reasons.push('OHLC欠損');
    else{
      const o=Number(row.open),h=Number(row.high),l=Number(row.low),c=Number(row.close);
      if(!(h>=Math.max(o,c)&&l<=Math.min(o,c)&&h>=l&&l>0))reasons.push('OHLC整合性エラー');
      if(h/l>5)reasons.push('日中値幅異常');
    }
    if(!finite(row.volume)||Number(row.volume)<0)reasons.push('出来高異常');
  }
  if(requireCloseConfirmed&&!closeConfirmed)reasons.push('終値未確定');
  const stale=!!expectedDate&&row?.date!==expectedDate;
  const data_valid=reasons.length===0;
  return{
    data_valid,stale,reasons,bar_date:row?.date||null,expected_trade_date:expectedDate,
    close_confirmed:!!closeConfirmed,required_close_confirmed:!!requireCloseConfirmed,source,snapshot_id:snapshotId
  };
}
