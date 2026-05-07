import { auth, BASE } from '../api.js?v=20260428-presence-1';

const MAX_MSG_LEN = 1000;

function escapeHtml(s) {
  return String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;')
    .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

// 极简代码块：` ```...``` ` 渲染为 <pre><code>，其它纯文本 escape + 换行
function renderContent(text) {
  const parts = text.split(/```/);
  let html = '';
  parts.forEach((p, i) => {
    if (i % 2 === 1) {
      html += `<pre class="bk-chat-code"><code>${escapeHtml(p)}</code></pre>`;
    } else {
      html += escapeHtml(p).replace(/\n/g, '<br>');
    }
  });
  return html;
}

function fmtTime(iso) {
  const t = new Date(iso.replace(' ', 'T') + 'Z');
  return t.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' });
}

export async function renderChatPreview(host, opts = {}) {
  // opts.drawer  : 全局抽屉里渲染时为 true，禁用 hashchange 自动关闭
  // opts.onMessage(m) : 收到新消息（type='msg'）时回调，供外层做未读徽标
  // 返回 cleanup 函数（关闭 WS、移除监听）
  const onMessage = typeof opts.onMessage === 'function' ? opts.onMessage : null;

  // 获取当前用户信息
  const user = auth.user || {};

  host.innerHTML = `
    <div class="bk-card bk-dash-card bk-dash-chat-preview">
      <div class="bk-dash-card-header">
        <span class="bk-dash-card-label">备考广场</span>
        <div style="display:flex;align-items:center;gap:8px">
          <span class="small" style="color:var(--ink-2)">在线 <b data-online>—</b> 人</span>
          <button class="bk-btn bk-btn-sm" data-pin-edit style="display:none">设置公告</button>
        </div>
      </div>
      <div class="bk-chat-pin bk-dash-chat-pin" data-pin style="display:none"></div>
      <div class="bk-chat-msgs bk-dash-chat-msgs" data-msgs>
        <div class="small" style="text-align:center;padding:20px;color:var(--ink-3)">加载中…</div>
      </div>
      <form class="bk-chat-input" data-form>
        <textarea data-input rows="2" placeholder="按 Enter 发送，Shift+Enter 换行"
                  maxlength="${MAX_MSG_LEN}"></textarea>
        <button type="submit" class="bk-btn bk-btn-primary" data-send>发送</button>
      </form>
    </div>
  `;

  const msgsEl = host.querySelector('[data-msgs]');
  const pinEl = host.querySelector('[data-pin]');
  const onlineEl = host.querySelector('[data-online]');
  const formEl = host.querySelector('[data-form]');
  const inputEl = host.querySelector('[data-input]');
  const sendBtn = host.querySelector('[data-send]');
  const pinBtn = host.querySelector('[data-pin-edit]');

  if (user.is_admin) pinBtn.style.display = '';

  // 初始拉历史 + pin + online
  const headers = { Authorization: `Bearer ${auth.token}` };
  const [history, pin, online] = await Promise.all([
    fetch(`${BASE}/api/chat/messages?limit=50`, { headers }).then(r => r.json()),
    fetch(`${BASE}/api/chat/pin`, { headers }).then(r => r.json()),
    fetch(`${BASE}/api/presence/online`, { headers }).then(r => r.json()),
  ]);

  msgsEl.innerHTML = '';
  history.messages.forEach(appendMsg);
  scrollToBottom();
  renderPin(pin.pin);
  onlineEl.textContent = online.count || 0;

  // 打开 WS
  const token = encodeURIComponent(auth.token || '');
  const scheme = location.protocol === 'https:' ? 'wss' : 'ws';
  const ws = new WebSocket(`${scheme}://${location.host}${BASE}/ws/chat?token=${token}`);
  ws.addEventListener('message', (ev) => {
    let m; try { m = JSON.parse(ev.data); } catch { return; }
    if (m.type === 'msg') {
      appendMsg(m);
      scrollToBottom();
      if (onMessage) { try { onMessage(m); } catch {} }
    } else if (m.type === 'deleted') {
      const node = msgsEl.querySelector(`[data-mid="${m.id}"]`);
      if (node) node.remove();
    } else if (m.type === 'pin') {
      renderPin(m.content ? { content: m.content, created_by_name: m.created_by_name } : null);
    } else if (m.type === 'error') {
      alert(`聊天提示：${m.message}`);
    }
  });
  ws.addEventListener('close', () => {
    sendBtn.disabled = true;
    sendBtn.textContent = '已断开';
  });

  // 离开页面（hashchange）时关 WS，避免泄漏 —— 抽屉模式下由外层管理生命周期，不在此处关闭
  let onHashChange = null;
  if (!opts.drawer) {
    onHashChange = () => {
      try { ws.close(); } catch {}
      window.removeEventListener('hashchange', onHashChange);
    };
    window.addEventListener('hashchange', onHashChange);
  }

  // 发送
  formEl.addEventListener('submit', (e) => {
    e.preventDefault();
    sendOne();
  });
  inputEl.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      sendOne();
    }
  });
  function sendOne() {
    const v = inputEl.value.trim();
    if (!v) return;
    if (ws.readyState !== WebSocket.OPEN) return;
    ws.send(JSON.stringify({ type: 'send', content: v.slice(0, MAX_MSG_LEN) }));
    inputEl.value = '';
  }

  // 删除（事件代理）
  msgsEl.addEventListener('click', async (e) => {
    const btn = e.target.closest('[data-del-mid]');
    if (!btn) return;
    if (!confirm('删除这条消息？')) return;
    const mid = btn.getAttribute('data-del-mid');
    await fetch(`${BASE}/api/chat/messages/${mid}`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${auth.token}` },
    });
  });

  // 公告编辑（admin）
  pinBtn.addEventListener('click', async () => {
    const cur = pinEl.dataset.content || '';
    const next = prompt('公告内容（清空并确定 = 撤销公告）', cur);
    if (next === null) return;
    if (next.trim() === '') {
      await fetch(`${BASE}/api/chat/pin`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${auth.token}` },
      });
    } else {
      await fetch(`${BASE}/api/chat/pin`, {
        method: 'PUT',
        headers: {
          Authorization: `Bearer ${auth.token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ content: next.trim() }),
      });
    }
  });

  function renderPin(pin) {
    if (!pin) { pinEl.style.display = 'none'; pinEl.dataset.content = ''; return; }
    pinEl.style.display = '';
    pinEl.dataset.content = pin.content;
    pinEl.innerHTML = `${escapeHtml(pin.content)}
      <span class="small" style="color:var(--ink-3);margin-left:8px">— ${escapeHtml(pin.created_by_name || '')}</span>`;
  }

  function appendMsg(m) {
    const el = document.createElement('div');
    el.className = 'bk-chat-msg';
    el.setAttribute('data-mid', m.id);
    const canDelete = user.is_admin || m.user_id === user.id;
    el.innerHTML = `
      <div class="bk-chat-meta">
        <b>${escapeHtml(m.name)}</b>
        <span class="small" style="color:var(--ink-3)">${fmtTime(m.created_at)}</span>
        ${canDelete && !m.deleted ? `<button class="bk-chat-del" data-del-mid="${m.id}" title="删除">×</button>` : ''}
      </div>
      <div class="bk-chat-body">${m.deleted
        ? '<i class="small" style="color:var(--ink-3)">该消息已删除</i>'
        : renderContent(m.content)}</div>
    `;
    msgsEl.appendChild(el);
  }

  function scrollToBottom() {
    msgsEl.scrollTop = msgsEl.scrollHeight;
  }

  // 返回 cleanup：抽屉模式下登出/重新挂载时调用
  return () => {
    try { ws.close(); } catch {}
    if (onHashChange) {
      window.removeEventListener('hashchange', onHashChange);
    }
  };
}
