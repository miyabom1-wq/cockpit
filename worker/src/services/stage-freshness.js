import { expectedConfirmedTradingDate } from '../data/calendar.js';

export function stageFreshness(stage,now=new Date()){
  const expected_trade_date=expectedConfirmedTradingDate(stage.market||'jp',now);
  const closeDue=!!stage.trade_date&&stage.trade_date<=expected_trade_date;
  const is_stale=!stage.complete||!stage.trade_date||stage.trade_date<expected_trade_date||
    (closeDue&&(stage.kind!=='confirmed'||Number(stage.close_verification?.ratio||0)<90));
  return{expected_trade_date,is_stale};
}
