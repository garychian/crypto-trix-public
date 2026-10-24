export const usd = (v) =>
  v == null || !Number.isFinite(v) ? '—' : '$' + Math.round(v).toLocaleString('en-US');

export const usdSigned = (v) => {
  if (v == null || !Number.isFinite(v)) return '—';
  return (v >= 0 ? '+' : '−') + '$' + Math.abs(Math.round(v)).toLocaleString('en-US');
};

export const pctSigned = (v, digits = 2) => {
  if (v == null || !Number.isFinite(v)) return '—';
  return (v >= 0 ? '+' : '') + v.toFixed(digits) + '%';
};

export const moneyCls = (v) =>
  v == null || !Number.isFinite(v) ? 'muted' : v > 0 ? 'up' : v < 0 ? 'down' : 'flat';

export function escapeHTML(s) {
  return String(s).replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])
  );
}

export function dayNumber(startISO) {
  const start = new Date(startISO + 'T00:00:00').getTime();
  const n = Math.floor((Date.now() - start) / 86400000) + 1;
  return Number.isFinite(n) && n > 0 ? n : null;
}

export function fmtExpiry(s) {
  const m = String(s).match(/(\d{4})-(\d{2})-(\d{2})/);
  if (!m) return s;
  return parseInt(m[2], 10) + '/' + parseInt(m[3], 10);
}
