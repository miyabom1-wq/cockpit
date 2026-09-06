// Shared static theme definitions. No request or user state is stored here.
(()=>{
 const buckets=[
  ['メモリ・ストレージ',['285A.T','MU','SNDK','WDC','STX']],
  ['半導体装置',['8035.T','6857.T','6146.T','7735.T','6920.T','6525.T','6315.T','AMAT','LRCX','KLAC','ASML']],
  ['AI半導体・ロジック',['NVDA','AVGO','AMD','TSM','ARM','MRVL','QCOM','CRDO','ALAB','6526.T','6723.T']],
  ['半導体材料',['4063.T','3436.T','4004.T','4062.T','4183.T','6890.T']],
  ['電線・AI物理',['5803.T','5801.T','5802.T','VRT','ETN','GEV']],
  ['電力・原子力',['9501.T','9502.T','9503.T','CEG','VST','CCJ']],
  ['ネットワーク・光',['ANET','CIEN','COHR','LITE']],
  ['メガテック・AIソフト',['GOOGL','AMZN','META','MSFT','AAPL','ORCL','PLTR','NOW']],
  ['防衛・重工',['7011.T','7012.T','7013.T','6503.T']],
  ['金融',['8306.T','8316.T','8411.T','8766.T','HOOD']]
];
 const symbols={...{
  '285A.T':'半導体','8035.T':'半導体','6857.T':'半導体','6146.T':'半導体','7735.T':'半導体','6920.T':'半導体','6525.T':'半導体','6315.T':'半導体','3436.T':'半導体','6890.T':'半導体','6526.T':'半導体','6723.T':'半導体','6963.T':'半導体',
  '4063.T':'半導体材料','4004.T':'半導体材料','4062.T':'半導体材料','4183.T':'半導体材料','5016.T':'非鉄・素材','5401.T':'鉄鋼',
  '6981.T':'電子部品','6976.T':'電子部品','6762.T':'電子部品','6971.T':'電子部品','6594.T':'電子部品','6965.T':'電子部品',
  '5803.T':'電線・AI物理','5801.T':'電線・AI物理','5802.T':'電線・AI物理','9984.T':'ハイテク・IT','6702.T':'ハイテク・IT','6701.T':'ハイテク・IT','3697.T':'ハイテク・IT',
  '6954.T':'FA・機械','6506.T':'FA・機械','6861.T':'FA・機械','6273.T':'FA・機械','6324.T':'FA・機械','6645.T':'FA・機械',
  '7011.T':'防衛・重工','7012.T':'防衛・重工','7013.T':'防衛・重工','6503.T':'防衛・重工',
  '8058.T':'商社','8031.T':'商社','8001.T':'商社','8002.T':'商社','8053.T':'商社',
  '8306.T':'金融','8316.T':'金融','8411.T':'金融','8766.T':'金融','9501.T':'電力','9503.T':'電力','9502.T':'電力',
  '7203.T':'自動車','7267.T':'自動車','7201.T':'自動車','6902.T':'自動車','7974.T':'消費・娯楽','6758.T':'消費・娯楽','8136.T':'消費・娯楽','7832.T':'消費・娯楽','9227.T':'素材・化学',
  'NVDA':'半導体','AVGO':'半導体','AMD':'半導体','TSM':'半導体','ARM':'半導体','MRVL':'半導体','QCOM':'半導体','MU':'半導体','SNDK':'半導体','AMAT':'半導体','LRCX':'半導体','KLAC':'半導体','ASML':'半導体',
  'ANET':'ネットワーク','CIEN':'ネットワーク','COHR':'光通信','LITE':'光通信','VRT':'電力・AI物理','ETN':'電力・AI物理','GEV':'電力・AI物理','CEG':'電力','VST':'電力','CCJ':'原子力',
  'GOOGL':'メガテック','AMZN':'メガテック','META':'メガテック','MSFT':'メガテック','AAPL':'メガテック','ORCL':'メガテック','PLTR':'AIソフト','NOW':'AIソフト','COIN':'暗号資産','HOOD':'金融','MSTR':'暗号資産'
}};
 for(const [name,list] of buckets)for(const symbol of list)symbols[symbol]=name;
 Object.assign(symbols,{TSLA:'自動車',NFLX:'消費・娯楽',NRG:'電力・原子力'});
 const names=Object.freeze([...new Set(Object.values(symbols))].filter(x=>x!=='その他').sort());
 const themeName=row=>{const override=String(row?.theme_override||'').trim();return override||symbols[String(row?.symbol||'').toUpperCase()]||(row?.theme&&row.theme!=='その他'?row.theme:'未分類');};
 globalThis.VantageThemes=Object.freeze({symbols:Object.freeze(symbols),names,themeName,important:Object.freeze(buckets.map(([name])=>name))});
})();
