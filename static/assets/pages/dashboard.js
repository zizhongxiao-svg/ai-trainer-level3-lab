import { API, auth } from '../api.js';
import { copyText } from './classes.js';

// ── helpers ────────────────────────────────────────────────────────
const RING_C = 263.9; // 2π * 42

function ic(id, cls = 'ic', style = '') {
  return `<svg class="${cls}"${style ? ` style="${style}"` : ''}><use href="#${id}"/></svg>`;
}

function ringSvg(pct) {
  const off = Math.max(0, RING_C - RING_C * (pct / 100));
  return `
    <svg class="r" viewBox="0 0 100 100">
      <circle class="track" cx="50" cy="50" r="42"></circle>
      <circle class="fill" cx="50" cy="50" r="42"
              stroke-dasharray="${RING_C.toFixed(1)}"
              stroke-dashoffset="${off.toFixed(1)}"></circle>
    </svg>`;
}

function groupForClass(id) {
  if (!id) return null;
  if (id <= 4) return '1-4班';
  if (id <= 8) return '5-8班';
  return '9-11班';
}

function parseSessionDate(s, year) {
  const m = /(\d+)月(\d+)日/.exec(s.date || '');
  if (!m) return null;
  return new Date(year, +m[1] - 1, +m[2]);
}

function deadlineInfo(classesPayload, classId) {
  const grp = groupForClass(classId);
  if (!grp) return null;
  const sched = (classesPayload.schedules || []).find(s => s.group === grp);
  if (!sched || !sched.sessions?.length) return null;
  const last = sched.sessions[sched.sessions.length - 1];
  const lastDate = parseSessionDate(last, new Date().getFullYear());
  if (!lastDate) return null;
  const today = new Date(); today.setHours(0,0,0,0);
  const days = Math.ceil((lastDate - today) / 86400000);
  return { total: sched.sessions.length, lastNo: last.no, days };
}

// ── main render ────────────────────────────────────────────────────
export async function renderDashboard(host, ctx) {
  host.innerHTML = '<p class="label" style="padding:24px 0">加载中…</p>';
  let data, classesPayload;
  try {
    const [dash, cls] = await Promise.all([
      API.dashboard(),
      API.classes().catch(() => ({})),
    ]);
    data = dash;
    classesPayload = cls || {};
  } catch (e) {
    host.innerHTML = `<div class="bk-card" style="color:var(--err)">${e.message}</div>`;
    return;
  }

  const {
    next_kp, weakest_sections, recent_wrong_count,
    recent_exam, recent_ops_exam,
    ops_progress, theory_progress, class_id, next_session,
  } = data;

  const recordings = (classesPayload.recordings || [])
    .slice()
    .sort((a, b) => (b.recorded_at || '').localeCompare(a.recorded_at || ''))
    .slice(0, 5);
  const classList = classesPayload.classes || [];
  const myClass = classList.find(c => c.id === class_id);
  const userName = ctx.user.display_name || '同学';

  const ops = ops_progress || { total: 0, submitted: 0, draft: null };
  const opsPct = ops.total ? Math.round(ops.submitted / ops.total * 100) : 0;
  const opsAllDone = ops.total > 0 && ops.submitted >= ops.total;

  const theory = theory_progress || { total: 0, attempted: 0, mastered: 0 };
  const theoryPct = theory.total ? Math.round(theory.attempted / theory.total * 100) : 0;
  const masteredPct = theory.total ? Math.round(theory.mastered / theory.total * 100) : 0;

  const topWeak = (weakest_sections || []).filter(s => s.correct_rate < 75).slice(0, 2);
  const dl = deadlineInfo(classesPayload, class_id);

  // ── state for each node ──
  const theoryState = theory.attempted === 0 ? '' :
    (theory.mastered >= theory.total && theory.total > 0) ? 'done' : 'active';
  const opsState = ops.submitted === 0 && !ops.draft ? '' :
    opsAllDone ? 'done' : 'active';
  const examFailing =
    (recent_exam && recent_exam.score < 60) ||
    (recent_ops_exam && (recent_ops_exam.score_pct || 0) < 60);
  const examState = (!recent_exam && !recent_ops_exam) ? 'warn' :
    examFailing ? 'warn' : 'done';

  host.innerHTML = `
    <div class="bk-dash">
      ${renderTop(userName, myClass, next_session, dl)}
      <main class="t-stage">
        <div class="t-stage-hd">
          <h3>${ic('i-route', 'ic ic-sm')}备考主线</h3>
          <span class="sub">理论打基础 → 实操练手感 → 模拟考查漏</span>
        </div>
        <div class="t-track">
          ${renderTheoryNode(theory, theoryState, theoryPct, masteredPct, recent_wrong_count, next_kp, topWeak)}
          ${renderOpsNode(ops, opsState, opsPct)}
          ${renderExamNode(examState, recent_exam, recent_ops_exam)}
        </div>
      </main>
      ${renderReplayStrip(recordings)}
    </div>
  `;

  bind(host, ctx, classList, class_id);

  if (!class_id && classList.length) {
    openClassPicker(classList, null, () => renderDashboard(host, ctx), ctx, /*forced*/ true);
  }
}

// ── 顶栏 ──────────────────────────────────────────────────────────
function renderTop(userName, myClass, sess, dl) {
  const classBlock = myClass
    ? `<button class="t-top-class" data-edit-class title="点击修改班级">
         ${ic('i-grad', 'ic ic-sm')}
         ${escapeHtml(myClass.name)} · 班主任 ${escapeHtml(myClass.teacher || '')}
       </button>`
    : `<button class="t-top-class warn" data-edit-class>
         ${ic('i-pin', 'ic ic-sm')} 补充班级信息
       </button>`;

  let nextBlock = '';
  let livePill = '';
  if (myClass && sess) {
    const dateLabel = `${escapeHtml(sess.date || '')} ${escapeHtml(sess.weekday || '')} ${escapeHtml(sess.time || '')}`;
    nextBlock = `
      <span class="t-top-divider"></span>
      <span class="t-top-next">
        ${ic('i-cal', 'ic ic-sm')}
        <b>${dateLabel}</b> · ${escapeHtml(sess.topic || '')}
        ${sess.location ? `${ic('i-pin', 'ic ic-sm', 'color:var(--ink-3)')}<span class="loc">${escapeHtml(sess.location)}</span>` : ''}
      </span>
    `;
    if (sess.is_ongoing) livePill = `<span class="t-pill t-pill-live">直播中</span>`;
    else if (sess.is_today) livePill = `<span class="t-pill t-pill-live">今天</span>`;
  }

  const dlBlock = dl ? `
    <span class="t-top-deadline">
      ${ic('i-flag', 'ic ic-sm')}
      距结业课（第${dl.lastNo}课/共${dl.total}课）还有 <b>${dl.days >= 0 ? `${dl.days} 天` : '已结业'}</b>
    </span>
  ` : '';

  const liveBtn = (myClass && sess && (sess.is_today || sess.is_ongoing))
    ? `<button class="t-btn sm primary" data-goto="#/classes">${ic('i-play', 'ic ic-sm')}进入直播间</button>`
    : '';

  return `
    <header class="t-top">
      <span class="t-top-greet">你好，${escapeHtml(userName)}</span>
      ${classBlock}
      ${nextBlock}
      ${livePill}
      <div class="t-top-spacer"></div>
      ${dlBlock}
      <button class="t-btn sm" data-goto="#/classes">${ic('i-list', 'ic ic-sm')}完整课表</button>
      ${liveBtn}
    </header>
  `;
}

// ── 站 1 ─ 理论 ───────────────────────────────────────────────────
function renderTheoryNode(theory, state, pct, masteredPct, wrong, nextKp, topWeak) {
  const tagText = state === 'done' ? '已完成' : state === 'active' ? '进行中' : '未开始';
  const ringKind = state === 'done' ? 'ok' : '';
  const headInner = state === ''
    ? ic('i-book', 'ic ic-xl')
    : `<div class="ring ${ringKind}">${ringSvg(pct)}<div class="ring-c"><b>${pct}%</b><span>${state === 'done' ? '掌握' : '已学'}</span></div></div>`;

  return `
    <div class="t-node ${state}">
      <div class="t-node-head">
        ${headInner}
        <span class="badge">1</span>
      </div>
      <div class="t-node-card">
        <div class="t-node-card-hd">
          <span class="t-node-name">${ic('i-book', 'ic', 'color:var(--accent)')}理论备考</span>
          <div style="display:flex;gap:4px;align-items:center">
            <span class="t-node-tag">${tagText}</span>
            <button class="t-btn ghost-ic" data-reset-theory-all title="清空所有理论作答记录">
              ${ic('i-refresh', 'ic ic-sm')}
            </button>
          </div>
        </div>
        <div class="t-node-stat">
          <div class="t-node-num">${theory.attempted}<small> / ${theory.total}</small></div>
        </div>
        <div class="t-bar ${ringKind}"><span style="width:${pct}%"></span></div>
        <div class="t-node-meta">已掌握 <b class="ok">${theory.mastered}（${masteredPct}%）</b> · 错题 <b class="${wrong > 0 ? 'err' : 'ok'}">${wrong}</b></div>
        ${nextKp ? `
          <div class="t-node-detail">
            <span class="label">下一个知识点</span>
            <span class="name" title="${escapeHtml(nextKp.section_title)} · ${escapeHtml(nextKp.title)}">${escapeHtml(nextKp.section_title)} · ${escapeHtml(nextKp.title)}</span>
            <span class="extra">${nextKp.mastered} / ${nextKp.total} 已掌握</span>
          </div>` : `
          <div class="t-node-detail">
            <span class="label">下一个知识点</span>
            <span class="name" style="color:var(--ok)">所有知识点已学完</span>
          </div>`}
        ${topWeak.length ? `
          <div class="t-chips">
            ${topWeak.map(s => `
              <button class="t-chip" data-section="${s.id}" title="正确率 ${s.correct_rate}%">
                ${ic('i-alert', 'ic ic-sm')}
                ${escapeHtml(s.title)} <b>${s.correct_rate}%</b>
              </button>
            `).join('')}
          </div>` : ''}
        ${renderTheoryFocus(theory, wrong, nextKp, topWeak)}
        <div class="t-node-cta">
          <button class="t-btn sm accent" ${nextKp ? `data-kp="${nextKp.id}"` : 'data-goto="#/theory"'}>
            ${nextKp ? '继续学习' : '进入题库'} ${ic('i-arrow-r', 'ic ic-sm')}
          </button>
          <button class="t-btn sm" data-goto="#/theory?only=wrong">看错题</button>
        </div>
      </div>
    </div>
  `;
}

function renderTheoryFocus(theory, wrong, nextKp, topWeak) {
  const remaining = Math.max(0, (theory.total || 0) - (theory.attempted || 0));
  let title = '今日建议';
  let rows = [];

  if (topWeak.length) {
    title = '今日补强';
    rows = topWeak.map(s => ({
      icon: 'i-alert',
      main: s.title,
      sub: `正确率 ${s.correct_rate}%`,
      attr: `data-section="${s.id}"`,
      tone: 'warn',
    }));
  } else if (nextKp) {
    rows = [{
      icon: 'i-route',
      main: nextKp.title,
      sub: remaining ? `剩余 ${remaining} 题未练` : `${nextKp.mastered} / ${nextKp.total} 已掌握`,
      attr: `data-kp="${nextKp.id}"`,
      tone: '',
    }];
  } else if (wrong > 0) {
    rows = [{
      icon: 'i-refresh',
      main: '错题复盘',
      sub: `还有 ${wrong} 道错题可回看`,
      attr: 'data-goto="#/theory?only=wrong"',
      tone: 'warn',
    }];
  } else {
    rows = [{
      icon: 'i-check',
      main: '保持手感',
      sub: '题库已覆盖，可二刷或模拟考',
      attr: 'data-goto="#/theory"',
      tone: 'ok',
    }];
  }

  return `
    <div class="t-focus">
      <div class="t-focus-hd">${title}</div>
      ${rows.map(r => `
        <button class="t-focus-row ${r.tone}" ${r.attr} title="${escapeHtml(r.main)}">
          ${ic(r.icon, 'ic ic-sm')}
          <span class="main">${escapeHtml(r.main)}</span>
          <span class="sub">${escapeHtml(r.sub)}</span>
        </button>
      `).join('')}
    </div>
  `;
}

// ── 站 2 ─ 实操 ───────────────────────────────────────────────────
function renderOpsNode(ops, state, pct) {
  const tagText = state === 'done' ? '已完成' : state === 'active' ? '本周聚焦' : '未开始';
  const ringKind = state === 'done' ? 'ok' : '';
  const headInner = state === ''
    ? ic('i-wrench', 'ic ic-xl')
    : `<div class="ring ${ringKind}">${ringSvg(pct)}<div class="ring-c"><b>${pct}%</b><span>完成</span></div></div>`;

  const draftMeta = ops.draft
    ? `<span class="warn">${ic('i-edit', 'ic ic-sm', 'vertical-align:-2px')} 1 个草稿待续</span>`
    : '';

  return `
    <div class="t-node ${state}">
      <div class="t-node-head">
        ${headInner}
        <span class="badge">2</span>
      </div>
      <div class="t-node-card">
        <div class="t-node-card-hd">
          <span class="t-node-name">${ic('i-wrench', 'ic', 'color:var(--accent)')}实操备考</span>
          <div style="display:flex;gap:4px;align-items:center">
            <span class="t-node-tag">${tagText}</span>
            <button class="t-btn ghost-ic" data-reset-ops-all title="清空所有实操记录与草稿">
              ${ic('i-refresh', 'ic ic-sm')}
            </button>
          </div>
        </div>
        <div class="t-node-stat">
          <div class="t-node-num">${ops.submitted}<small> / ${ops.total}</small></div>
        </div>
        <div class="t-bar ${ringKind}"><span style="width:${pct}%"></span></div>
        <div class="t-node-meta">已提交 <b>${ops.submitted} 道</b>${draftMeta ? ' · ' + draftMeta : ''}</div>
        ${ops.draft ? `
          <div class="t-node-detail clickable" data-goto="#/ops/${ops.draft.operation_id}" title="继续：${escapeHtml(ops.draft.title)}">
            <span class="label">未提交草稿</span>
            <span class="name">${escapeHtml(ops.draft.title)}</span>
            <span class="extra">${formatRelative(ops.draft.last_active_at)}</span>
          </div>` : `
          <div class="t-node-detail">
            <span class="label">下一步</span>
            <span class="name" style="color:${state === 'done' ? 'var(--ok)' : 'var(--ink-1)'}">
              ${state === 'done' ? '全部已提交' : '继续刷剩下的操作题'}
            </span>
          </div>`}
        ${renderOpsFocus(ops, state, pct)}
        <div class="t-node-cta">
          <button class="t-btn sm accent" data-goto="${ops.draft ? `#/ops/${ops.draft.operation_id}` : '#/ops'}">
            ${ops.draft ? '继续草稿' : (state === 'done' ? '查看全部' : '去练习')}
            ${ic('i-arrow-r', 'ic ic-sm')}
          </button>
          <button class="t-btn sm" data-goto="#/ops">题库</button>
        </div>
      </div>
    </div>
  `;
}

function renderOpsFocus(ops, state, pct) {
  const total = ops.total || 0;
  const submitted = ops.submitted || 0;
  const remaining = Math.max(0, total - submitted);
  const rows = [
    {
      icon: 'i-trend-up',
      main: '练习节奏',
      sub: total ? `完成 ${pct}% · 剩余 ${remaining} 道` : '暂无实操题',
      attr: 'data-goto="#/ops"',
      tone: state === 'done' ? 'ok' : '',
    },
  ];

  if (ops.draft) {
    rows.push({
      icon: 'i-edit',
      main: ops.draft.title || '未提交草稿',
      sub: formatRelative(ops.draft.last_active_at) || '草稿待续',
      attr: `data-goto="#/ops/${ops.draft.operation_id}"`,
      tone: 'warn',
    });
  } else {
    rows.push({
      icon: state === 'done' ? 'i-check' : 'i-wrench',
      main: state === 'done' ? '复盘已提交题' : '下一题从题库开始',
      sub: state === 'done' ? '可查看全部记录' : '建议先完成 1 道实操',
      attr: 'data-goto="#/ops"',
      tone: state === 'done' ? 'ok' : '',
    });
  }

  return `
    <div class="t-focus">
      <div class="t-focus-hd">实操看板</div>
      ${rows.map(r => `
        <button class="t-focus-row ${r.tone}" ${r.attr} title="${escapeHtml(r.main)}">
          ${ic(r.icon, 'ic ic-sm')}
          <span class="main">${escapeHtml(r.main)}</span>
          <span class="sub">${escapeHtml(r.sub)}</span>
        </button>
      `).join('')}
    </div>
  `;
}

// ── 站 3 ─ 模拟考（双卷） ─────────────────────────────────────────
function renderExamNode(state, recentTheory, recentOps) {
  const tagText = state === 'warn' ? '查漏' : state === 'done' ? '已通过' : '未开始';

  return `
    <div class="t-node ${state}">
      <div class="t-node-head">
        ${ic('i-target', 'ic ic-xl')}
        <span class="badge">3</span>
      </div>
      <div class="t-node-card">
        <div class="t-node-card-hd">
          <span class="t-node-name">${ic('i-target', 'ic', 'color:var(--warn)')}模拟考试</span>
          <span class="t-node-tag">${tagText}</span>
        </div>
        <div class="t-exam-split">
          ${renderExamSub('理论卷', 'i-book', recentTheory, {
            histHash: '#/exam/history?type=theory',
            startHash: '#/exam',
            resetAttr: 'data-reset-exams-theory',
            scoreFmt: r => `${r.score}<small> 分</small>`,
            passing: r => r.score >= 60,
          })}
          ${renderExamSub('实操卷', 'i-wrench', recentOps, {
            histHash: '#/exam/history?type=ops',
            startHash: '#/exam-ops',
            resetAttr: 'data-reset-exams-ops',
            scoreFmt: r => `${(r.score_pct ?? 0).toFixed(0)}<small>%</small>`,
            passing: r => (r.score_pct ?? 0) >= 60,
          })}
        </div>
      </div>
    </div>
  `;
}

function renderExamSub(name, iconId, rec, opt) {
  if (!rec) {
    return `
      <div class="t-exam-sub">
        <div class="t-exam-sub-hd">
          <span class="t-exam-sub-name">${ic(iconId, 'ic ic-sm', 'color:var(--accent)')}${name}</span>
          <button class="t-btn ghost-ic" ${opt.resetAttr} title="清空${name}模拟考历史">
            ${ic('i-refresh', 'ic ic-sm')}
          </button>
        </div>
        <div class="t-exam-sub-stat">
          <span class="t-exam-sub-num" style="color:var(--ink-3)">—</span>
          <span class="t-exam-sub-meta">还没考过</span>
        </div>
        <div class="t-exam-sub-cta">
          <button class="t-btn xs accent" data-goto="${opt.startHash}">开始考试</button>
          <button class="t-btn xs" disabled>历史</button>
        </div>
      </div>
    `;
  }
  const pass = opt.passing(rec);
  const scoreColor = pass ? 'var(--ok)' : 'var(--warn)';
  const dateStr = ((rec.start_time || rec.submitted_at || '') + '').slice(0, 10);
  return `
    <div class="t-exam-sub">
      <div class="t-exam-sub-hd">
        <span class="t-exam-sub-name">${ic(iconId, 'ic ic-sm', 'color:var(--accent)')}${name}</span>
        <button class="t-btn ghost-ic" ${opt.resetAttr} title="清空${name}模拟考历史">
          ${ic('i-refresh', 'ic ic-sm')}
        </button>
      </div>
      <div class="t-exam-sub-stat">
        <span class="t-exam-sub-num" style="color:${scoreColor}">${opt.scoreFmt(rec)}</span>
        <span class="t-exam-sub-meta">${escapeHtml(dateStr)} · ${pass ? '<span style="color:var(--ok)">已通过</span>' : '未及格'}</span>
      </div>
      <div class="t-exam-sub-cta">
        <button class="t-btn xs accent" data-goto="${opt.startHash}">再考一次</button>
        <button class="t-btn xs" data-goto="${opt.histHash}">历史</button>
      </div>
    </div>
  `;
}

// ── 底部回放条 ────────────────────────────────────────────────────
function renderReplayStrip(recordings) {
  if (!recordings.length) return '';
  return `
    <footer class="t-bot">
      <span class="t-bot-label">${ic('i-video', 'ic ic-sm')}课程回放</span>
      <div class="t-bot-list">
        ${recordings.map(r => `
          <a class="t-bot-item" href="${escapeHtml(r.url || '#')}" target="_blank" rel="noopener"
             ${r.password ? `data-pwd="${escapeHtml(r.password)}"` : ''}
             title="${escapeHtml(r.summary || r.title || '')}${r.password ? ' · 点击同时复制密码' : ''}">
            <span class="d">${escapeHtml((r.recorded_at || '').slice(5, 10))}</span>
            <span>${escapeHtml(r.title || '回放')}</span>
            ${r.password ? `<span class="pw">${escapeHtml(r.password)}</span>` : ''}
          </a>
        `).join('')}
      </div>
      <button class="t-btn sm" data-goto="#/classes/recording">全部 ${ic('i-arrow-r', 'ic ic-sm')}</button>
    </footer>
  `;
}

// ── 事件绑定 ──────────────────────────────────────────────────────
function bind(host, ctx, classList, class_id) {
  host.querySelectorAll('[data-goto]').forEach(btn =>
    btn.addEventListener('click', () => { window.location.hash = btn.dataset.goto; }));
  host.querySelectorAll('[data-kp]').forEach(btn =>
    btn.addEventListener('click', () => { window.location.hash = `#/theory?kp=${btn.dataset.kp}`; }));
  host.querySelectorAll('[data-section]').forEach(btn =>
    btn.addEventListener('click', () => { window.location.hash = `#/theory?section=${btn.dataset.section}`; }));

  host.querySelectorAll('.t-bot-item[data-pwd]').forEach(a =>
    a.addEventListener('click', async (ev) => {
      ev.preventDefault();
      const pwd = a.dataset.pwd;
      const url = a.getAttribute('href') || '#';
      const ok = await copyText(pwd);
      showPasswordBanner({ password: pwd, ok, url });
      setTimeout(() => { try { window.open(url, '_blank', 'noopener'); } catch {} }, 1500);
    }));

  const reload = () => renderDashboard(host, ctx);
  const guard = async (msg, fn) => {
    if (!confirm(msg + '\n\n此操作不可撤销，确认继续？')) return;
    try {
      const r = await fn();
      alert(`已重置（删除 ${r.deleted} 条记录）`);
      reload();
    } catch (e) { alert('重置失败：' + e.message); }
  };
  host.querySelector('[data-reset-theory-all]')?.addEventListener('click', () =>
    guard('将清空所有理论题作答记录（含错题、掌握度、统计图表）。', () => API.resetTheory()));
  host.querySelector('[data-reset-ops-all]')?.addEventListener('click', () =>
    guard('将清空所有操作题记录（含未提交草稿与已提交结果）。', () => API.resetOperations()));
  host.querySelector('[data-reset-exams-theory]')?.addEventListener('click', () =>
    guard('将清空所有理论模拟考试历史与作答详情。', () => API.resetExamsTheory()));
  host.querySelector('[data-reset-exams-ops]')?.addEventListener('click', () =>
    guard('将清空所有实操模拟考试历史。', () => API.resetExamsOperations()));
  host.querySelector('[data-edit-class]')?.addEventListener('click', () =>
    openClassPicker(classList, class_id, reload, ctx));
}

// ── 班级选择弹窗 ──────────────────────────────────────────────────
function openClassPicker(classList, currentId, onDone, ctx, forced = false) {
  if (document.getElementById('bk-class-modal')) return;
  const wrap = document.createElement('div');
  wrap.id = 'bk-class-modal';
  wrap.className = 'bk-class-modal';
  wrap.innerHTML = `
    <div class="bk-class-modal-box" role="dialog" aria-modal="true">
      <div class="bk-class-modal-hd">
        <div class="bk-class-modal-title">${forced ? '请先选择你所在的班级' : '修改班级'}</div>
        <button class="bk-class-modal-close" data-close title="关闭">${ic('i-x', 'ic ic-sm')}</button>
      </div>
      <p class="small" style="color:var(--ink-2);margin:0 0 14px">
        选好后系统会自动展示你的<strong>下一次上课</strong>安排（按 1-4 / 5-8 / 9-11 班分组的课表）。
      </p>
      <div class="bk-class-list">
        ${classList.map(c => `
          <label class="bk-class-row ${c.id === currentId ? 'on' : ''}">
            <input type="radio" name="bk-class" value="${c.id}" ${c.id === currentId ? 'checked' : ''}>
            <span class="bk-class-row-name">${escapeHtml(c.name)}</span>
            <span class="bk-class-row-teacher small">班主任 ${escapeHtml(c.teacher || '')}</span>
          </label>
        `).join('')}
      </div>
      <div class="bk-class-modal-ft">
        ${forced ? '<span class="small" style="color:var(--err)">必须选择班级才能继续</span>' : '<span></span>'}
        <div style="display:flex;gap:8px">
          ${forced ? '' : '<button class="bk-btn bk-btn-ghost bk-btn-sm" data-close>取消</button>'}
          <button class="bk-btn bk-btn-primary bk-btn-sm" data-save disabled>保存</button>
        </div>
      </div>
    </div>
  `;
  document.body.appendChild(wrap);

  const saveBtn = wrap.querySelector('[data-save]');
  let picked = currentId || null;
  if (picked) saveBtn.disabled = false;

  wrap.querySelectorAll('input[name="bk-class"]').forEach(r =>
    r.addEventListener('change', () => {
      picked = Number(r.value);
      wrap.querySelectorAll('.bk-class-row').forEach(row => row.classList.remove('on'));
      r.closest('.bk-class-row').classList.add('on');
      saveBtn.disabled = false;
    }));

  const close = () => wrap.remove();
  if (!forced) {
    wrap.querySelectorAll('[data-close]').forEach(b => b.addEventListener('click', close));
    wrap.addEventListener('click', e => { if (e.target === wrap) close(); });
  }

  saveBtn.addEventListener('click', async () => {
    if (!picked) return;
    saveBtn.disabled = true;
    saveBtn.textContent = '保存中…';
    try {
      await API.setMyClass(picked);
      ctx.user.class_id = picked;
      try { auth.user = { ...auth.user, class_id: picked }; } catch { /* ignore */ }
      close();
      onDone();
    } catch (e) {
      alert('保存失败：' + e.message);
      saveBtn.disabled = false;
      saveBtn.textContent = '保存';
    }
  });
}

// ── utils ─────────────────────────────────────────────────────────
function formatRelative(iso) {
  if (!iso) return '';
  const t = new Date(iso).getTime();
  if (isNaN(t)) return '';
  const diff = Date.now() - t;
  const m = Math.floor(diff / 60000);
  if (m < 1) return '刚刚保存';
  if (m < 60) return `最后保存 ${m} 分钟前`;
  const h = Math.floor(m / 60);
  if (h < 24) return `最后保存 ${h} 小时前`;
  return `最后保存 ${Math.floor(h / 24)} 天前`;
}

function escapeHtml(s) {
  return String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;')
    .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

let _pwBannerTimer = null;
function showPasswordBanner({ password, ok = true, url = '' }) {
  const existing = document.getElementById('pw-banner');
  if (existing) existing.remove();
  if (_pwBannerTimer) { clearTimeout(_pwBannerTimer); _pwBannerTimer = null; }

  const wrap = document.createElement('div');
  wrap.id = 'pw-banner';
  wrap.style.cssText = [
    'position:fixed', 'z-index:99999',
    'top:18px', 'left:50%', 'transform:translate(-50%, -8px)',
    'min-width:320px', 'max-width:90vw',
    'padding:14px 22px', 'border-radius:10px',
    `background:${ok ? 'rgba(20,40,30,0.95)' : 'rgba(60,20,20,0.95)'}`,
    'color:#fff', 'box-shadow:0 8px 28px rgba(0,0,0,0.28)',
    'display:flex', 'align-items:center', 'gap:14px',
    'font-size:0.95rem',
    'opacity:0', 'transition:opacity 0.18s ease, transform 0.18s ease',
  ].join(';');

  const safePwd = escapeHtml(password || '');
  wrap.innerHTML = ok ? `
    <span style="font-size:1.1rem">✓</span>
    <div style="flex:1">
      <div style="opacity:0.85;font-size:0.82rem;margin-bottom:2px">密码已复制 · 即将打开回放</div>
      <div style="font-size:1.25rem;font-weight:700;letter-spacing:1px;font-variant-numeric:tabular-nums;user-select:all">${safePwd}</div>
    </div>
    <button type="button" data-open style="background:rgba(255,255,255,0.16);color:#fff;border:0;border-radius:6px;padding:6px 12px;cursor:pointer;font-size:0.85rem">立即打开</button>
    <button type="button" data-close aria-label="关闭" style="background:transparent;color:rgba(255,255,255,0.75);border:0;cursor:pointer;font-size:1.1rem;padding:0 4px">×</button>
  ` : `
    <span style="font-size:1.1rem">✗</span>
    <div style="flex:1">
      <div style="opacity:0.85;font-size:0.82rem;margin-bottom:2px">复制失败，请手动复制</div>
      <div style="font-size:1.25rem;font-weight:700;letter-spacing:1px;user-select:all">${safePwd}</div>
    </div>
    <button type="button" data-close aria-label="关闭" style="background:transparent;color:rgba(255,255,255,0.75);border:0;cursor:pointer;font-size:1.1rem;padding:0 4px">×</button>
  `;
  document.body.appendChild(wrap);
  requestAnimationFrame(() => {
    wrap.style.opacity = '1';
    wrap.style.transform = 'translate(-50%, 0)';
  });

  const dismiss = () => {
    wrap.style.opacity = '0';
    wrap.style.transform = 'translate(-50%, -8px)';
    setTimeout(() => wrap.remove(), 200);
  };
  wrap.querySelector('[data-close]')?.addEventListener('click', dismiss);
  wrap.querySelector('[data-open]')?.addEventListener('click', () => {
    try { window.open(url, '_blank', 'noopener'); } catch {}
    dismiss();
  });
  _pwBannerTimer = setTimeout(dismiss, 6000);
}
