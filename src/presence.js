/**
 * Soft concurrent-visitor (当前在线) heartbeat for CryptoTrix public MPA.
 * sessionStorage uuid; POST /api/presence ~every 20s while visible;
 * pause when document.hidden; sendBeacon/keepalive on pagehide.
 * Mounts 「在线 N」 into .site-foot (or a subtle bottom bar if none).
 * Imported from nav.js so every page gets it.
 */

const STORAGE_KEY = 'ct-presence-id';
const HEARTBEAT_MS = 20_000;
const API = '/api/presence';

function uuid() {
  try {
    if (crypto?.randomUUID) return crypto.randomUUID().replace(/-/g, '');
  } catch {
    /* fall through */
  }
  const a = new Uint8Array(16);
  crypto.getRandomValues(a);
  return Array.from(a, (b) => b.toString(16).padStart(2, '0')).join('');
}

function getClientId() {
  try {
    let id = sessionStorage.getItem(STORAGE_KEY);
    if (id && /^[A-Za-z0-9_-]{1,64}$/.test(id)) return id;
    id = uuid().slice(0, 64);
    sessionStorage.setItem(STORAGE_KEY, id);
    return id;
  } catch {
    return uuid().slice(0, 64);
  }
}

function ensureMount() {
  let el = document.getElementById('ct-online');
  if (el) return el;

  el = document.createElement('span');
  el.id = 'ct-online';
  el.className = 'ct-online';
  el.setAttribute('aria-live', 'polite');
  el.setAttribute('aria-atomic', 'true');
  el.innerHTML =
    '<span class="ct-online-dot" aria-hidden="true"></span><span class="ct-online-label">在线</span> <span class="ct-online-n" data-n>—</span>';

  const foot = document.querySelector('footer.site-foot');
  if (foot) {
    // Prefer a dedicated slot as the last flex child
    let slot = foot.querySelector('.ct-online-slot');
    if (!slot) {
      slot = document.createElement('div');
      slot.className = 'ct-online-slot';
      foot.appendChild(slot);
    }
    slot.appendChild(el);
  } else {
    // Articles etc. without footer — subtle fixed corner chip
    const chip = document.createElement('div');
    chip.className = 'ct-online-chip';
    chip.appendChild(el);
    document.body.appendChild(chip);
  }
  return el;
}

function renderOnline(n) {
  const el = ensureMount();
  const num = el.querySelector('[data-n]');
  if (!num) return;
  const v = typeof n === 'number' && n >= 0 ? String(n) : '—';
  if (num.textContent !== v) num.textContent = v;
  el.title = typeof n === 'number' ? `当前大约 ${n} 人在线（近似）` : '在线人数加载中';
}

async function beat(id, { keepalive = false } = {}) {
  const body = JSON.stringify({ id });
  try {
    if (keepalive && typeof navigator.sendBeacon === 'function') {
      const blob = new Blob([body], { type: 'application/json' });
      if (navigator.sendBeacon(API, blob)) return null;
    }
    const res = await fetch(API, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body,
      keepalive: !!keepalive,
      cache: 'no-store',
    });
    if (!res.ok) return null;
    const data = await res.json().catch(() => null);
    return data && typeof data.online === 'number' ? data.online : null;
  } catch {
    return null;
  }
}

function start() {
  if (typeof window === 'undefined' || typeof document === 'undefined') return;
  const id = getClientId();
  ensureMount();
  renderOnline(null);

  let timer = null;

  const stopTimer = () => {
    if (timer != null) {
      clearInterval(timer);
      timer = null;
    }
  };

  const tick = async () => {
    if (document.hidden) return;
    const n = await beat(id);
    if (n != null) renderOnline(n);
  };

  const startTimer = () => {
    stopTimer();
    timer = setInterval(tick, HEARTBEAT_MS);
  };

  // Initial beat + schedule
  tick();
  if (!document.hidden) startTimer();

  document.addEventListener('visibilitychange', () => {
    if (document.hidden) {
      stopTimer();
    } else {
      tick();
      startTimer();
    }
  });

  const farewell = () => {
    stopTimer();
    beat(id, { keepalive: true });
  };
  addEventListener('pagehide', farewell);
  addEventListener('beforeunload', farewell);
}

start();
