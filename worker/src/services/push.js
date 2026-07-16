// ============================================================
// push.js — Web Push (VAPID + aes128gcm) を Cloudflare Workers で自前実装
// web-push npm は Worker で動かないため、Web Crypto API で署名・暗号化する。
//
// 用途: 指数 regime trigger（ドル円velocity / VIX水準 / SOX vs SPX）発火時に
//   購読中の全デバイスへ push を送る。低頻度・高シグナルの指数通知専用。
//
// シークレット:
//   VAPID_PRIVATE_KEY  … base64url の P-256 秘密スカラー d（32バイト）
//   VAPID_SUBJECT      … 'mailto:you@example.com'（VAPID仕様で必須）
// フロントに埋め込む公開鍵（applicationServerKey）はソース直書きでよい（公開情報）。
//
// KV: push:subs … 購読オブジェクトの配列 [{endpoint, keys:{p256dh, auth}}]
// ============================================================

const SUBS_KEY = 'push:subs';

// フロントと共有する公開鍵（uncompressed 65byte base64url）。公開情報。
// ※ wrangler deploy 前にあなたの公開鍵であること（フロントの applicationServerKey と一致必須）。
export const VAPID_PUBLIC_KEY_RAW = 'BER80-Ks81bdZPF9SB26rsOkxRhSIL8l3nYkK_n-zHJLrOayPYM42o0nh4mPDMwOelrpnY1lzZEEpgQXGbJ1qjs';

// ---- base64url helpers ----
function b64urlToBytes(s) {
  s = s.replace(/-/g, '+').replace(/_/g, '/');
  while (s.length % 4) s += '=';
  const bin = atob(s);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}
function bytesToB64url(bytes) {
  let bin = '';
  const b = new Uint8Array(bytes);
  for (let i = 0; i < b.length; i++) bin += String.fromCharCode(b[i]);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
function concatBytes(...arrs) {
  let len = 0; for (const a of arrs) len += a.length;
  const out = new Uint8Array(len); let o = 0;
  for (const a of arrs) { out.set(a, o); o += a.length; }
  return out;
}

// ---- 購読管理 ----
export async function getSubs(env) {
  try { const raw = await env.COCKPIT_KV.get(SUBS_KEY); return raw ? JSON.parse(raw) : []; }
  catch { return []; }
}
async function putSubs(env, subs) { await env.COCKPIT_KV.put(SUBS_KEY, JSON.stringify(subs)); }

export async function addSub(env, sub) {
  if (!sub || !sub.endpoint || !sub.keys || !sub.keys.p256dh || !sub.keys.auth) {
    return { ok: false, error: 'invalid subscription' };
  }
  const subs = await getSubs(env);
  if (!subs.find(s => s.endpoint === sub.endpoint)) {
    subs.push({ endpoint: sub.endpoint, keys: { p256dh: sub.keys.p256dh, auth: sub.keys.auth } });
    await putSubs(env, subs);
  }
  return { ok: true, count: subs.length };
}
export async function removeSub(env, endpoint) {
  const subs = await getSubs(env);
  const next = subs.filter(s => s.endpoint !== endpoint);
  await putSubs(env, next);
  return { ok: true, count: next.length };
}

// ---- VAPID JWT (ES256) ----
async function importVapidPrivateKey(env) {
  const d = env.VAPID_PRIVATE_KEY;
  if (!d) throw new Error('VAPID_PRIVATE_KEY not set');
  // 公開鍵x,yは不要（署名のみ）。JWKでdだけ渡すとimportできないため、
  // dからの署名にはPKCS8が要る。ここではJWK(d + ダミーでなく実x,y)を使うのが安全。
  // 運用上はVAPID_PUBLIC_KEY(uncompressed 65byte)も併せて持たせる。
  const pub = b64urlToBytes(VAPID_PUBLIC_KEY_RAW); // 0x04 || X(32) || Y(32)
  const x = bytesToB64url(pub.slice(1, 33));
  const y = bytesToB64url(pub.slice(33, 65));
  const jwk = { kty: 'EC', crv: 'P-256', d, x, y, ext: true, key_ops: ['sign'] };
  return crypto.subtle.importKey('jwk', jwk, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign']);
}

async function makeVapidJWT(env, audience) {
  const header = { typ: 'JWT', alg: 'ES256' };
  const exp = Math.floor(Date.now() / 1000) + 12 * 3600; // 12h
  const payload = { aud: audience, exp, sub: env.VAPID_SUBJECT || 'mailto:admin@example.com' };
  const enc = o => bytesToB64url(new TextEncoder().encode(JSON.stringify(o)));
  const signingInput = `${enc(header)}.${enc(payload)}`;
  const key = await importVapidPrivateKey(env);
  const sig = await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' },
    key, new TextEncoder().encode(signingInput));
  // WebCrypto returns raw r||s (64 bytes) which is what JWS ES256 wants.
  return `${signingInput}.${bytesToB64url(new Uint8Array(sig))}`;
}

// ---- aes128gcm 本文暗号化（RFC 8291） ----
async function hkdf(salt, ikm, info, len) {
  const key = await crypto.subtle.importKey('raw', ikm, 'HKDF', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits(
    { name: 'HKDF', hash: 'SHA-256', salt, info }, key, len * 8);
  return new Uint8Array(bits);
}

async function encryptPayload(payloadStr, p256dhB64, authB64) {
  const clientPub = b64urlToBytes(p256dhB64);   // 65 bytes uncompressed
  const authSecret = b64urlToBytes(authB64);    // 16 bytes
  // サーバの一時鍵ペア
  const ephem = await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits']);
  const ephemPubRaw = new Uint8Array(await crypto.subtle.exportKey('raw', ephem.publicKey)); // 65
  const clientKey = await crypto.subtle.importKey('raw', clientPub, { name: 'ECDH', namedCurve: 'P-256' }, false, []);
  const sharedBits = await crypto.subtle.deriveBits({ name: 'ECDH', public: clientKey }, ephem.privateKey, 256);
  const ecdh = new Uint8Array(sharedBits);

  const salt = crypto.getRandomValues(new Uint8Array(16));
  // PRK_key = HKDF(auth, ecdh, "WebPush: info\0" || clientPub || serverPub, 32)
  const te = new TextEncoder();
  const keyInfo = concatBytes(te.encode('WebPush: info\0'), clientPub, ephemPubRaw);
  const ikm = await hkdf(authSecret, ecdh, keyInfo, 32);
  const cek = await hkdf(salt, ikm, te.encode('Content-Encoding: aes128gcm\0'), 16);
  const nonce = await hkdf(salt, ikm, te.encode('Content-Encoding: nonce\0'), 12);

  const aesKey = await crypto.subtle.importKey('raw', cek, 'AES-GCM', false, ['encrypt']);
  // payload + 0x02 delimiter (single record, no padding)
  const plaintext = concatBytes(te.encode(payloadStr), new Uint8Array([0x02]));
  const ct = new Uint8Array(await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv: nonce, tagLength: 128 }, aesKey, plaintext));

  // aes128gcm header: salt(16) || rs(4, =4096) || idlen(1) || keyid(serverPub 65)
  const rs = new Uint8Array([0, 0, 0x10, 0]); // 4096
  const idlen = new Uint8Array([ephemPubRaw.length]);
  const header = concatBytes(salt, rs, idlen, ephemPubRaw);
  return concatBytes(header, ct);
}

// ---- 単一購読へ送信 ----
async function sendOne(env, sub, payloadObj) {
  const url = new URL(sub.endpoint);
  const audience = `${url.protocol}//${url.host}`;
  const jwt = await makeVapidJWT(env, audience);
  const body = await encryptPayload(JSON.stringify(payloadObj), sub.keys.p256dh, sub.keys.auth);
  const res = await fetch(sub.endpoint, {
    method: 'POST',
    headers: {
      'Authorization': `vapid t=${jwt}, k=${VAPID_PUBLIC_KEY_RAW}`,
      'Content-Encoding': 'aes128gcm',
      'Content-Type': 'application/octet-stream',
      'TTL': '3600',
      'Urgency': 'normal',
    },
    body,
  });
  return res.status;
}

// ---- 全購読へ送信。404/410 は購読失効としてKVから掃除 ----
export async function sendPushToAll(env, payloadObj) {
  const subs = await getSubs(env);
  if (subs.length === 0) return { sent: 0, removed: 0 };
  let sent = 0; const dead = [];
  for (const sub of subs) {
    try {
      const status = await sendOne(env, sub, payloadObj);
      if (status === 404 || status === 410) dead.push(sub.endpoint);
      else if (status >= 200 && status < 300) sent++;
    } catch (e) {
      console.error('[push] send failed:', e && e.message || e);
    }
  }
  if (dead.length) {
    const next = subs.filter(s => !dead.includes(s.endpoint));
    await putSubs(env, next);
  }
  return { sent, removed: dead.length };
}

// ============================================================
// 指数 regime trigger 評価。stage KV の macro を読み、push に値する
// 「相場の体制変化」だけを離散トリガーとして返す。低頻度・高シグナル。
//   - ドル円: 単日±0.7%超 or 25日線±2%超（既存computeSentimentと同基準）
//   - VIX: 20/30 の水準クロス
//   - SOX vs SPX: 当日乖離±1.0%超（テーマ生存/崩れ）
// 各triggerは安定キーを持ち、index.js側で1日1回dedupする。
// ============================================================
export async function evaluateIndexTriggers(env) {
  let macro = {};
  try {
    const rawUs = await env.COCKPIT_KV.get('stage:us');
    if (rawUs) macro = (JSON.parse(rawUs).macro) || {};
    if (!macro['ドル円']) {
      const rawJp = await env.COCKPIT_KV.get('stage:jp');
      if (rawJp) macro = { ...(JSON.parse(rawJp).macro || {}), ...macro };
    }
  } catch {}

  const triggers = [];
  const fx = macro['ドル円'], vix = macro['VIX'], sox = macro['SOX'], spx = macro['S&P500'];
  const nasdaq = macro['Nasdaq'], dow = macro['Dow'], btc = macro['BTC'];
  const gold = macro['金'], wti = macro['WTI原油'], tnx = macro['米10年債'];

  // ドル円: velocity（旧auto-alerts基準）
  if (fx && fx.change_pct != null) {
    const chg = fx.change_pct, dv = fx.div25;
    if (Math.abs(chg) >= 0.7) {
      triggers.push({
        key: 'fx_vel', title: `⚡ ドル円 ${chg > 0 ? '円安' : '円高'}急変`,
        body: `${fx.price}（1日${chg > 0 ? '+' : ''}${chg}%）。${chg > 0 ? '介入警戒域' : 'リスクオフ/輸出逆風'}`,
      });
    } else if (dv != null && Math.abs(dv) >= 2) {
      triggers.push({
        key: 'fx_trend', title: `⚡ ドル円トレンド加速`,
        body: `${fx.price}（25日線${dv > 0 ? '+' : ''}${dv}%・${dv > 0 ? '円安' : '円高'}方向）`,
      });
    }
  }
  // VIX: 水準クロス
  if (vix && vix.price != null) {
    if (vix.price >= 30) triggers.push({ key: 'vix_30', title: '🚨 VIX 30超え', body: `${vix.price} パニック域。リスクオフ` });
    else if (vix.price >= 20) triggers.push({ key: 'vix_20', title: '⚠ VIX 20超え', body: `${vix.price} 警戒域へ` });
  }
  // SOX vs SPX: テーマ相対強度
  if (sox && spx && sox.change_pct != null && spx.change_pct != null) {
    const d = +(sox.change_pct - spx.change_pct).toFixed(2);
    if (d <= -1.0) triggers.push({ key: 'sox_under', title: '⚠ SOXアンダーパフォーム', body: `SOX−SPX ${d}%。半導体テーマ警戒` });
    else if (d >= 1.0) triggers.push({ key: 'sox_strong', title: '🔥 SOX強', body: `SOX−SPX +${d}%。テーマ生存` });
  }
  // SOX単体の急変（旧auto-alerts: ±3%）
  if (sox && sox.change_pct != null && Math.abs(sox.change_pct) >= 3) {
    const c = sox.change_pct;
    triggers.push({ key: 'sox_move', title: `${c > 0 ? '🔥' : '⚠'} SOX ${c > 0 ? '急騰' : '急落'}`, body: `${c > 0 ? '+' : ''}${c}%。半導体全体が${c > 0 ? '強い' : '崩れ'}` });
  }
  // 米株指数の急変（旧auto-alerts: S&P/Nasdaq ±2%, Dow ±1.5%）
  if (spx && spx.change_pct != null && Math.abs(spx.change_pct) >= 2) {
    const c = spx.change_pct;
    triggers.push({ key: 'spx_move', title: `${c > 0 ? '📈' : '📉'} S&P500 ${c > 0 ? '急騰' : '急落'}`, body: `${c > 0 ? '+' : ''}${c}%。地合い転換の可能性` });
  }
  if (nasdaq && nasdaq.change_pct != null && Math.abs(nasdaq.change_pct) >= 2) {
    const c = nasdaq.change_pct;
    triggers.push({ key: 'ndx_move', title: `${c > 0 ? '📈' : '📉'} Nasdaq ${c > 0 ? '急騰' : '急落'}`, body: `${c > 0 ? '+' : ''}${c}%。グロース敏感` });
  }
  if (dow && dow.change_pct != null && Math.abs(dow.change_pct) >= 1.5) {
    const c = dow.change_pct;
    triggers.push({ key: 'dow_move', title: `${c > 0 ? '📈' : '📉'} ダウ ${c > 0 ? '急騰' : '急落'}`, body: `${c > 0 ? '+' : ''}${c}%` });
  }
  // BTC（旧auto-alerts: ±5%）。リスク選好の代理指標
  if (btc && btc.change_pct != null && Math.abs(btc.change_pct) >= 5) {
    const c = btc.change_pct;
    triggers.push({ key: 'btc_move', title: `${c > 0 ? '🚀' : '🩸'} BTC ${c > 0 ? '急騰' : '急落'}`, body: `${c > 0 ? '+' : ''}${c}%。リスク選好の${c > 0 ? '回復' : '後退'}` });
  }
  // 金（±2%）・WTI（±3%）。コモディティ急変
  if (gold && gold.change_pct != null && Math.abs(gold.change_pct) >= 2) {
    const c = gold.change_pct;
    triggers.push({ key: 'gold_move', title: `${c > 0 ? '🥇' : '⚠'} 金 ${c > 0 ? '急騰' : '急落'}`, body: `${c > 0 ? '+' : ''}${c}%。${c > 0 ? '質への逃避' : 'リスクオン'}の可能性` });
  }
  if (wti && wti.change_pct != null && Math.abs(wti.change_pct) >= 3) {
    const c = wti.change_pct;
    triggers.push({ key: 'wti_move', title: `${c > 0 ? '🛢' : '⚠'} WTI原油 ${c > 0 ? '急騰' : '急落'}`, body: `${c > 0 ? '+' : ''}${c}%` });
  }
  // 米10年債（旧auto-alerts: 4.5%超え/4.0%割れ）。^TNXは10倍表記なので÷10
  if (tnx && tnx.price != null) {
    const y = tnx.price > 20 ? tnx.price / 10 : tnx.price;
    if (y >= 4.5) triggers.push({ key: 'tnx_high', title: '⚠ 米10年債 4.5%超え', body: `利回り${y.toFixed(2)}%。金利上昇圧` });
    else if (y <= 4.0) triggers.push({ key: 'tnx_low', title: '⚡ 米10年債 4.0%割れ', body: `利回り${y.toFixed(2)}%。金利低下` });
  }
  return triggers;
}
