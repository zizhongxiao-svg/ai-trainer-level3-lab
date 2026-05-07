import { API } from '../api.js';
import { renderOperationsCode } from './operations-code.js?v=20260430-code-cell-cont-1';
import { renderOperationsDoc } from './operations-doc.js?v=20260503-docx-learning-goal-1';
import { opSectionNo, withSubmittingOverlay } from './_op-helpers.js?v=20260430-2';
import { handleOpsUnlockError, ignoreOpsUnlock } from './_ops-unlock.js?v=20260429-2';

export async function renderExamOps(host, ctx) {
  const h = ctx.hash || '';
  const mOp = h.match(/^#\/exam-ops\/op\/(\d+)/);
  if (mOp) return renderExamOperation(host, mOp[1]);
  const mReviewOp = h.match(/^#\/exam-ops\/(\d+)\/review-op\/(\d+)/);
  if (mReviewOp) return renderExamReviewOperation(host, mReviewOp[1], mReviewOp[2]);
  const mResult = h.match(/^#\/exam-ops\/(\d+)\/result/);
  if (mResult) return renderResult(host, mResult[1]);
  if (h.startsWith('#/exam-ops/history')) return renderHistory(host);
  return renderEntry(host);
}

async function renderExamOperation(host, opIdStr) {
  const opId = Number(opIdStr);
  host.innerHTML = '<p class="label" style="padding:24px 0">加载考试题目…</p>';

  let active, op;
  try {
    [active, op] = await Promise.all([
      API.opsExamActive(),
      API.operation(opId),
    ]);
  } catch (e) {
    if (handleOpsUnlockError(e, () => renderExamOperation(host, opIdStr))) {
      host.innerHTML = `<div class="bk-card"><p class="small">需要先解锁才能进入实操考试题。</p></div>`;
      return;
    }
    host.innerHTML = `<div class="bk-card" style="color:var(--err)">${escHtml(e.message)}</div>
      <button class="bk-btn" data-back style="margin-top:12px">返回实操考试</button>`;
    host.querySelector('[data-back]')?.addEventListener('click', () => {
      window.location.hash = '#/exam-ops';
    });
    return;
  }

  const operationIds = active?.operation_ids || [];
  const examIndex = operationIds.indexOf(opId) + 1;
  if (!active?.session_id || examIndex <= 0) {
    host.innerHTML = `
      <div class="bk-card" style="text-align:center;padding:40px">
        <h2 style="margin-top:0">没有进行中的实操考试</h2>
        <p class="small" style="color:var(--ink-3)">这道题不属于当前实操考试，不能从考试作答页进入。</p>
        <button class="bk-btn bk-btn-primary" data-back>返回实操考试</button>
      </div>
    `;
    host.querySelector('[data-back]')?.addEventListener('click', () => {
      window.location.hash = '#/exam-ops';
    });
    return;
  }

  const ctx = {
    id: opId,
    examMode: true,
    examSessionId: active.session_id,
    examIndex,
    examBackHash: '#/exam-ops',
  };
  if (op.type === 'code') return renderOperationsCode(host, ctx);
  return renderOperationsDoc(host, ctx);
}

async function renderExamReviewOperation(host, sidStr, opIdStr) {
  const opId = Number(opIdStr);
  host.innerHTML = '<p class="label" style="padding:24px 0">加载复盘题目…</p>';

  let op;
  try {
    op = await API.operation(opId);
  } catch (e) {
    if (handleOpsUnlockError(e, () => renderExamReviewOperation(host, sidStr, opIdStr))) {
      host.innerHTML = `<div class="bk-card"><p class="small">需要先解锁才能查看复盘内容。</p></div>`;
      return;
    }
    host.innerHTML = `<div class="bk-card" style="color:var(--err)">${escHtml(e.message)}</div>
      <button class="bk-btn" data-back style="margin-top:12px">返回成绩</button>`;
    host.querySelector('[data-back]')?.addEventListener('click', () => {
      window.location.hash = `#/exam-ops/${sidStr}/result`;
    });
    return;
  }

  const ctx = {
    id: opId,
    examMode: true,
    examModeLabel: '实操模拟考试复盘',
    examSessionId: sidStr,
    examBackHash: `#/exam-ops/${sidStr}/result`,
  };
  if (op.type === 'code') return renderOperationsCode(host, ctx);
  return renderOperationsDoc(host, ctx);
}

// ── Entry / Active ───────────────────────────────────────────────────
async function renderEntry(host) {
  host.innerHTML = '<p class="label" style="padding:24px 0">加载中…</p>';

  let active = {}, blueprint = null;
  try {
    [active, blueprint] = await Promise.all([
      API.opsExamActive().catch(ignoreOpsUnlock({})),
      API.opsExamBlueprint().catch(() => null),
    ]);
  } catch (e) {
    host.innerHTML = `<div class="bk-card" style="color:var(--err)">${escHtml(e.message)}</div>`;
    return;
  }

  const hasActive = active && active.session_id;
  const bp = blueprint || { duration_minutes: 120, max_score: 100, total_questions: 6, total_points: 100, areas: [] };

  host.innerHTML = `
    <div style="margin-bottom:24px">
      <h2>实操模拟考试</h2>
      <p class="small" style="color:var(--ink-2)">
        官方蓝本（4-04-05-05 三级）· ${bp.total_questions} 题 · ${bp.duration_minutes} 分钟 · 满分 ${bp.max_score} · 按填空自动评分
      </p>
    </div>

    ${hasActive ? renderActiveCard(active) : `
    <div class="bk-card" style="margin-bottom:16px">
      <div class="label">考试结构</div>
      <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:12px;margin:12px 0">
        <div style="text-align:center"><div class="bk-metric-val">${bp.total_questions}</div><div class="small">道 · 按考核方案抽题</div></div>
        <div style="text-align:center"><div class="bk-metric-val">${bp.duration_minutes}</div><div class="small">分钟 · 超时不强制</div></div>
        <div style="text-align:center"><div class="bk-metric-val">${bp.total_points}</div><div class="small">满分 · 60 分及格</div></div>
      </div>
      ${renderBlueprintTable(bp)}
      <p class="small" style="color:var(--ink-3);margin-top:10px">
        提示：每道题都在实操考试作答页完成；期间的最新一次提交将作为考试答卷。
      </p>
    </div>`}

    <div style="display:flex;gap:12px;align-items:center">
      ${hasActive ? '' : `<button class="bk-btn bk-btn-primary" data-start>开始实操模拟</button>`}
      <button class="bk-btn" data-history>历史记录</button>
    </div>
  `;

  host.querySelector('[data-start]')?.addEventListener('click', async () => {
    const btn = host.querySelector('[data-start]');
    btn.disabled = true; btn.textContent = '抽卷中…';
    try {
      await API.opsExamStart();
      await renderEntry(host);
    } catch (e) {
      if (handleOpsUnlockError(e, () => API.opsExamStart().then(() => renderEntry(host)))) {
        btn.disabled = false; btn.textContent = '开始实操模拟';
        return;
      }
      if (/已有进行中/.test(e.message)) {
        await renderEntry(host);
      } else {
        btn.disabled = false; btn.textContent = '开始实操模拟';
        alert(e.message);
      }
    }
  });
  host.querySelector('[data-history]')?.addEventListener('click', () =>
    window.location.hash = '#/exam-ops/history'
  );
  bindActiveHandlers(host);
  if (hasActive) startCountdown(host, active.end_time);
}

function renderBlueprintTable(bp) {
  const areas = bp.areas || [];
  if (!areas.length) return '';
  const selLabel = { pick_one: '抽一', required: '必考' };
  const rows = [];
  areas.forEach(a => {
    (a.subunits || []).forEach((sub, i) => {
      rows.push(`
        <tr>
          ${i === 0 ? `<td rowspan="${a.subunits.length}"><strong>${escHtml(a.area)}</strong><div class="small" style="color:var(--ink-3)">${a.minutes} 分钟</div></td>` : ''}
          <td>${escHtml(sub.name)}</td>
          <td class="small">${escHtml(sub.category)}</td>
          <td class="small">${selLabel[a.selection] || a.selection}</td>
          <td>${sub.points}</td>
        </tr>
      `);
    });
  });
  return `
    <div style="overflow:auto;margin-top:10px">
      <table class="bk-table" style="min-width:560px">
        <thead><tr>
          <th>项目名称</th><th>单元内容</th><th>对应分类</th><th>选考</th><th>配分</th>
        </tr></thead>
        <tbody>${rows.join('')}</tbody>
      </table>
    </div>
  `;
}

function renderActiveCard(active) {
  const ops = active.operations || [];
  const perOp = active.per_op || {};
  const answeredN = ops.filter(op => perOp[String(op.id)]?.submitted).length;
  const total = ops.length;
  return `
    <div class="bk-card bk-exam-active">
      <header class="bk-exam-active-head">
        <div class="bk-exam-active-title">
          <span class="bk-exam-active-badge">进行中</span>
          <span>第 ${active.session_id} 场</span>
          <span class="small" style="color:var(--ink-3)">· 已答 ${answeredN} / ${total}</span>
        </div>
        <div class="bk-exam-active-meta">
          <div class="bk-exam-active-timer">剩余 <span data-countdown>--:--</span></div>
          <div class="small" style="color:var(--ink-3)">截止 ${(active.end_time || '').slice(0, 16)}</div>
        </div>
        <div class="bk-exam-active-actions">
          <button class="bk-btn bk-btn-sm" data-refresh title="刷新状态">⟳</button>
          <button class="bk-btn bk-btn-sm bk-btn-primary" data-submit="${active.session_id}">交卷</button>
        </div>
      </header>

      <ol class="bk-exam-list">
        ${ops.map((op, i) => {
          const status = perOp[String(op.id)] || {};
          const done = !!status.submitted;
          return `
            <li class="bk-exam-row${done ? ' is-done' : ''}">
              <span class="bk-exam-row-idx">${i + 1}</span>
              <div class="bk-exam-row-main">
                <div class="bk-exam-row-title">
                  <span class="bk-exam-row-id" title="题目编号 #${op.id}">${opSectionNo(op.id) || '#' + op.id}</span>
                  <span class="bk-exam-row-name">${escHtml(op.title || '')}</span>
                </div>
                <div class="bk-exam-row-meta small">
                  <span>${escHtml(op.category || '')}</span>
                  <span>${op.blank_count || 0} 空</span>
                  <span>${op.total_score || 0} 分</span>
                </div>
              </div>
              <span class="bk-exam-row-status ${done ? 'is-done' : 'is-pending'}">
                ${done ? '✓ 已作答' : '未作答'}
              </span>
              <button class="bk-btn bk-btn-sm ${done ? '' : 'bk-btn-primary'}" data-goto="${op.id}">
                ${done ? '修改' : '去作答'} →
              </button>
            </li>
          `;
        }).join('')}
      </ol>
    </div>
  `;
}

function bindActiveHandlers(host) {
  host.querySelectorAll('[data-goto]').forEach(b =>
    b.addEventListener('click', () => { window.location.hash = `#/exam-ops/op/${b.dataset.goto}`; })
  );
  host.querySelector('[data-refresh]')?.addEventListener('click', () => renderEntry(host));
  host.querySelector('[data-submit]')?.addEventListener('click', async (ev) => {
    const sid = ev.target.dataset.submit;
    if (!confirm('确认交卷？交卷后代码题将自动评分，文字题将由 AI 按评分细则判卷。')) return;
    ev.target.disabled = true; ev.target.textContent = '提交并启动判卷…';
    try {
      await withSubmittingOverlay(
        () => API.opsExamSubmit(sid),
        { title: '正在交卷', detail: '提交答卷并启动判卷流水线，请稍候…（代码题自动判分；文字题 AI 评阅，约 30 秒）' }
      );
      window.location.hash = `#/exam-ops/${sid}/result`;
    } catch (e) {
      ev.target.disabled = false; ev.target.textContent = '交卷';
      alert(e.message);
    }
  });
}

function startCountdown(host, endTimeStr) {
  const el = host.querySelector('[data-countdown]');
  if (!el || !endTimeStr) return;
  const deadline = Date.parse(endTimeStr.replace(' ', 'T'));
  const tick = () => {
    if (!document.contains(el)) return;
    const ms = deadline - Date.now();
    if (ms <= 0) { el.textContent = '已超时'; el.style.color = 'var(--err)'; return; }
    const total = Math.floor(ms / 1000);
    const mm = String(Math.floor(total / 60)).padStart(2, '0');
    const ss = String(total % 60).padStart(2, '0');
    el.textContent = `${mm}:${ss}`;
    setTimeout(tick, 1000);
  };
  tick();
}

// ── Result ───────────────────────────────────────────────────────────
async function renderResult(host, sidStr) {
  const sid = Number(sidStr);
  host.innerHTML = '<p class="label" style="padding:24px 0">加载成绩中…</p>';

  let data;
  try { data = await API.opsExamGet(sid); }
  catch (e) {
    if (handleOpsUnlockError(e, () => renderResult(host, sidStr))) {
      host.innerHTML = `<div class="bk-card"><p class="small">需要先解锁才能查看实操考试成绩。</p></div>`;
      return;
    }
    host.innerHTML = `<div class="bk-card" style="color:var(--err)">${escHtml(e.message)}</div>
      <button class="bk-btn" data-back style="margin-top:12px">返回</button>`;
    host.querySelector('[data-back]').addEventListener('click', () =>
      window.location.hash = '#/exam-ops'
    );
    return;
  }

  const earned = data.earned_score ?? data.earned_score_live ?? 0;
  const total = data.total_score ?? data.total_score_live ?? 0;
  const grading = data.grading_status || 'none';
  const isGrading = grading === 'running' || grading === 'pending';
  const isFailed = grading === 'failed';
  const pct = total > 0 ? Math.round((earned / total) * 100) : 0;
  const passed = pct >= 60;
  const ops = data.operations || [];
  const perOp = data.per_op || {};

  host.innerHTML = `
    <div style="margin-bottom:24px;display:flex;align-items:baseline;justify-content:space-between">
      <h2>实操成绩 · 第 ${data.session_id} 场</h2>
      <div style="display:flex;gap:8px">
        <button class="bk-btn" data-history>历史</button>
        <button class="bk-btn" data-back>返回</button>
      </div>
    </div>

    <div style="display:grid;grid-template-columns:1fr 2fr;gap:16px;margin-bottom:16px">
      <div class="bk-card" style="text-align:center;border-left:4px solid ${passed ? 'var(--ok)' : 'var(--err)'}">
        <div class="label">总分</div>
        <div class="bk-metric-val" style="font-size:2.6rem;color:${isGrading ? 'var(--warn)' : (passed ? 'var(--ok)' : 'var(--err)')}">${isGrading ? '判卷中' : `${fmt(earned)} / ${fmt(total)}`}</div>
        <div class="small">${
          isGrading ? 'AI 正在按评分细则判文字题，请稍候'
          : isFailed ? `判卷失败：${escHtml(data.grading_error || '请稍后重试或联系管理员')}`
          : `${passed ? '✅ 达标' : '未达标 (<60%)'} · ${pct}%`
        }</div>
        <div class="small" style="color:var(--ink-3);margin-top:8px">${(data.submitted_at || data.start_time || '').slice(0, 16)}</div>
      </div>
      <div class="bk-card">
        <div class="label">逐题得分</div>
        <div style="display:grid;gap:8px;margin-top:10px">
          ${ops.map((op, i) => {
            const p = perOp[String(op.id)] || {};
            const e = p.earned ?? 0, t = p.total ?? (op.total_score || 0);
            const done = !!p.submitted;
            return `
              <div style="padding:8px 10px;background:var(--bg-2);border-radius:6px">
                <div style="display:flex;align-items:center;gap:10px">
                  <span class="bk-chip on" style="pointer-events:none;flex-shrink:0">第 ${i + 1} 题</span>
                  <span style="flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="题目编号 #${op.id}">${opSectionNo(op.id) || '#' + op.id} ${escHtml(op.title || '')}</span>
                  <span class="small" style="flex-shrink:0;white-space:nowrap;color:${done ? 'var(--ink-2)' : 'var(--ink-3)'}">${p.grade_status === 'failed' ? '判卷失败' : (done ? '已作答' : '未提交')}</span>
                  <strong style="flex-shrink:0;white-space:nowrap;color:${e >= t * 0.6 && t > 0 ? 'var(--ok)' : 'var(--err)'}">${fmt(e)} / ${fmt(t)}</strong>
                  <button class="bk-btn bk-btn-sm" style="flex-shrink:0" data-review="${op.id}">查看</button>
                </div>
                ${p.ai_feedback?.summary ? `<div class="small" style="margin-top:4px;padding-left:56px;color:var(--ink-3)">${escHtml(p.ai_feedback.summary)}</div>` : ''}
              </div>
            `;
          }).join('')}
        </div>
      </div>
    </div>

    <p class="small" style="color:var(--ink-3);text-align:center;margin-top:8px">
      代码题按填空参考答案自动评分；文字题交卷后由 AI 按 rubric 与参考要点判卷。
    </p>
  `;

  if (isGrading) {
    setTimeout(() => {
      if (window.location.hash === `#/exam-ops/${sid}/result`) renderResult(host, sid);
    }, 5000);
  }

  host.querySelector('[data-back]').addEventListener('click', () =>
    window.location.hash = '#/exam-ops'
  );
  host.querySelector('[data-history]').addEventListener('click', () =>
    window.location.hash = '#/exam-ops/history'
  );
  host.querySelectorAll('[data-review]').forEach(b =>
    b.addEventListener('click', () => { window.location.hash = `#/exam-ops/${sid}/review-op/${b.dataset.review}`; })
  );
}

// ── History ──────────────────────────────────────────────────────────
async function renderHistory(host) {
  host.innerHTML = '<p class="label" style="padding:24px 0">加载中…</p>';
  let rows;
  try { rows = await API.opsExamList(); }
  catch (e) {
    if (handleOpsUnlockError(e, () => renderHistory(host))) {
      host.innerHTML = `<div class="bk-card"><p class="small">需要先解锁才能查看实操考试历史。</p></div>`;
      return;
    }
    host.innerHTML = `<div class="bk-card" style="color:var(--err)">${escHtml(e.message)}</div>`;
    return;
  }

  host.innerHTML = `
    <div style="display:flex;align-items:baseline;justify-content:space-between;margin-bottom:18px">
      <h2>实操考试历史</h2>
      <button class="bk-btn" data-back>返回</button>
    </div>
    ${rows.length === 0 ? `
      <div class="bk-card" style="text-align:center;padding:40px">
        <p class="small" style="color:var(--ink-3)">还没有实操考试记录</p>
        <button class="bk-btn bk-btn-primary" data-start style="margin-top:12px">去考第一场</button>
      </div>
    ` : `
      <div class="bk-card" style="padding:0">
        <table class="bk-table">
          <thead><tr>
            <th>场次</th><th>开始时间</th><th>用时</th><th>得分</th><th>状态</th><th></th>
          </tr></thead>
          <tbody>
            ${rows.map(r => {
              const done = !!r.submitted_at;
              const earned = r.earned_score ?? 0, total = r.total_score ?? 0;
              const passed = total > 0 && earned / total >= 0.6;
              return `
                <tr>
                  <td>#${r.session_id}</td>
                  <td class="small">${(r.start_time || '').slice(0, 16)}</td>
                  <td class="small" style="color:var(--ink-3)">${duration(r.start_time, r.submitted_at || r.end_time)}</td>
                  <td>${done ? `<strong style="color:${passed ? 'var(--ok)' : 'var(--err)'}">${fmt(earned)} / ${fmt(total)}</strong>` : '—'}</td>
                  <td>${done
                    ? `<span class="${passed ? 'bk-tag-ok' : 'bk-tag-err'}">${passed ? '达标' : '未达标'}</span>`
                    : `<span class="bk-chip on" style="pointer-events:none">进行中</span>`}</td>
                  <td>${done
                    ? `<button class="bk-btn bk-btn-sm" data-view="${r.session_id}">复盘</button>`
                    : `<button class="bk-btn bk-btn-sm bk-btn-primary" data-resume="${r.session_id}">继续</button>`}</td>
                </tr>`;
            }).join('')}
          </tbody>
        </table>
      </div>
    `}
  `;

  host.querySelector('[data-back]')?.addEventListener('click', () =>
    window.location.hash = '#/exam-ops'
  );
  host.querySelector('[data-start]')?.addEventListener('click', () =>
    window.location.hash = '#/exam-ops'
  );
  host.querySelectorAll('[data-view]').forEach(b =>
    b.addEventListener('click', () =>
      window.location.hash = `#/exam-ops/${b.dataset.view}/result`
    )
  );
  host.querySelectorAll('[data-resume]').forEach(b =>
    b.addEventListener('click', () => { window.location.hash = '#/exam-ops'; })
  );
}

// ── Utils ────────────────────────────────────────────────────────────
function fmt(n) {
  if (n == null) return '0';
  const x = Number(n);
  return Number.isInteger(x) ? String(x) : x.toFixed(1);
}
function duration(start, end) {
  if (!start || !end) return '—';
  const ms = Date.parse(end.replace(' ', 'T') + 'Z') - Date.parse(start.replace(' ', 'T') + 'Z');
  if (!ms || ms < 0) return '—';
  const m = Math.floor(ms / 60000);
  return `${m} 分`;
}
function escHtml(s) {
  return String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;')
    .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
