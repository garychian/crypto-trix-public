/**
 * "保存为图片" — render a card/panel to a branded PNG.
 *
 *   attachSnapshotButton(el, 'card-name')   // idempotent, survives innerHTML re-renders
 *   snapshotElement(el, 'card-name')        // direct call
 *
 * html-to-image is loaded lazily on first click (not part of the page-load bundle).
 * The card is rendered at pixelRatio 2 on a solid #0B0D10 background, then composed onto a canvas
 * with padding and a CryptoTrix footer strip (logo, name, capture time in Asia/Shanghai, handle).
 */

const BG = '#0B0D10';
const GOLD = '#F0B90B';
const PR = 2; // pixel ratio
const PAD = 22; // css px around the card
const FOOT = 62; // css px footer strip
const MIN_W = 400; // css px; narrow cards are centred so the footer always fits
const FONT = 'Inter, "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", "Noto Sans CJK SC", "Noto Sans SC", sans-serif';

const CAMERA_SVG =
  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
  '<path d="M4 8.5A1.5 1.5 0 0 1 5.5 7h2.2l1.1-1.7A1.5 1.5 0 0 1 10.05 4.6h3.9a1.5 1.5 0 0 1 1.25.7L16.3 7h2.2A1.5 1.5 0 0 1 20 8.5v9a1.5 1.5 0 0 1-1.5 1.5h-13A1.5 1.5 0 0 1 4 17.5z"/>' +
  '<circle cx="12" cy="12.8" r="3.3"/></svg>';

let lib = null;
let fontCSS = null;
let busy = false;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function shanghaiParts(d = new Date()) {
  const f = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });
  const o = {};
  f.formatToParts(d).forEach((p) => (o[p.type] = p.value));
  if (o.hour === '24') o.hour = '00';
  return o;
}

function toast(msg, bad) {
  let t = document.getElementById('snap-toast');
  if (!t) {
    t = document.createElement('div');
    t.id = 'snap-toast';
    t.className = 'snap-toast';
    t.setAttribute('role', 'status');
    document.body.appendChild(t);
  }
  t.textContent = msg;
  t.classList.toggle('bad', !!bad);
  t.classList.add('show');
  clearTimeout(toast._t);
  toast._t = setTimeout(() => t.classList.remove('show'), 1800);
}

function loadImage(src) {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => resolve(null);
    img.src = src;
  });
}

function rrect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

/** Make sure animated values are final before we read the DOM. */
async function settle() {
  document.documentElement.classList.add('snap-capturing'); // kills CSS animations/transitions
  // JS-driven count-ups: jump to their final text
  document.querySelectorAll('[data-final]').forEach((n) => {
    n.textContent = n.getAttribute('data-final');
  });
  // JS (rAF) chart/ring animations run ~1–1.5s after load; wait out the remainder
  const rest = 2600 - performance.now();
  if (rest > 0) await sleep(Math.min(rest, 2600));
  if (document.fonts && document.fonts.ready) {
    try {
      await document.fonts.ready;
    } catch {}
  }
  await sleep(120);
}

/**
 * Cross-origin Google Fonts CSS can't be read via document.styleSheets, so html-to-image can't embed Inter.
 * Fetch the CSS (CORS-enabled), keep the `latin` subset and inline its font file(s) as data URIs.
 * CJK glyphs come from the system font stack. Failure → '' (system fallback font).
 */
async function inlineGoogleFonts() {
  try {
    const link = document.querySelector('link[href*="fonts.googleapis.com/css"]');
    if (!link) return '';
    const css = await (await fetch(link.href)).text();
    const blocks = css.split('@font-face').slice(1).map((b) => '@font-face' + b);
    const latin = blocks.filter((b) => b.includes('U+0000-00FF'));
    const out = [];
    for (const b of latin) {
      const m = b.match(/url\((https:[^)]+)\)/);
      if (!m) continue;
      const buf = await (await fetch(m[1])).arrayBuffer();
      let bin = '';
      const u = new Uint8Array(buf);
      for (let i = 0; i < u.length; i += 8192) bin += String.fromCharCode.apply(null, u.subarray(i, i + 8192));
      out.push(b.replace(m[0], 'url(data:font/woff2;base64,' + btoa(bin) + ')'));
    }
    return out.join('\n');
  } catch {
    return '';
  }
}

async function render(el) {
  if (!lib) lib = await import('html-to-image');
  const filter = (n) => !(n.classList && (n.classList.contains('snap-btn') || n.classList.contains('snap-toast')));
  const opts = { pixelRatio: PR, backgroundColor: BG, filter, cacheBust: false };
  if (fontCSS == null) fontCSS = await inlineGoogleFonts();
  if (fontCSS) opts.fontEmbedCSS = fontCSS;
  else opts.skipFonts = true;
  return lib.toCanvas(el, opts);
}

async function compose(card, cssW, cssH) {
  const W = Math.max(cssW + PAD * 2, MIN_W);
  const H = cssH + PAD * 2 + FOOT;
  const c = document.createElement('canvas');
  c.width = Math.round(W * PR);
  c.height = Math.round(H * PR);
  const g = c.getContext('2d');
  g.scale(PR, PR);
  g.fillStyle = BG;
  g.fillRect(0, 0, W, H);

  // soft gold glow, top-left
  const glow = g.createRadialGradient(0, 0, 0, 0, 0, W * 0.7);
  glow.addColorStop(0, 'rgba(240,185,11,0.07)');
  glow.addColorStop(1, 'rgba(240,185,11,0)');
  g.fillStyle = glow;
  g.fillRect(0, 0, W, H);

  const x = Math.round((W - cssW) / 2);
  g.drawImage(card, x, PAD, cssW, cssH);

  // footer strip
  const fy = PAD + cssH + 16;
  g.strokeStyle = 'rgba(240,185,11,0.35)';
  g.lineWidth = 1;
  g.beginPath();
  g.moveTo(PAD, fy);
  g.lineTo(W - PAD, fy);
  g.stroke();

  const logo = await loadImage('/favicon.svg');
  if (logo) g.drawImage(logo, PAD, fy + 11, 26, 26);
  else {
    g.fillStyle = GOLD;
    rrect(g, PAD, fy + 11, 26, 26, 7);
    g.fill();
  }
  g.textBaseline = 'alphabetic';
  g.textAlign = 'left';
  g.fillStyle = '#E8EBF0';
  g.font = `700 15px ${FONT}`;
  g.fillText('CryptoTrix', PAD + 36, fy + 28);

  const p = shanghaiParts();
  g.fillStyle = '#69707C';
  g.font = `500 11px ${FONT}`;
  g.fillText(`${p.year}-${p.month}-${p.day} ${p.hour}:${p.minute} (UTC+8)`, PAD + 36, fy + 46);

  g.textAlign = 'right';
  g.fillStyle = GOLD;
  g.font = `700 12px ${FONT}`;
  g.fillText('@CryptoTrix1 · #NFA', W - PAD, fy + 38);
  return { canvas: c, stamp: `${p.year}${p.month}${p.day}` };
}

export async function snapshotElement(el, name = 'card') {
  if (busy || !el) return;
  busy = true;
  const btn = el.querySelector(':scope > .snap-btn');
  if (btn) btn.classList.add('busy');
  try {
    await settle();
    const rect = el.getBoundingClientRect();
    const raw = await render(el);
    const { canvas, stamp } = await compose(raw, rect.width, rect.height);
    const blob = await new Promise((res) => canvas.toBlob(res, 'image/png'));
    if (!blob) throw new Error('toBlob failed');
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `cryptotrix-${name}-${stamp}.png`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 10000);
    toast('已保存');
  } catch (e) {
    console.warn('snapshot failed', e);
    toast('保存失败，请重试', true);
  } finally {
    document.documentElement.classList.remove('snap-capturing');
    if (btn) btn.classList.remove('busy');
    busy = false;
  }
}

function ensureButton(el, name) {
  if (el.querySelector(':scope > .snap-btn')) return;
  el.classList.add('has-snap'); // reserves header space for the button (see shared.css)
  if (getComputedStyle(el).position === 'static') el.classList.add('snap-host');
  const b = document.createElement('button');
  b.type = 'button';
  b.className = 'snap-btn';
  b.title = '保存为图片';
  b.setAttribute('aria-label', '保存为图片');
  b.innerHTML = CAMERA_SVG;
  b.addEventListener('click', (e) => {
    e.preventDefault();
    e.stopPropagation();
    snapshotElement(el, name);
  });
  el.appendChild(b);
}

/**
 * Attach (once) a subtle camera button to the top-right of `el`.
 * A MutationObserver re-adds it if the card's innerHTML is re-rendered.
 */
export function attachSnapshotButton(el, name) {
  if (typeof el === 'string') el = document.querySelector(el);
  if (!el || el.dataset.snapAttached) return;
  el.dataset.snapAttached = '1';
  ensureButton(el, name);
  new MutationObserver(() => ensureButton(el, name)).observe(el, { childList: true });
}
