(()=>{
'use strict';
const avg=(rows,key)=>{const xs=(rows||[]).map(x=>Number(x?.[key])).filter(Number.isFinite);return xs.length?xs.reduce((a,b)=>a+b,0)/xs.length:null};
const regionConfidence=n=>{const x=Number(n)||0;if(x>=5)return 1;if(x===4)return .9;if(x===3)return .8;if(x===2)return .55;if(x===1)return .3;return 0};
const shrink=(value,confidence,neutral)=>Number.isFinite(Number(value))?neutral+confidence*(Number(value)-neutral):neutral;
const balancedMetric=(jp,us,key,neutral=0)=>{if(jp&&us)return(shrink(jp[key],regionConfidence(jp.n),neutral)+shrink(us[key],regionConfidence(us.n),neutral))/2;const one=jp||us;return one?shrink(one[key],regionConfidence(one.n),neutral):null};
const confidenceMeta=(jp,us)=>{const jc=regionConfidence(jp?.n),uc=regionConfidence(us?.n),both=Boolean(jp&&us),confidence=both?(jc+uc)/2*100:Math.max(jc,uc)*55;return{confidence:Math.round(confidence),jp_confidence:Math.round(jc*100),us_confidence:Math.round(uc*100),coverage:both?(jp.n>=3&&us.n>=3?'日米確認':'日米・母数注意'):jp?'日本単独':'米国単独'}};
const propagation=(jp,us)=>{if(jp&&us){if((us.rs5??0)>1&&(jp.rs5??0)<0)return'米国先行・日本未追随';if((us.rs20??0)>0&&(jp.rs5??0)>0&&(jp.rs20??0)<=0)return'日本追随開始';const d=(us.rs5??0)-(jp.rs5??0);if(d>2)return'米国先行';if(d<-2)return'日本先行';return'日米同時'}return jp?'日本のみ':'米国のみ'};

window.themeStats=function(rows){
 const n=rows.length;if(!n)return null;const count=k=>rows.filter(x=>x.entry_lane===k).length,a=count('A'),b=count('B'),c=count('C'),e=count('E');
 const isOverheated=x=>Number(x?.rsi14)>=78||Number(x?.div25)>=10||Number(x?.change_pct)>=8;
 const overheatE=rows.filter(x=>x.entry_lane==='E'&&isOverheated(x)).length,weakE=Math.max(0,e-overheatE);
 const rs5=avg(rows,'rs5'),rs20=avg(rows,'rs20'),vol=avg(rows,'effective_vol_ratio')??avg(rows,'vol_ratio');
 const breadth=rows.filter(x=>Number(x.ret5??x.change_pct)>0).length/n*100;
 const hot=rows.filter(x=>Number(x.rsi14)>=75||Number(x.div25)>=10||Number(x.change_pct)>=8).length/n*100;
 const improving=rows.filter(x=>Number.isFinite(Number(x.rs5))&&Number.isFinite(Number(x.rs20))&&Number(x.rs5)>Number(x.rs20)).length/n*100;
 return{n,a,b,c,e,overheatE,weakE,aRate:a/n,bRate:b/n,cRate:c/n,eRate:e/n,overheatERate:overheatE/n,weakERate:weakE/n,abRate:(a+b)/n,bcRate:(b+c)/n,rs5,rs20,vol,breadth,hot,improving};
};

window.classifyTheme=function(m,regional={}){
 const n=m?.n||0,a=m?.a||0,b=m?.b||0,c=m?.c||0,e=m?.e||0,rs5=m?.rs5,rs20=m?.rs20,vol=m?.vol,breadth=m?.breadth??0,hot=m?.hot??0,improving=m?.improving??0;
 const abRate=m?.abRate??(n?(a+b)/n:0),bcRate=m?.bcRate??(n?(b+c)/n:0),eRate=m?.eRate??(n?e/n:0),overheatERate=m?.overheatERate??0,weakERate=m?.weakERate??Math.max(0,eRate-overheatERate);
 const jp=regional.jp||null,us=regional.us||null,meta=confidenceMeta(jp,us),insufficient=n>0&&meta.confidence<35;
 const relativeBreakdown=(rs5??0)<=-4&&(rs20??0)<=-3,broadBreakdown=weakERate>=.3&&(rs5??0)<0&&(rs20??0)<0&&breadth<45,eDrivenOverheat=overheatERate>=.3&&(rs5??0)>1&&breadth>=55;
 let code='WAIT',label='待機',kind='neutral',reason='明確な資金集中は未確認';
 if(insufficient){label='判定保留';reason='テーマ母数が少なく判定確度が不足'}
 else if(relativeBreakdown||broadBreakdown){code='BREAKDOWN';label='崩壊';kind='bad';reason='相対劣後と悪化型の警戒銘柄が優勢'}
 else if((hot>=25&&((rs20??0)>=4||(rs5??0)>=6))||eDrivenOverheat){code='OVERHEAT';label='過熱';kind='hot';reason='上昇は強いが過熱型の警戒銘柄が増加'}
 else if(abRate>=.35&&(rs5??0)>1&&(rs20??0)>=0&&breadth>=55){code='EXPANSION';label='拡大';kind='good';reason='A・B候補と上昇銘柄の広がりを確認'}
 else if((rs20??0)<0&&(rs5??0)>(rs20??0)+2&&bcRate>=.25){code='RECOVERY';label='修復';kind='repair';reason='中期劣後の中で短期相対強度が反転'}
 else if(b>=1&&(rs5??0)>0&&improving>=40){code='GERMINATION';label='発芽';kind='seed';reason='反転初動と短期相対強度の改善を確認'}
 else if((rs5??0)<0&&(rs20??0)>0){label='調整';reason='中期優位を保ちながら短期調整'}
 const provisional=meta.confidence<60&&['GERMINATION','EXPANSION'].includes(code);if(provisional){label+='候補';reason+='。母数が少ないため確認継続'}
 return{code,label,kind,reason,provisional,n,a,b,c,e,rs5,rs20,vol,breadth,hot,improving,abRate,bcRate,eRate,overheatERate,weakERate,jp,us,...meta,propagation:propagation(jp,us)};
};

window.themePhase=function(rows){const st=window.themeStats(rows),market=/\.T$/i.test(String(rows[0]?.symbol||''))?'jp':'us';return window.classifyTheme(st||{n:0},{[market]:st})};
window.balancedThemePhase=function(jpRows,usRows){
 const jp=window.themeStats(jpRows),us=window.themeStats(usRows),active=[jp,us].filter(Boolean);if(!active.length)return window.classifyTheme({n:0},{jp,us});
 const m={n:(jp?.n||0)+(us?.n||0),a:(jp?.a||0)+(us?.a||0),b:(jp?.b||0)+(us?.b||0),c:(jp?.c||0)+(us?.c||0),e:(jp?.e||0)+(us?.e||0)};
 const neutral={aRate:0,bRate:0,cRate:0,eRate:0,overheatERate:0,weakERate:0,abRate:0,bcRate:0,rs5:0,rs20:0,vol:1,breadth:50,hot:0,improving:50};for(const k of Object.keys(neutral))m[k]=balancedMetric(jp,us,k,neutral[k]);
 return window.classifyTheme(m,{jp,us});
};
})();
