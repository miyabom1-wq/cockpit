import '../../public/theme-catalog.js';
export const APP_VERSION = 'v73.8.12';
export const SOURCE_COMMIT = typeof __VANTAGE_SOURCE_COMMIT__==='string'?__VANTAGE_SOURCE_COMMIT__:'local-unbuilt';
export const BUILD_TIME = typeof __VANTAGE_BUILD_TIME__==='string'?__VANTAGE_BUILD_TIME__:null;
export const BUILD_ID = SOURCE_COMMIT;
export const KV_SCHEMA_VERSION = 'vantage-kv-v3';
export const ENGINE_VERSION = 'engine-v52-null-safe';
export const BACKTEST_VERSION = 'registered-bt-v9-null-safe';
export const DEPLOYED_AT = BUILD_TIME;
export const FRONTEND_ORIGIN = 'https://miyabom1-wq.github.io';

export const LIMITS = Object.freeze({
  jpMax: 160,
  jpCore: 80,
  usMax: 80,
  usLead: 40,
  batchSize: 20,
});

export const DEFAULT_STOCKS = Object.freeze({
  jp: {
    '285A.T':'キオクシア','8035.T':'東京エレクトロン','6857.T':'アドバンテスト','6146.T':'ディスコ',
    '7735.T':'SCREEN','6920.T':'レーザーテック','6525.T':'コクサイエレ','6315.T':'TOWA',
    '4063.T':'信越化学','3436.T':'SUMCO','4004.T':'レゾナック','4062.T':'イビデン',
    '5016.T':'JX金属','4183.T':'三井化学','6890.T':'フェローテック','6526.T':'ソシオネクスト',
    '6723.T':'ルネサス','6981.T':'村田製作所','6976.T':'太陽誘電','6762.T':'TDK',
    '6971.T':'京セラ','6963.T':'ローム','6594.T':'ニデック','5803.T':'フジクラ',
    '5801.T':'古河電工','5802.T':'住友電工','9984.T':'ソフトバンクG','6702.T':'富士通',
    '6701.T':'NEC','6954.T':'ファナック','6506.T':'安川電機','6861.T':'キーエンス',
    '6273.T':'SMC','6324.T':'ハーモニック','6645.T':'オムロン','7011.T':'三菱重工',
    '7012.T':'川崎重工','7013.T':'IHI','6503.T':'三菱電機','8058.T':'三菱商事',
    '8031.T':'三井物産','8001.T':'伊藤忠','8002.T':'丸紅','8053.T':'住友商事',
    '8306.T':'三菱UFJ','8316.T':'三井住友FG','8411.T':'みずほFG','8766.T':'東京海上',
    '9501.T':'東京電力HD','9503.T':'関西電力','9502.T':'中部電力','7203.T':'トヨタ',
    '7267.T':'ホンダ','7201.T':'日産自動車','6902.T':'デンソー','5401.T':'日本製鉄',
    '7974.T':'任天堂','6758.T':'ソニーG','8136.T':'サンリオ','7832.T':'バンダイナムコ',
    '3697.T':'SHIFT','6965.T':'浜松ホトニクス','9227.T':'マイクロ波化学'
  },
  us: {
    'NVDA':'エヌビディア','AVGO':'ブロードコム','AMD':'AMD','TSM':'TSMC','ARM':'ARM',
    'MRVL':'マーベル','QCOM':'クアルコム','CRDO':'クレド','ALAB':'アステラ・ラボ',
    'MU':'マイクロン','SNDK':'サンディスク','STX':'シーゲート','WDC':'ウエスタンデジタル',
    'AMAT':'アプライドM','LRCX':'ラムリサーチ','KLAC':'KLA','ASML':'ASML',
    'ANET':'アリスタ','CIEN':'シエナ','COHR':'コヒレント','LITE':'ルメンタム',
    'VRT':'ヴァーティブ','ETN':'イートン','GEV':'GEバーノバ','CEG':'コンステレーション',
    'VST':'ヴィストラ','CCJ':'カメコ','GOOGL':'アルファベット','AMZN':'アマゾン','META':'メタ',
    'MSFT':'マイクロソフト','AAPL':'アップル','ORCL':'オラクル','NFLX':'ネットフリックス','TSLA':'テスラ',
    'PLTR':'パランティア','NOW':'サービスナウ','COIN':'コインベース','HOOD':'ロビンフッド','MSTR':'ストラテジー'
  }
});

export const MARKET_INDICES = Object.freeze({
  jp: {
    '日経平均':'^N225','日経先物（CME円建て）':'NIY=F','TOPIX':'^TOPX','日経VI':'^NKVI.OS','ドル円':'JPY=X','SOX':'^SOX',
    'S&P500':'^GSPC','Nasdaq':'^IXIC','Dow':'^DJI','VIX':'^VIX','韓国KOSPI':'^KS11','韓国KOSDAQ':'^KQ11',
    '米10年債':'^TNX','WTI原油':'CL=F','金':'GC=F','銀':'SI=F','BTC':'BTC-USD','ETH':'ETH-USD'
  },
  us: {
    '日経先物（CME円建て）':'NIY=F','SOX':'^SOX','S&P500':'^GSPC','Nasdaq':'^IXIC','Dow':'^DJI','VIX':'^VIX','TOPIX':'^TOPX',
    '韓国KOSPI':'^KS11','韓国KOSDAQ':'^KQ11','米10年債':'^TNX','ドル円':'JPY=X',
    'WTI原油':'CL=F','金':'GC=F','銀':'SI=F','BTC':'BTC-USD','ETH':'ETH-USD'
  }
});

export const themeOf = symbol => globalThis.VantageThemes.themeName({symbol});
