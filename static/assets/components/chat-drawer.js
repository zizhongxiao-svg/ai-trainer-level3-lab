import { renderChatPreview } from './chat-preview.js?v=20260428-presence-1';

const PIN_KEY = 'bk_chat_drawer_pinned';
const CLOSE_DELAY_MS = 220;

export function mountChatDrawer(host) {
  let pinned = localStorage.getItem(PIN_KEY) === '1';
  let isOpen = pinned;
  let unread = 0;
  let chatCleanup = null;
  let hoverTimer = null;
  let pointerInside = false;
  let focusInside = false;

  host.innerHTML = `
    <div class="bk-chat-drawer ${pinned ? 'is-open is-pinned' : ''}" data-drawer>
      <aside class="bk-chat-drawer-panel" data-panel>
        <button class="bk-chat-drawer-handle" type="button" data-handle title="备考广场">
          <span class="bk-chat-drawer-handle-icon"><svg class="ic"><use href="#i-chat"/></svg></span>
          <span class="bk-chat-drawer-handle-text">备考广场</span>
          <span class="bk-chat-drawer-unread" data-unread style="display:none">0</span>
        </button>
        <div class="bk-chat-drawer-toolbar">
          <button class="bk-chat-drawer-pin ${pinned ? 'on' : ''}" type="button"
                  data-pin title="${pinned ? '取消钉住' : '钉住面板'}"><svg class="ic ic-sm"><use href="#i-pin"/></svg></button>
        </div>
        <div class="bk-chat-drawer-body" data-body></div>
      </aside>
    </div>
  `;

  const root = host.querySelector('[data-drawer]');
  const handleEl = host.querySelector('[data-handle]');
  const pinBtn = host.querySelector('[data-pin]');
  const unreadEl = host.querySelector('[data-unread]');
  const body = host.querySelector('[data-body]');

  function setOpen(v) {
    isOpen = v || pinned;
    root.classList.toggle('is-open', isOpen);
    if (isOpen) clearUnread();
  }
  function setPinned(v) {
    pinned = v;
    localStorage.setItem(PIN_KEY, v ? '1' : '0');
    pinBtn.classList.toggle('on', v);
    pinBtn.title = v ? '取消钉住' : '钉住面板';
    setOpen(v ? true : isOpen);
    root.classList.toggle('is-pinned', v);
  }
  function clearUnread() {
    unread = 0;
    unreadEl.style.display = 'none';
  }
  function bumpUnread() {
    unread += 1;
    unreadEl.textContent = unread > 99 ? '99+' : unread;
    unreadEl.style.display = '';
  }

  function cancelClose() { if (hoverTimer) { clearTimeout(hoverTimer); hoverTimer = null; } }
  function shouldStayOpen() {
    return pinned || pointerInside || focusInside;
  }
  function scheduleClose() {
    cancelClose();
    if (shouldStayOpen()) return;
    hoverTimer = setTimeout(() => {
      if (!shouldStayOpen()) setOpen(false);
    }, CLOSE_DELAY_MS);
  }

  // 鼠标进入（拉手或面板）→ 展开；离开 → 延时收起。
  // 输入框/按钮仍有焦点时保持展开，避免用户打字时抽屉缩回去。
  root.addEventListener('mouseenter', () => {
    pointerInside = true;
    cancelClose();
    setOpen(true);
  });
  root.addEventListener('mouseleave', () => {
    pointerInside = false;
    scheduleClose();
  });
  root.addEventListener('focusin', () => {
    focusInside = true;
    cancelClose();
    setOpen(true);
  });
  root.addEventListener('focusout', () => {
    setTimeout(() => {
      focusInside = root.contains(document.activeElement);
      if (!focusInside) scheduleClose();
    }, 0);
  });

  // 触屏 / 点击拉手也能打开
  handleEl.addEventListener('click', (e) => {
    e.stopPropagation();
    setOpen(!isOpen);
  });

  pinBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    setPinned(!pinned);
  });

  // 渲染聊天主体（抽屉模式：WS 不随路由跳转关闭）
  Promise.resolve(renderChatPreview(body, {
    drawer: true,
    onMessage: () => { if (!isOpen) bumpUnread(); },
  })).then((cleanup) => { chatCleanup = cleanup; });

  return () => {
    cancelClose();
    if (chatCleanup) { try { chatCleanup(); } catch {} }
    host.innerHTML = '';
  };
}
