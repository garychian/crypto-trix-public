/**
 * "保存为图片" — render a card/panel to a branded PNG.
 *
 *   attachSnapshotButton(el, 'card-name')   // idempotent, survives innerHTML re-renders
 *   snapshotElement(el, 'card-name')        // direct call
 *
 * html-to-image is loaded lazily on first click (not part of the page-load bundle).
 * The card is cloned into an off-screen stage with its scroll boxes expanded (full rows + columns,
 * independent of scroll position / viewport), rendered at pixelRatio ≤2 (capped for iOS canvas limits),
 * then framed on a canvas: header (logo, title, Asia/Shanghai time), card, footer (@CryptoTrix1 · #NFA).
 * Delivery: desktop → download; mobile → navigator.share({files}) when supported, else a full-screen
 * preview (long-press to save) with share/download/close.
 */

const BG = '#0B0D10';
const GOLD = '#F0B90B';
const PR = 2; // pixel ratio
const FOOT = 54; // css px footer strip
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

const MAX_PIXELS = 16_000_000; // iOS Safari canvas area cap is 16,777,216 px — stay under it
const MAX_SIDE = 16384;
const HEAD = 84; // css px header band (logo, title, time)

/**
 * Off-screen export copy of the card: scroll boxes expanded (overflow/max-height removed), sticky cells
 * made static, and the width grown until no inner scroller overflows horizontally — so the PNG always holds
 * the whole card (every row and column), whatever the on-page scroll position or viewport size.
 */
function buildExportClone(el, opts) {
  const stage = document.createElement('div');
  stage.className = 'snap-stage';
  stage.setAttribute('aria-hidden', 'true');
  const clone = el.cloneNode(true);
  clone.querySelectorAll('.snap-btn, .snap-toast').forEach((n) => n.remove());
  clone.classList.remove('has-snap');
  clone.classList.add('snap-export');
  if (opts.exportClass) clone.classList.add(opts.exportClass);
  clone.removeAttribute('data-snap-attached');
  // live input values aren't part of cloneNode
  const srcInputs = el.querySelectorAll('input, select, textarea');
  clone.querySelectorAll('input, select, textarea').forEach((n, i) => {
    if (srcInputs[i]) n.value = srcInputs[i].value;
  });
  let w = Math.ceil(el.getBoundingClientRect().width);
  if (opts.exportWidth) w = Math.max(w, opts.exportWidth);
  clone.style.setProperty('width', w + 'px', 'important');
  clone.style.setProperty('max-width', 'none', 'important');
  stage.appendChild(clone);
  // right after the original (position:fixed → out of flow): ancestor-scoped CSS still matches the copy
  el.after(stage);

  const all = [clone, ...clone.querySelectorAll('*')];
  const scrollers = [];
  for (const n of all) {
    const cs = getComputedStyle(n);
    if (/(auto|scroll)/.test(cs.overflowX + cs.overflowY)) {
      // horizontally scrolling chip/pill rows: wrap them instead of widening the whole card
      if (n !== clone && /flex/.test(cs.display) && cs.flexWrap === 'nowrap' && cs.flexDirection.startsWith('row')) {
        n.style.setProperty('flex-wrap', 'wrap', 'important');
      }
      scrollers.push(n);
    }
    if (cs.position === 'sticky' || cs.position === '-webkit-sticky') n.style.setProperty('position', 'static', 'important');
    if (cs.maxHeight !== 'none' && /(auto|scroll)/.test(cs.overflowY)) n.style.setProperty('max-height', 'none', 'important');
  }
  // grow until every scroller's content fits (tables reflow as the card widens, so iterate)
  const w0 = w;
  const grow = () => {
    for (let i = 0; i < 4; i++) {
      let need = 0;
      for (const sc of scrollers) need = Math.max(need, sc.scrollWidth - sc.clientWidth);
      if (need <= 1) break;
      w += Math.ceil(need);
      clone.style.setProperty('width', w + 'px', 'important');
    }
  };
  grow();
  if (opts.maxExportWidth && w > opts.maxExportWidth) {
    // too wide (e.g. very long notes): let long text wrap and lay out again from the base width
    clone.classList.add('snap-export-wrap');
    w = w0;
    clone.style.setProperty('width', w + 'px', 'important');
    grow();
  }
  for (const sc of scrollers) {
    sc.style.setProperty('overflow', 'visible', 'important');
    sc.style.setProperty('max-height', 'none', 'important');
    sc.style.setProperty('height', 'auto', 'important');
  }
  return { stage, clone };
}

async function render(node, pr) {
  if (!lib) lib = await import('html-to-image');
  const filter = (n) => !(n.classList && (n.classList.contains('snap-btn') || n.classList.contains('snap-toast')));
  // no backgroundColor: keep the card's own rounded panel background (transparent outside its radius)
  const opts = { pixelRatio: pr, filter, cacheBust: false, skipAutoScale: true };
  if (fontCSS == null) fontCSS = await inlineGoogleFonts();
  if (fontCSS) opts.fontEmbedCSS = fontCSS;
  else opts.skipFonts = true;
  return lib.toCanvas(node, opts);
}

function pageLabel() {
  const t = document.querySelector('.top-nav .nav-tab.active span');
  const id = document.querySelector('.top-nav .nav-tab.active');
  if (!t || (id && id.dataset.tab === 'home')) return '';
  return t.textContent.trim();
}

function frameSize(cssW, cssH) {
  const padX = cssW >= 700 ? 36 : 24;
  const W = Math.max(cssW + padX * 2, MIN_W);
  const H = HEAD + cssH + 22 + FOOT;
  return { W, H, padX };
}

function pickRatio(W, H) {
  let pr = Math.min(PR, Math.sqrt(MAX_PIXELS / (W * H)), MAX_SIDE / W, MAX_SIDE / H);
  return Math.max(0.5, Math.floor(pr * 100) / 100);
}

function fitText(g, text, maxW) {
  if (g.measureText(text).width <= maxW) return text;
  let t = text;
  while (t.length > 1 && g.measureText(t + '…').width > maxW) t = t.slice(0, -1);
  return t + '…';
}

async function compose(card, cssW, cssH, pr, meta) {
  const { W, H, padX } = frameSize(cssW, cssH);
  const c = document.createElement('canvas');
  c.width = Math.round(W * pr);
  c.height = Math.round(H * pr);
  const g = c.getContext('2d');
  g.scale(pr, pr);

  // background: site-dark vertical gradient + soft gold glow (top-left) + faint blue (bottom-right)
  const bg = g.createLinearGradient(0, 0, 0, H);
  bg.addColorStop(0, '#10131A');
  bg.addColorStop(1, BG);
  g.fillStyle = bg;
  g.fillRect(0, 0, W, H);
  const glow = g.createRadialGradient(W * 0.08, 0, 0, W * 0.08, 0, Math.max(W, H) * 0.65);
  glow.addColorStop(0, 'rgba(240,185,11,0.10)');
  glow.addColorStop(1, 'rgba(240,185,11,0)');
  g.fillStyle = glow;
  g.fillRect(0, 0, W, H);
  const blue = g.createRadialGradient(W, H, 0, W, H, Math.max(W, H) * 0.55);
  blue.addColorStop(0, 'rgba(76,111,247,0.07)');
  blue.addColorStop(1, 'rgba(76,111,247,0)');
  g.fillStyle = blue;
  g.fillRect(0, 0, W, H);
  // thin gold hairline along the top edge
  const top = g.createLinearGradient(0, 0, W, 0);
  top.addColorStop(0, 'rgba(240,185,11,0)');
  top.addColorStop(0.5, 'rgba(240,185,11,0.75)');
  top.addColorStop(1, 'rgba(240,185,11,0)');
  g.fillStyle = top;
  g.fillRect(0, 0, W, 2);

  // header: logo · title / brand line · capture time (Asia/Shanghai)
  const p = shanghaiParts();
  const logo = await loadImage('/favicon.svg');
  const ly = 22;
  if (logo) g.drawImage(logo, padX, ly, 40, 40);
  else {
    g.fillStyle = GOLD;
    rrect(g, padX, ly, 40, 40, 10);
    g.fill();
  }
  g.textBaseline = 'alphabetic';
  g.textAlign = 'right';
  g.fillStyle = '#E8EBF0';
  g.font = `700 15px ${FONT}`;
  const when = `${p.year}-${p.month}-${p.day} ${p.hour}:${p.minute}`;
  g.fillText(when, W - padX, ly + 18);
  g.fillStyle = '#69707C';
  g.font = `500 11.5px ${FONT}`;
  g.fillText('Asia/Shanghai · UTC+8', W - padX, ly + 36);
  const rightW = Math.max(g.measureText('Asia/Shanghai · UTC+8').width, 130) + 20;

  const tx = padX + 54;
  const maxTitle = W - padX - rightW - tx;
  g.textAlign = 'left';
  g.fillStyle = '#F2F4F7';
  g.font = `800 21px ${FONT}`;
  const brandOnly = meta.title === 'CryptoTrix';
  g.fillText(fitText(g, meta.title, maxTitle), tx, ly + 19);
  g.font = `600 12.5px ${FONT}`;
  let sx = tx;
  g.fillStyle = GOLD;
  const brand = brandOnly ? '@CryptoTrix1' : 'CryptoTrix';
  g.fillText(brand, sx, ly + 38);
  sx += g.measureText(brand).width;
  if (meta.sub) {
    g.fillStyle = '#9AA4B2';
    g.fillText(fitText(g, '  ·  ' + meta.sub, maxTitle - (sx - tx)), sx, ly + 38);
  }

  // card with a soft drop shadow
  const x = Math.round((W - cssW) / 2);
  const y = HEAD;
  g.save();
  g.shadowColor = 'rgba(0,0,0,0.45)';
  g.shadowBlur = 28;
  g.shadowOffsetY = 10;
  g.fillStyle = 'rgba(18,21,27,0.01)';
  rrect(g, x + 2, y + 2, cssW - 4, cssH - 4, 16);
  g.fill();
  g.restore();
  g.drawImage(card, x, y, cssW, cssH);

  // footer watermark
  const fy = y + cssH + 22;
  const line = g.createLinearGradient(padX, 0, W - padX, 0);
  line.addColorStop(0, 'rgba(240,185,11,0.45)');
  line.addColorStop(1, 'rgba(240,185,11,0.05)');
  g.strokeStyle = line;
  g.lineWidth = 1;
  g.beginPath();
  g.moveTo(padX, fy + 0.5);
  g.lineTo(W - padX, fy + 0.5);
  g.stroke();
  g.textAlign = 'left';
  g.fillStyle = GOLD;
  g.font = `800 14px ${FONT}`;
  g.fillText('@CryptoTrix1', padX, fy + 34);
  g.textAlign = 'right';
  g.fillStyle = '#69707C';
  g.font = `600 12px ${FONT}`;
  g.fillText('#NFA · Not financial advice', W - padX, fy + 34);
  return { canvas: c, stamp: `${p.year}${p.month}${p.day}-${p.hour}${p.minute}` };
}

/* ── delivery ── */
function isMobileDevice() {
  const ua = navigator.userAgent || '';
  return (
    /iPhone|iPad|iPod|Android|Mobile/i.test(ua) ||
    (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1) // iPadOS reports as Mac
  );
}

function download(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10000);
}

function blobToDataURL(blob) {
  return new Promise((res, rej) => {
    const r = new FileReader();
    r.onload = () => res(r.result);
    r.onerror = rej;
    r.readAsDataURL(blob);
  });
}

function shareableFile(blob, filename) {
  try {
    const file = new File([blob], filename, { type: 'image/png' });
    if (navigator.share && navigator.canShare && navigator.canShare({ files: [file] })) return file;
  } catch {}
  return null;
}

/** Full-screen preview: long-press the image to save (iOS), optional share button, close. */
async function showPreview(blob, filename, file) {
  closePreview();
  const src = await blobToDataURL(blob); // data: URL — long-press "Save to Photos" is reliable with it on iOS
  const ov = document.createElement('div');
  ov.id = 'snap-preview';
  ov.className = 'snap-preview';
  ov.setAttribute('role', 'dialog');
  ov.setAttribute('aria-modal', 'true');
  ov.setAttribute('aria-label', '图片预览');
  ov.innerHTML =
    '<div class="snap-pv-bar">' +
    '<span class="snap-pv-hint">长按图片保存到相册</span>' +
    '<span class="snap-pv-actions">' +
    (file ? '<button type="button" class="snap-pv-btn snap-pv-share">分享</button>' : '') +
    '<button type="button" class="snap-pv-btn snap-pv-dl">下载</button>' +
    '<button type="button" class="snap-pv-close" aria-label="关闭">×</button>' +
    '</span></div>' +
    '<div class="snap-pv-body"><img class="snap-pv-img" alt="CryptoTrix 截图"></div>';
  ov.querySelector('.snap-pv-img').src = src;
  ov.querySelector('.snap-pv-close').addEventListener('click', closePreview);
  ov.querySelector('.snap-pv-dl').addEventListener('click', () => download(blob, filename));
  const sh = ov.querySelector('.snap-pv-share');
  if (sh)
    sh.addEventListener('click', async () => {
      try {
        await navigator.share({ files: [file] });
      } catch {}
    });
  ov.addEventListener('click', (e) => {
    if (e.target === ov || e.target.classList.contains('snap-pv-body')) closePreview();
  });
  document.addEventListener('keydown', onPreviewKey);
  document.documentElement.classList.add('snap-pv-open');
  document.body.appendChild(ov);
}

function onPreviewKey(e) {
  if (e.key === 'Escape') closePreview();
}

function closePreview() {
  const ov = document.getElementById('snap-preview');
  if (ov) ov.remove();
  document.removeEventListener('keydown', onPreviewKey);
  document.documentElement.classList.remove('snap-pv-open');
}

async function deliver(blob, filename) {
  if (!isMobileDevice()) {
    download(blob, filename);
    toast('已保存');
    return;
  }
  const file = shareableFile(blob, filename);
  if (file) {
    try {
      await navigator.share({ files: [file] });
      return;
    } catch (e) {
      if (e && e.name === 'AbortError') return; // user closed the share sheet
      // NotAllowedError etc. (tap gesture expired while rendering) → preview with its own share button
    }
  }
  await showPreview(blob, filename, file);
}

function metaFor(el, opts) {
  const page = pageLabel();
  let title = typeof opts.title === 'function' ? opts.title(el) : opts.title;
  let sub = typeof opts.sub === 'function' ? opts.sub(el) : opts.sub;
  if (!title) {
    title = page || 'CryptoTrix';
    return { title, sub: sub || '' };
  }
  return { title, sub: [page, sub].filter(Boolean).join(' · ') };
}

/**
 * @param {Element} el
 * @param {string} name   file-name slug
 * @param {{ title?: string|Function, sub?: string|Function, exportWidth?: number, maxExportWidth?: number,
 *           exportClass?: string }} [opts]
 */
export async function snapshotElement(el, name = 'card', opts = {}) {
  if (busy || !el) return;
  busy = true;
  const btn = el.querySelector(':scope > .snap-btn');
  if (btn) btn.classList.add('busy');
  let stage = null;
  try {
    await settle();
    const meta = metaFor(el, opts);
    const built = buildExportClone(el, opts);
    stage = built.stage;
    const rect = built.clone.getBoundingClientRect();
    const cssW = Math.ceil(rect.width);
    const cssH = Math.ceil(rect.height);
    const { W, H } = frameSize(cssW, cssH);
    const pr = pickRatio(W, H);
    const raw = await render(built.clone, pr);
    const { canvas, stamp } = await compose(raw, cssW, cssH, pr, meta);
    raw.width = raw.height = 0; // free memory early (iOS)
    stage.remove();
    stage = null;
    const blob = await new Promise((res) => canvas.toBlob(res, 'image/png'));
    canvas.width = canvas.height = 0;
    if (!blob) throw new Error('toBlob failed');
    document.documentElement.classList.remove('snap-capturing');
    await deliver(blob, `cryptotrix-${name}-${stamp}.png`);
  } catch (e) {
    console.warn('snapshot failed', e);
    toast('保存失败，请重试', true);
  } finally {
    if (stage) stage.remove();
    document.documentElement.classList.remove('snap-capturing');
    if (btn) btn.classList.remove('busy');
    busy = false;
  }
}

function ensureButton(el, name, opts) {
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
    snapshotElement(el, name, opts);
  });
  el.appendChild(b);
}

/**
 * Attach (once) a subtle camera button to the top-right of `el`.
 * A MutationObserver re-adds it if the card's innerHTML is re-rendered.
 */
export function attachSnapshotButton(el, name, opts = {}) {
  if (typeof el === 'string') el = document.querySelector(el);
  if (!el || el.dataset.snapAttached) return;
  el.dataset.snapAttached = '1';
  ensureButton(el, name, opts);
  new MutationObserver(() => ensureButton(el, name, opts)).observe(el, { childList: true });
}
