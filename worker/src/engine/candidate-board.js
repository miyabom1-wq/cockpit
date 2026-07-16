import { finite, round } from '../utils.js';
function cond(id,label,actual,operator,threshold,pass){return{id,label,actual:finite(actual)?round(actual,2):actual,operator,threshold,pass:!!pass};}
export function classifyCandidate(analysis,context={}){
  const a=analysis,quality=a.data_quality||{};
  if(!quality.data_valid)return{lane:'D',label:'データ異常',quality:'invalid',conditions:[{id:'data_valid',label:'データ有効',actual:quality.reasons?.join(' / ')||'無効',operator:'=',threshold:true,pass:false}],reasons:['データが最新・整合済みでないため候補判定を停止'],risks:quality.reasons||[]};
  const st=a.regime?.code,chg=a.change_pct,vr=a.effective_vol_ratio??a.vol_ratio,cp=a.close_pos,rsi=a.rsi14,upper=a.upper_ratio,rs5=a.rs5,div25=a.div25,ret20=a.ret20;
  const common=[
    cond('regime_s2','日足上昇レジーム',st,'=', 'S2',st==='S2'),
    cond('change_positive','前日比',chg,'>',0,finite(chg)&&chg>0),
    cond('volume_confirmed','出来高倍率',vr,'>=',1,finite(vr)&&vr>=1),
    cond('close_position','終値位置',cp,'>=',.60,finite(cp)&&cp>=.60),
    cond('rsi_limit','RSI14 Wilder',rsi,'<',78,finite(rsi)&&rsi<78),
    cond('upper_wick','上ヒゲ比率',upper,'<',.40,finite(upper)&&upper<.40),
    cond('rs_floor','5日市場RS',rs5,'>',-3,!finite(rs5)||rs5>-3)
  ];
  const overheat=(finite(rsi)&&rsi>=78)||(finite(div25)&&div25>=12)||(finite(chg)&&chg>=8);
  const wick=finite(upper)&&upper>=.4;
  let lane='D',label='監視継続',qualityLevel='normal',reasons=[],risks=[];
  if(finite(chg)&&chg<=-7||wick&&finite(chg)&&chg<=0||overheat){lane='E';label='警戒';risks.push(overheat?'過熱':'急落・上ヒゲ');}
  else if(a.setup&&finite(chg)&&chg>-1.5&&finite(cp)&&cp>=.58&&!wick&&!overheat){lane='B';qualityLevel=finite(vr)&&vr>=1.2?'B+':finite(vr)&&vr>=.8?'B':'B?';label=qualityLevel==='B+'?'反転初動・出来高確認':'反転初動';reasons.push(a.setup.label);}
  else if(st==='S2'&&common.every(x=>x.pass)){lane='A';label='強い継続候補';qualityLevel=(context.turnover_rank<=30&&context.rs_percentile>=80&&vr>=1.2)?'A+':'A';reasons.push(qualityLevel==='A+'?'主役確認条件まで通過':'上昇レジーム内の継続');}
  else if(st==='S2'&&finite(div25)&&div25>=-3.5&&div25<=3.5&&finite(chg)&&chg>-3.5&&!overheat&&!wick&&(!finite(ret20)||ret20>-2)){lane='C';label='押し目監視';reasons.push('25日線近辺の健全な調整');}
  else reasons.push('A/B/C条件の一部が未達');
  if(finite(rsi)&&rsi>=72)risks.push('RSI高め');if(finite(div25)&&div25>=8)risks.push('25日線から拡張');if(finite(rs5)&&rs5<0)risks.push('市場RS弱め');
  return{lane,label,quality:qualityLevel,conditions:common,reasons,risks};
}
