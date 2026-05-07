import { API } from '../api.js';

export async function renderFeedback(host, ctx) {
  const isAdmin = !!(ctx.user && ctx.user.is_admin);
  host.innerHTML = '<p class="label" style="padding:24px 0">加载中…</p>';
  try {
    if (isAdmin) await renderAdminView(host, ctx);
    else         await renderUserView(host, ctx);
    // Notify nav badge to refresh after we (likely) read some threads.
    window.dispatchEvent(new CustomEvent('feedback-unread-refresh'));
  } catch (e) {
    host.innerHTML = `<div class="bk-card" style="color:var(--err)">${escapeHtml(e.message)}</div>`;
  }
}

// ── User view ─────────────────────────────────────────────────────────────
async function renderUserView(host, ctx) {
  const data = await API.feedbackList();
  host.innerHTML = `
    <div style="max-width:760px;margin:0 auto">
      <h2 style="margin:0 0 6px">意见反馈</h2>
      <p class="small" style="margin:0 0 18px">大家提交的反馈和回复都会显示在这里。</p>

      <div class="bk-card" style="margin-bottom:18px">
        <textarea id="fb-content" class="bk-input" rows="5"
                  placeholder="写点啥吧…（最多 2000 字）"
                  style="resize:vertical;width:100%;box-sizing:border-box"></textarea>
        <div style="display:flex;justify-content:space-between;align-items:center;margin-top:10px">
          <span class="small" id="fb-count">0 / 2000</span>
          <button class="bk-btn bk-btn-primary bk-btn-sm" id="fb-submit">提交</button>
        </div>
      </div>

      <div class="label" style="margin-bottom:10px">反馈频道（${data.rows.length}）</div>
      <div id="fb-list">${data.rows.map(r => renderThreadCard(r, false)).join('') ||
        '<div class="bk-card"><p class="small" style="margin:0">还没提交过反馈</p></div>'}</div>
    </div>
  `;

  const ta = host.querySelector('#fb-content');
  const cnt = host.querySelector('#fb-count');
  const btn = host.querySelector('#fb-submit');
  ta.addEventListener('input', () => { cnt.textContent = `${ta.value.length} / 2000`; });
  btn.addEventListener('click', async () => {
    const text = ta.value.trim();
    if (!text) { alert('内容不能为空'); return; }
    if (text.length > 2000) { alert('不能超过 2000 字'); return; }
    btn.disabled = true;
    try {
      await API.feedbackSubmit(text);
      ta.value = ''; cnt.textContent = '0 / 2000';
      await renderUserView(host, ctx);
    } catch (e) {
      alert('提交失败：' + e.message);
    } finally { btn.disabled = false; }
  });

  bindThreadCards(host, ctx, false, () => renderUserView(host, ctx));
}

// ── Admin view ────────────────────────────────────────────────────────────
async function renderAdminView(host, ctx) {
  const data = await API.feedbackAll();
  host.innerHTML = `
    <div style="max-width:980px;margin:0 auto">
      <div style="display:flex;justify-content:space-between;align-items:baseline;margin-bottom:18px;gap:12px;flex-wrap:wrap">
        <h2 style="margin:0">反馈（管理员视图）</h2>
        <div class="small">
          未读 <b style="color:${data.unread>0?'var(--err)':'var(--ink-3)'}">${data.unread}</b>
          · 已处理 <b>${data.resolved}</b> / 共 ${data.total}
        </div>
      </div>
      <div id="fb-list">${data.rows.map(r => renderThreadCard(r, true)).join('') ||
        '<div class="bk-card"><p class="small" style="margin:0">还没有反馈</p></div>'}</div>
    </div>
  `;
  bindThreadCards(host, ctx, true, () => renderAdminView(host, ctx));
}

// ── Thread card (collapsed) ───────────────────────────────────────────────
function renderThreadCard(r, isAdmin) {
  const unread = !!r.unread;
  const resolved = !!r.is_resolved;
  const who = r.display_name || r.username || (r.user_id ? `用户#${r.user_id}` : '我');
  const lastTime = r.last_msg_at || r.created_at;
  const lastRoleTxt = r.last_msg_role === 'admin' ? '管理员' : '用户';
  const accent = resolved
    ? 'border-left:3px solid var(--ok,#3b9c4f);padding-left:13px;'
    : (unread ? 'border-left:3px solid var(--err);padding-left:13px;' : '');

  return `
    <div class="bk-card fb-card" data-fid="${r.id}" style="margin-bottom:10px;${accent}">
      <div class="fb-card-hd" style="display:flex;justify-content:space-between;align-items:baseline;gap:10px;cursor:pointer">
        <div style="min-width:0;flex:1">
          <b>${escapeHtml(who)}</b>
          <span class="small" style="color:var(--ink-3);margin-left:8px">最后更新 ${escapeHtml(lastTime)} · ${lastRoleTxt}</span>
          ${unread ? '<span class="small" style="color:var(--err);margin-left:8px">●新</span>' : ''}
          ${resolved ? '<span class="small" style="color:var(--ok,#3b9c4f);margin-left:8px">已处理</span>' : ''}
          <div class="small" style="color:var(--ink-2);margin-top:6px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${escapeHtml(r.content)}</div>
        </div>
        <button class="bk-btn bk-btn-ghost bk-btn-sm fb-toggle" type="button">展开</button>
      </div>
      <div class="fb-card-body" style="display:none;margin-top:12px"></div>
    </div>
  `;
}

function bindThreadCards(host, ctx, isAdmin, rerender) {
  host.querySelectorAll('.fb-card').forEach(card => {
    const fid = Number(card.dataset.fid);
    const hd = card.querySelector('.fb-card-hd');
    const body = card.querySelector('.fb-card-body');
    const toggle = card.querySelector('.fb-toggle');
    hd.addEventListener('click', async (e) => {
      if (e.target.closest('button') && e.target !== toggle) return;
      if (body.style.display === 'block') {
        body.style.display = 'none';
        toggle.textContent = '展开';
        return;
      }
      body.style.display = 'block';
      toggle.textContent = '收起';
      body.innerHTML = '<p class="small" style="color:var(--ink-3)">加载中…</p>';
      try {
        const data = await API.feedbackThread(fid);
        renderThreadBody(body, data, ctx, isAdmin, rerender);
      } catch (err) {
        body.innerHTML = `<div class="small" style="color:var(--err)">${escapeHtml(err.message)}</div>`;
      }
    });
  });
}

// ── Thread body (expanded) ────────────────────────────────────────────────
function renderThreadBody(body, data, ctx, isAdmin, rerender) {
  const f = data.feedback;
  const canReply = isAdmin || f.user_id === ctx.user?.id;
  const allMsgs = [
    { sender_role: 'user', content: f.content, created_at: f.created_at,
      display_name: f.display_name, username: f.username, sender_id: f.user_id },
    ...data.messages,
  ];
  const adminTools = isAdmin ? `
    <div style="display:flex;gap:6px;flex-wrap:wrap;margin-bottom:10px">
      <button class="bk-btn bk-btn-ghost bk-btn-sm" data-resolve="${f.is_resolved?0:1}">
        ${f.is_resolved ? '取消已处理' : '标记为已处理'}
      </button>
      <button class="bk-btn bk-btn-ghost bk-btn-sm" style="color:var(--err)" data-del>删除</button>
    </div>
  ` : '';

  body.innerHTML = `
    ${adminTools}
    <div class="fb-msgs" style="display:flex;flex-direction:column;gap:8px;max-height:420px;overflow:auto;padding:6px;background:var(--surface-2,#fafafa);border-radius:8px">
      ${allMsgs.map(m => renderMsg(m)).join('')}
    </div>
    ${canReply ? `<div style="margin-top:10px">
      <textarea class="bk-input fb-reply" rows="3" placeholder="${isAdmin?'回复用户…':'继续追加…'}（最多 2000 字）"
                style="resize:vertical;width:100%;box-sizing:border-box"></textarea>
      <div style="display:flex;justify-content:flex-end;margin-top:8px">
        <button class="bk-btn bk-btn-primary bk-btn-sm fb-send">发送</button>
      </div>
    </div>` : ''}
  `;

  const ta = body.querySelector('.fb-reply');
  body.querySelector('.fb-send')?.addEventListener('click', async (ev) => {
    const text = ta.value.trim();
    if (!text) { alert('内容不能为空'); return; }
    if (text.length > 2000) { alert('不能超过 2000 字'); return; }
    ev.target.disabled = true;
    try {
      await API.feedbackReply(f.id, text);
      await rerender();
    } catch (e) { alert('发送失败：' + e.message); ev.target.disabled = false; }
  });

  if (isAdmin) {
    const resolveBtn = body.querySelector('[data-resolve]');
    resolveBtn?.addEventListener('click', async () => {
      const to = resolveBtn.dataset.resolve === '1';
      resolveBtn.disabled = true;
      try { await API.feedbackToggleResolved(f.id, to); await rerender(); }
      catch (e) { alert('操作失败：' + e.message); resolveBtn.disabled = false; }
    });
    body.querySelector('[data-del]')?.addEventListener('click', async () => {
      if (!confirm('确认删除整个反馈会话？此操作不可撤销。')) return;
      try { await API.feedbackDelete(f.id); await rerender(); }
      catch (e) { alert('删除失败：' + e.message); }
    });
  }
}

function renderMsg(m) {
  const isAdmin = m.sender_role === 'admin';
  const who = isAdmin
    ? `管理员 ${m.display_name || m.username || ''}`.trim()
    : (m.display_name || m.username || '用户');
  const align = isAdmin ? 'flex-end' : 'flex-start';
  const bg = isAdmin ? 'var(--brand-soft,#e6f0ff)' : '#fff';
  const border = isAdmin ? '1px solid var(--brand,#3b6cf6)' : '1px solid var(--ink-5,#e5e5e5)';
  return `
    <div style="display:flex;justify-content:${align}">
      <div style="max-width:78%;background:${bg};border:${border};border-radius:10px;padding:8px 12px">
        <div class="small" style="color:var(--ink-3);margin-bottom:4px">
          <b style="color:${isAdmin?'var(--brand,#3b6cf6)':'var(--ink-1)'}">${escapeHtml(who)}</b>
          <span style="margin-left:8px">${escapeHtml(m.created_at)}</span>
        </div>
        <div style="white-space:pre-wrap;word-break:break-word">${escapeHtml(m.content)}</div>
      </div>
    </div>
  `;
}

function escapeHtml(s) {
  return String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;')
    .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
