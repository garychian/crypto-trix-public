/**
 * Site-wide floating AI chat widget (CryptoTrix public).
 * Mounts once; dark theme + gold accent. Calls POST /api/chat.
 * Imported from nav.js so every page gets it.
 */

const MAX_HISTORY = 16;
const STORAGE_KEY = 'ct-chat-open';

const CSS = `
.ct-chat-root { position: fixed; z-index: 9999; right: 18px; bottom: 18px; font-family: var(--font, Inter, system-ui, sans-serif); color: var(--text, #E8EBF0); }
.ct-chat-fab {
  width: 56px; height: 56px; border-radius: 50%; border: 1px solid rgba(240,185,11,0.45);
  background: linear-gradient(145deg, rgba(240,185,11,0.95), rgba(200,140,0,0.9));
  color: #0B0D10; cursor: pointer; display: grid; place-items: center;
  box-shadow: 0 10px 28px rgba(0,0,0,0.45), 0 0 20px rgba(240,185,11,0.25);
  transition: transform .15s ease, box-shadow .15s ease;
}
.ct-chat-fab:hover { transform: translateY(-2px) scale(1.03); box-shadow: 0 14px 32px rgba(0,0,0,0.5), 0 0 24px rgba(240,185,11,0.35); }
.ct-chat-fab:focus-visible { outline: 2px solid var(--accent, #F0B90B); outline-offset: 3px; }
.ct-chat-fab svg { width: 26px; height: 26px; }
.ct-chat-fab[aria-expanded="true"] { background: var(--panel-2, #1A1F28); color: var(--accent, #F0B90B); border-color: rgba(240,185,11,0.55); }

.ct-chat-panel {
  position: absolute; right: 0; bottom: 70px; width: min(380px, calc(100vw - 28px));
  height: min(520px, calc(100vh - 110px));
  display: flex; flex-direction: column;
  background: rgba(18,21,27,0.96);
  border: 1px solid rgba(255,255,255,0.1);
  border-radius: 16px;
  box-shadow: 0 22px 60px rgba(0,0,0,0.55), 0 0 0 1px rgba(240,185,11,0.08);
  -webkit-backdrop-filter: blur(16px); backdrop-filter: blur(16px);
  overflow: hidden;
  transform-origin: bottom right;
  animation: ct-chat-in .18s ease-out;
}
@keyframes ct-chat-in { from { opacity: 0; transform: translateY(8px) scale(.97); } to { opacity: 1; transform: none; } }
.ct-chat-panel[hidden] { display: none !important; }

.ct-chat-head {
  display: flex; align-items: center; justify-content: space-between; gap: 10px;
  padding: 12px 14px; border-bottom: 1px solid rgba(255,255,255,0.07);
  background: linear-gradient(180deg, rgba(240,185,11,0.08), transparent);
}
.ct-chat-title { font-size: 14px; font-weight: 700; letter-spacing: -0.2px; display: flex; align-items: center; gap: 8px; }
.ct-chat-title .dot { width: 8px; height: 8px; border-radius: 50%; background: var(--accent, #F0B90B); box-shadow: 0 0 8px rgba(240,185,11,0.7); }
.ct-chat-sub { font-size: 11px; color: var(--muted, #9AA4B2); font-weight: 500; }
.ct-chat-close {
  width: 32px; height: 32px; border-radius: 8px; border: 1px solid rgba(255,255,255,0.08);
  background: transparent; color: var(--muted, #9AA4B2); cursor: pointer; display: grid; place-items: center;
}
.ct-chat-close:hover { color: var(--text, #E8EBF0); background: rgba(255,255,255,0.05); }

.ct-chat-msgs {
  flex: 1; overflow-y: auto; padding: 14px; display: flex; flex-direction: column; gap: 10px;
  scrollbar-width: thin; scrollbar-color: rgba(240,185,11,0.35) transparent;
}
.ct-chat-bubble {
  max-width: 92%; padding: 10px 12px; border-radius: 12px; font-size: 13.5px; line-height: 1.55;
  white-space: pre-wrap; word-break: break-word;
}
.ct-chat-bubble.bot {
  align-self: flex-start; background: var(--panel-2, #1A1F28);
  border: 1px solid rgba(255,255,255,0.06);
}
.ct-chat-bubble.user {
  align-self: flex-end; background: rgba(240,185,11,0.15);
  border: 1px solid rgba(240,185,11,0.35); color: #fff;
}
.ct-chat-bubble.err {
  align-self: stretch; background: rgba(246,70,93,0.12);
  border: 1px solid rgba(246,70,93,0.35); color: #ffb3bd; font-size: 12.5px;
}
.ct-chat-bubble.sys { align-self: stretch; color: var(--muted, #9AA4B2); font-size: 12px; background: transparent; border: none; padding: 4px 2px; }

.ct-chat-typing { align-self: flex-start; display: flex; gap: 4px; padding: 10px 14px; }
.ct-chat-typing span {
  width: 6px; height: 6px; border-radius: 50%; background: var(--accent, #F0B90B); opacity: .45;
  animation: ct-dot 1s infinite ease-in-out;
}
.ct-chat-typing span:nth-child(2) { animation-delay: .15s; }
.ct-chat-typing span:nth-child(3) { animation-delay: .3s; }
@keyframes ct-dot { 0%,80%,100% { opacity: .3; transform: translateY(0); } 40% { opacity: 1; transform: translateY(-3px); } }

.ct-chat-form {
  display: flex; gap: 8px; padding: 10px 12px 12px; border-top: 1px solid rgba(255,255,255,0.07);
  background: rgba(11,13,16,0.55);
}
.ct-chat-input {
  flex: 1; min-height: 42px; max-height: 96px; resize: none;
  border-radius: 10px; border: 1px solid rgba(255,255,255,0.1);
  background: var(--panel, #12151B); color: var(--text, #E8EBF0);
  padding: 10px 12px; font-size: 13.5px; line-height: 1.4; font-family: inherit;
}
.ct-chat-input:focus { outline: none; border-color: rgba(240,185,11,0.55); box-shadow: 0 0 0 3px rgba(240,185,11,0.12); }
.ct-chat-input::placeholder { color: var(--muted-2, #69707C); }
.ct-chat-send {
  flex-shrink: 0; width: 42px; height: 42px; border-radius: 10px; border: none; cursor: pointer;
  background: var(--accent, #F0B90B); color: #0B0D10; display: grid; place-items: center;
  font-weight: 700;
}
.ct-chat-send:disabled { opacity: .45; cursor: not-allowed; }
.ct-chat-send:not(:disabled):hover { filter: brightness(1.08); }
.ct-chat-send svg { width: 18px; height: 18px; }

@media (max-width: 480px) {
  .ct-chat-root { right: 12px; bottom: 12px; }
  .ct-chat-panel { width: calc(100vw - 24px); height: min(70vh, calc(100vh - 90px)); bottom: 64px; }
  .ct-chat-fab { width: 50px; height: 50px; }
}
`;

function injectCss() {
  if (document.getElementById('ct-chat-css')) return;
  const style = document.createElement('style');
  style.id = 'ct-chat-css';
  style.textContent = CSS;
  document.head.appendChild(style);
}

function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c],
  );
}

const ICON_CHAT = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21 15a4 4 0 0 1-4 4H8l-5 3V7a4 4 0 0 1 4-4h10a4 4 0 0 1 4 4z"/></svg>`;
const ICON_X = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M18 6L6 18M6 6l12 12"/></svg>`;
const ICON_SEND = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M22 2L11 13"/><path d="M22 2l-7 20-4-9-9-4 20-7z"/></svg>`;

export function mountChatWidget() {
  if (document.querySelector('.ct-chat-root')) return;
  injectCss();

  const root = document.createElement('div');
  root.className = 'ct-chat-root';
  root.innerHTML = `
    <div class="ct-chat-panel" id="ct-chat-panel" hidden role="dialog" aria-label="CryptoTrix AI 助手">
      <div class="ct-chat-head">
        <div>
          <div class="ct-chat-title"><span class="dot" aria-hidden="true"></span>CryptoTrix AI</div>
          <div class="ct-chat-sub">公开看板助手 · #NFA</div>
        </div>
        <button type="button" class="ct-chat-close" aria-label="关闭">${ICON_X}</button>
      </div>
      <div class="ct-chat-msgs" id="ct-chat-msgs" aria-live="polite"></div>
      <form class="ct-chat-form" id="ct-chat-form">
        <textarea class="ct-chat-input" id="ct-chat-input" rows="1" placeholder="问问看板概念…（中文优先）" maxlength="2000" aria-label="消息输入"></textarea>
        <button type="submit" class="ct-chat-send" id="ct-chat-send" aria-label="发送">${ICON_SEND}</button>
      </form>
    </div>
    <button type="button" class="ct-chat-fab" id="ct-chat-fab" aria-expanded="false" aria-controls="ct-chat-panel" title="AI 助手">${ICON_CHAT}</button>
  `;
  document.body.appendChild(root);

  const panel = root.querySelector('#ct-chat-panel');
  const fab = root.querySelector('#ct-chat-fab');
  const closeBtn = root.querySelector('.ct-chat-close');
  const msgs = root.querySelector('#ct-chat-msgs');
  const form = root.querySelector('#ct-chat-form');
  const input = root.querySelector('#ct-chat-input');
  const sendBtn = root.querySelector('#ct-chat-send');

  /** @type {{role:string,content:string}[]} */
  const history = [];

  function addBubble(role, text, cls) {
    const div = document.createElement('div');
    div.className = `ct-chat-bubble ${cls || (role === 'user' ? 'user' : 'bot')}`;
    div.textContent = text;
    msgs.appendChild(div);
    msgs.scrollTop = msgs.scrollHeight;
    return div;
  }

  function setOpen(open) {
    panel.hidden = !open;
    fab.setAttribute('aria-expanded', open ? 'true' : 'false');
    fab.innerHTML = open ? ICON_X : ICON_CHAT;
    try {
      sessionStorage.setItem(STORAGE_KEY, open ? '1' : '0');
    } catch { /* ignore */ }
    if (open) {
      if (!msgs.childElementCount) {
        addBubble('assistant', '你好！我是 CryptoTrix 公开看板助手。可以问财富自由基金、期权、A股基金、全球资产、13F 等页面概念。不做个性化投顾 · #NFA', 'sys');
      }
      setTimeout(() => input.focus(), 50);
    }
  }

  fab.addEventListener('click', () => setOpen(panel.hidden));
  closeBtn.addEventListener('click', () => setOpen(false));

  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      form.requestSubmit();
    }
  });

  let busy = false;

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (busy) return;
    const text = input.value.trim();
    if (!text) return;

    input.value = '';
    addBubble('user', text);
    history.push({ role: 'user', content: text });
    while (history.length > MAX_HISTORY) history.shift();

    busy = true;
    sendBtn.disabled = true;
    const typing = document.createElement('div');
    typing.className = 'ct-chat-typing';
    typing.innerHTML = '<span></span><span></span><span></span>';
    typing.setAttribute('aria-label', '正在回复');
    msgs.appendChild(typing);
    msgs.scrollTop = msgs.scrollHeight;

    try {
      const r = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ messages: history }),
      });
      let data = null;
      try {
        data = await r.json();
      } catch { /* ignore */ }
      typing.remove();
      if (!r.ok) {
        const err = (data && (data.error || data.detail)) || `请求失败 (${r.status})`;
        addBubble('assistant', String(err), 'err');
      } else {
        const content = (data && data.content) || '';
        if (!content) {
          addBubble('assistant', '空回复，请稍后再试', 'err');
        } else {
          addBubble('assistant', content);
          history.push({ role: 'assistant', content });
          while (history.length > MAX_HISTORY) history.shift();
        }
      }
    } catch (err) {
      typing.remove();
      addBubble('assistant', '网络错误：' + (err && err.message ? err.message : '请稍后重试'), 'err');
    } finally {
      busy = false;
      sendBtn.disabled = false;
      input.focus();
    }
  });

  let preferOpen = false;
  try {
    preferOpen = sessionStorage.getItem(STORAGE_KEY) === '1';
  } catch { /* ignore */ }
  if (preferOpen) setOpen(true);
}

// Auto-mount when imported
if (typeof document !== 'undefined') {
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => mountChatWidget(), { once: true });
  } else {
    mountChatWidget();
  }
}
