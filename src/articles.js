import './nav.js';

const esc = (s) =>
  String(s ?? '').replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c]));

function cardHTML(item) {
  const published = item.status === 'published' && item.url;
  const tag = item.tag ? `<span class="art-tag">${esc(item.tag)}</span>` : '';
  const date = item.date ? `<span class="art-date">${esc(item.date)}</span>` : '';
  const badge = published
    ? ''
    : '<span class="art-badge">整理中</span>';
  const title = published
    ? `<a class="art-card-title" href="${esc(item.url)}" target="_blank" rel="noopener">${esc(item.title)} ↗</a>`
    : `<span class="art-card-title">${esc(item.title)}</span>`;
  return (
    `<article class="art-card panel${published ? ' is-live' : ''}">` +
    `<div class="art-card-meta">${tag}${date}${badge}</div>` +
    title +
    (item.desc ? `<p class="art-card-desc">${esc(item.desc)}</p>` : '') +
    `</article>`
  );
}

async function boot() {
  const list = document.getElementById('article-list');
  const intro = document.getElementById('art-intro');
  const updated = document.getElementById('art-updated');
  const ctaRow = document.getElementById('art-cta-row');
  if (!list) return;

  let data = null;
  try {
    const res = await fetch('/data/articles.json', { cache: 'no-store' });
    if (res.ok) data = await res.json();
  } catch {
    /* fall through to empty state */
  }

  const items = Array.isArray(data?.items) ? data.items : [];
  if (intro && data?.intro) intro.textContent = data.intro;
  if (updated && data?.updated) updated.textContent = data.updated;

  if (!items.length) {
    list.innerHTML = '<div class="art-empty muted">文章整理中，先去 X 主页看最新内容。</div>';
  } else {
    // Published first, then coming-soon; stable order within groups.
    const sorted = [...items].sort((a, b) => {
      const pa = a.status === 'published' && a.url ? 0 : 1;
      const pb = b.status === 'published' && b.url ? 0 : 1;
      if (pa !== pb) return pa - pb;
      return String(b.date || '').localeCompare(String(a.date || ''));
    });
    list.innerHTML = sorted.map(cardHTML).join('');
  }

  const cta = data?.cta;
  if (ctaRow && cta?.href) {
    ctaRow.innerHTML =
      `<a class="art-cta" href="${esc(cta.href)}" target="_blank" rel="noopener">${esc(cta.label || '全部文章')} ↗</a>`;
  }
}

boot();
