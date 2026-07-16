export const finite = v => Number.isFinite(Number(v));
export const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, Number(v)));
export function round(v, digits = 2) {
  if (!finite(v)) return null;
  const p = 10 ** digits;
  return Math.round(Number(v) * p) / p;
}
export function pct(current, base) {
  if (!finite(current) || !finite(base) || Number(base) === 0) return null;
  return (Number(current) / Number(base) - 1) * 100;
}
export function mean(values) {
  const xs = values.filter(finite).map(Number);
  return xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null;
}
export function median(values) {
  const xs = values.filter(finite).map(Number).sort((a, b) => a - b);
  if (!xs.length) return null;
  const m = Math.floor(xs.length / 2);
  return xs.length % 2 ? xs[m] : (xs[m - 1] + xs[m]) / 2;
}
export const nowIso = () => new Date().toISOString();
export const isoDate = value => new Date(value).toISOString().slice(0, 10);
export function jstDate(value = Date.now()) {
  const d = new Date(value);
  return new Date(d.getTime() + 9 * 3600000).toISOString().slice(0, 10);
}
export function parseJson(raw, fallback = null) {
  if (!raw) return fallback;
  try { return JSON.parse(raw); } catch { return fallback; }
}
export function stableHash(text) {
  let h = 2166136261;
  for (const ch of String(text)) { h ^= ch.charCodeAt(0); h = Math.imul(h, 16777619); }
  return (h >>> 0).toString(16).padStart(8, '0');
}
export function normalizeSymbol(symbol, market) {
  let s = String(symbol || '').trim().toUpperCase();
  if (market === 'jp' && /^[0-9A-Z]{4}$/.test(s)) s += '.T';
  return s;
}
