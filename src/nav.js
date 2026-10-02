/**
 * Shared top navigation for CryptoTrix public MPA.
 * Import once from each page entry; mounts into [data-site-nav] (or body start).
 *
 * Futuristic terminal look: glass bar, segmented tab track with a gold pill
 * indicator that glides from the previous page's tab to the current one
 * (remembered via sessionStorage), inline-SVG icons, ghost Article button.
 */

const ICON = {
  home: '<path d="M3 11l9-7 9 7"/><path d="M5 10v10h14V10"/>',
  fund: '<path d="M3 17l6-6 4 4 8-8"/><path d="M15 7h6v6"/>',
  options: '<path d="M12 3l9 5-9 5-9-5 9-5z"/><path d="M3 13l9 5 9-5"/>',
  'cn-fund': '<path d="M21 12A9 9 0 1 1 12 3v9z"/><path d="M15.5 3.6A9 9 0 0 1 20.4 8.5H15.5z"/>',
  articles:
    '<path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z"/><path d="M14 3v5h5M9 13h6M9 17h6"/>',
};

const svg = (id) =>
  `<svg class="nav-ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">${ICON[id]}</svg>`;

const TABS = [
  { id: 'home', label: '首页', href: '/' },
  { id: 'fund', label: '财富自由基金', href: '/fund.html' },
  { id: 'options', label: '期权', href: '/options.html' },
  { id: 'cn-fund', label: 'A股基金', href: '/cn-fund.html' },
];

const PREV_KEY = 'ct-nav-prev';

function resolveActive() {
  const path = (location.pathname || '/').replace(/\/+$/, '') || '/';
  const file = path.split('/').pop() || '';
  if (file === 'fund.html' || path.endsWith('/fund')) return 'fund';
  if (file === 'options.html' || path.endsWith('/options')) return 'options';
  if (file === 'portfolio.html' || path.endsWith('/portfolio')) return 'fund'; // merged into 财富自由基金
  if (file === 'cn-fund.html' || path.endsWith('/cn-fund')) return 'cn-fund';
  if (file === 'articles.html' || path.endsWith('/articles')) return 'articles';
  return 'home';
}

function buildNavHtml(active) {
  const tabs = TABS.map((t) => {
    const on = t.id === active;
    return `<a class="nav-tab${on ? ' active' : ''}" data-tab="${t.id}" href="${t.href}"${
      on ? ' aria-current="page"' : ''
    }>${svg(t.id)}<span>${t.label}</span></a>`;
  }).join('');

  return `
    <div class="top-nav-inner">
      <a class="brand" href="/" aria-label="CryptoTrix home"><span class="brand-mark" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 16l5-5 4 4 7-8"/></svg></span><span class="brand-name">Crypto<em>Trix</em></span></a>
      <div class="nav-right">
        <nav class="nav-tabs" aria-label="站点导航">
          <span class="nav-ind" aria-hidden="true"></span>
          ${tabs}
        </nav>
        <a class="nav-article${active === 'articles' ? ' active' : ''}" href="/articles.html"${
          active === 'articles' ? ' aria-current="page"' : ''
        }>${svg('articles')}<span>Article</span></a>
      </div>
    </div>
  `.trim();
}

function setupIndicator(host, active) {
  const track = host.querySelector('.nav-tabs');
  const ind = host.querySelector('.nav-ind');
  if (!track || !ind) return;
  const tabs = [...track.querySelectorAll('.nav-tab')];
  const cur = tabs.find((t) => t.dataset.tab === active);
  const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;

  const place = (el) => {
    ind.style.width = el.offsetWidth + 'px';
    ind.style.transform = `translateX(${el.offsetLeft}px)`;
  };
  const centerActive = (smooth) => {
    if (!cur) return;
    const max = track.scrollWidth - track.clientWidth;
    if (max <= 0) return;
    const left = Math.max(0, Math.min(max, cur.offsetLeft - (track.clientWidth - cur.offsetWidth) / 2));
    track.scrollTo({ left, behavior: smooth && !reduced ? 'smooth' : 'auto' });
  };
  const edges = () => {
    const max = track.scrollWidth - track.clientWidth;
    track.classList.toggle('fade-l', track.scrollLeft > 4);
    track.classList.toggle('fade-r', max > 4 && track.scrollLeft < max - 4);
  };

  let prevId = null;
  try {
    prevId = sessionStorage.getItem(PREV_KEY);
    sessionStorage.setItem(PREV_KEY, active);
  } catch {
    /* private mode */
  }

  if (!cur) {
    ind.style.opacity = '0'; // e.g. articles page: Article button carries the active state
  } else {
    const from = tabs.find((t) => t.dataset.tab === prevId);
    ind.classList.add('no-anim');
    place(from && from !== cur && !reduced ? from : cur);
    centerActive(false);
    edges();
    if (from && from !== cur && !reduced) {
      void ind.offsetWidth; // commit start position
      ind.classList.remove('no-anim');
      requestAnimationFrame(() => place(cur));
    } else {
      void ind.offsetWidth;
      ind.classList.remove('no-anim');
    }
  }

  const relayout = () => {
    if (!cur) return;
    ind.classList.add('no-anim');
    place(cur);
    void ind.offsetWidth;
    ind.classList.remove('no-anim');
    edges();
  };
  addEventListener('resize', relayout, { passive: true });
  track.addEventListener('scroll', edges, { passive: true });
  if (document.fonts && document.fonts.ready) document.fonts.ready.then(() => { relayout(); centerActive(false); });
}

export function mountNav() {
  let host = document.querySelector('[data-site-nav]');
  if (!host) {
    host = document.createElement('header');
    host.setAttribute('data-site-nav', '');
    document.body.prepend(host);
  }

  host.className = 'top-nav';
  if (host.tagName !== 'HEADER' && host.tagName !== 'NAV') {
    // keep existing tag; role for a11y
    host.setAttribute('role', 'banner');
  }

  const active = resolveActive();
  host.innerHTML = buildNavHtml(active);
  document.body.classList.add('has-top-nav');
  try {
    setupIndicator(host, active);
  } catch {
    /* indicator is cosmetic; links must keep working */
  }
}

mountNav();
