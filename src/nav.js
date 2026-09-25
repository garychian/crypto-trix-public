/**
 * Shared top navigation tab bar for CryptoTrix public MPA.
 * Import once from each page entry; mounts into [data-site-nav] (or body start).
 */

const TABS = [
  { id: 'home', label: '首页', href: '/' },
  { id: 'fund', label: '财富自由基金', href: '/fund.html' },
  { id: 'options', label: '期权', href: '/options.html' },
  { id: 'portfolio', label: '美股仪表盘', href: '/portfolio.html' },
  { id: 'cn-fund', label: 'A股基金', href: '/cn-fund.html' },
];

function resolveActive() {
  const path = (location.pathname || '/').replace(/\/+$/, '') || '/';
  const file = path.split('/').pop() || '';
  if (file === 'fund.html' || path.endsWith('/fund')) return 'fund';
  if (file === 'options.html' || path.endsWith('/options')) return 'options';
  if (file === 'portfolio.html' || path.endsWith('/portfolio')) return 'portfolio';
  if (file === 'cn-fund.html' || path.endsWith('/cn-fund')) return 'cn-fund';
  if (file === 'articles.html' || path.endsWith('/articles')) return 'articles';
  return 'home';
}

function buildNavHtml(active) {
  const tabs = TABS.map((t) => {
    const cls = t.id === active ? 'nav-tab active' : 'nav-tab';
    const aria = t.id === active ? ' aria-current="page"' : '';
    return `<a class="${cls}" href="${t.href}"${aria}>${t.label}</a>`;
  }).join('');

  return `
    <div class="top-nav-inner">
      <a class="brand" href="/" aria-label="CryptoTrix home">Crypto<em>Trix</em></a>
      <div class="nav-right">
        <div class="nav-tabs" role="tablist" aria-label="站点导航">
          ${tabs}
        </div>
        <a class="nav-article${active === 'articles' ? ' active' : ''}" href="/articles.html">📄 Article</a>
      </div>
    </div>
  `.trim();
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
}

mountNav();
