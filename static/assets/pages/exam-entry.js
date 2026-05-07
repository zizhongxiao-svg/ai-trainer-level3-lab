import { API } from '../api.js';
import { handleOpsUnlockError, ignoreOpsUnlock } from './_ops-unlock.js?v=20260429-2';

export async function renderExamEntry(host) {
  host.innerHTML = '<p class="label" style="padding:24px 0">加载中…</p>';

  let theoryActive = {}, opsActive = {}, opsBlueprint = null;
  try {
    [theoryActive, opsActive, opsBlueprint] = await Promise.all([
      API.examActive(),
      API.opsExamActive().catch(ignoreOpsUnlock({})),
      API.opsExamBlueprint().catch(() => null),
    ]);
  } catch (e) {
    host.innerHTML = `<div class="bk-card" style="color:var(--err)">${escapeHtml(e.message)}</div>`;
    return;
  }

  const hasTheoryActive = theoryActive && theoryActive.session_id;
  const hasOpsActive = opsActive && opsActive.session_id;
  const answeredCount = hasTheoryActive ? Object.keys(theoryActive.progress || {}).length : 0;
  const theoryRemaining = hasTheoryActive ? remainingMinutes(theoryActive.deadline) : 0;
  const opsRemaining = hasOpsActive ? remainingMinutes(opsActive.end_time) : 0;
  const bp = opsBlueprint || {
    duration_minutes: 120,
    max_score: 100,
    total_questions: 6,
    total_points: 100,
    areas: [],
  };

  host.innerHTML = `
    <div style="margin-bottom:24px">
      <h2>模拟考试</h2>
      <p class="small" style="color:var(--ink-2)">理论知识考试 + 操作技能考核 · 按考试方案抽题</p>
    </div>

    <div style="display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:16px;margin-bottom:16px">
      <div class="bk-card" style="${hasTheoryActive ? 'border-left:3px solid var(--warn)' : ''}">
        <div class="label">${hasTheoryActive ? '理论考试进行中' : '理论知识考试'}</div>
        <h3 style="margin:8px 0 6px">闭卷机考 · 190 题 · 90 分钟</h3>
        <p class="small" style="color:var(--ink-2);line-height:1.6;margin-bottom:12px">
          判断题 40 题、单选题 140 题、多选题 10 题，满分 100，60 分及格。
        </p>
        ${hasTheoryActive ? `
          <div class="small" style="color:var(--warn);margin-bottom:12px">
            第 ${theoryActive.session_id} 场 · 已答 ${answeredCount} / ${theoryActive.total} · 剩余 ${theoryRemaining} 分钟
          </div>
          <button class="bk-btn bk-btn-primary" data-resume-theory="${theoryActive.session_id}">继续理论考试</button>
        ` : `
          <button class="bk-btn bk-btn-primary" data-start-theory>开始理论模拟</button>
        `}
        <button class="bk-btn" data-history-theory style="margin-left:8px">历史记录</button>
      </div>

      <div class="bk-card" style="${hasOpsActive ? 'border-left:3px solid var(--warn)' : ''}">
        <div class="label">${hasOpsActive ? '实操考试进行中' : '操作技能模拟'}</div>
        <h3 style="margin:8px 0 6px">抽题实操 · ${bp.total_questions} 题 · ${bp.duration_minutes} 分钟</h3>
        <p class="small" style="color:var(--ink-2);line-height:1.6;margin-bottom:12px">
          按 PDF 考核方案从操作题内容中抽题，满分 ${bp.total_points || bp.max_score}，交卷时汇总每题最新提交得分。
        </p>
        ${hasOpsActive ? `
          <div class="small" style="color:var(--warn);margin-bottom:12px">
            第 ${opsActive.session_id} 场 · ${opsActive.operation_ids?.length || bp.total_questions} 题 · 剩余 ${opsRemaining} 分钟
          </div>
          <button class="bk-btn bk-btn-primary" data-resume-ops>继续实操考试</button>
        ` : `
          <button class="bk-btn bk-btn-primary" data-start-ops>开始实操模拟</button>
        `}
        <button class="bk-btn" data-history-ops style="margin-left:8px">历史记录</button>
      </div>
    </div>

    <div class="bk-card">
      <div class="label">操作技能抽题结构</div>
      ${renderOpsBlueprint(bp)}
    </div>
  `;

  host.querySelector('[data-start-theory]')?.addEventListener('click', async () => {
    const btn = host.querySelector('[data-start-theory]');
    btn.disabled = true; btn.textContent = '生成试卷中…';
    try {
      const data = await API.examStart();
      window.location.hash = `#/exam/${data.session_id}`;
    } catch (e) {
      if (/已有进行中/.test(e.message)) {
        const active = await API.examActive();
        if (active.session_id) window.location.hash = `#/exam/${active.session_id}`;
      } else {
        btn.disabled = false; btn.textContent = '开始理论模拟';
        alert(e.message);
      }
    }
  });
  host.querySelector('[data-resume-theory]')?.addEventListener('click', () => {
    window.location.hash = `#/exam/${theoryActive.session_id}`;
  });
  host.querySelector('[data-history-theory]')?.addEventListener('click', () => {
    window.location.hash = '#/exam/history';
  });

  host.querySelector('[data-start-ops]')?.addEventListener('click', async () => {
    const btn = host.querySelector('[data-start-ops]');
    btn.disabled = true; btn.textContent = '抽卷中…';
    try {
      await API.opsExamStart();
      window.location.hash = '#/exam-ops';
    } catch (e) {
      if (handleOpsUnlockError(e, () => API.opsExamStart().then(() => { window.location.hash = '#/exam-ops'; }))) {
        btn.disabled = false; btn.textContent = '开始实操模拟';
        return;
      }
      if (/已有进行中/.test(e.message)) {
        window.location.hash = '#/exam-ops';
      } else {
        btn.disabled = false; btn.textContent = '开始实操模拟';
        alert(e.message);
      }
    }
  });
  host.querySelector('[data-resume-ops]')?.addEventListener('click', () => {
    window.location.hash = '#/exam-ops';
  });
  host.querySelector('[data-history-ops]')?.addEventListener('click', () => {
    window.location.hash = '#/exam-ops/history';
  });
}

function renderOpsBlueprint(bp) {
  const areas = bp.areas || [];
  if (!areas.length) {
    return '<p class="small" style="color:var(--ink-3);margin-top:12px">暂无操作技能抽题结构</p>';
  }
  const selLabel = { pick_one: '抽一', required: '必考' };
  const rows = [];
  areas.forEach((area) => {
    (area.subunits || []).forEach((sub, i) => {
      rows.push(`
        <tr>
          ${i === 0 ? `<td rowspan="${area.subunits.length}"><strong>${escapeHtml(area.area)}</strong><div class="small" style="color:var(--ink-3)">${area.minutes} 分钟</div></td>` : ''}
          <td>${escapeHtml(sub.name)}</td>
          <td class="small">${escapeHtml(sub.category)}</td>
          <td class="small">${selLabel[area.selection] || escapeHtml(area.selection)}</td>
          <td>${sub.points}</td>
        </tr>
      `);
    });
  });
  return `
    <div style="overflow:auto;margin-top:12px">
      <table class="bk-table" style="min-width:560px">
        <thead><tr>
          <th>项目名称</th><th>单元内容</th><th>题库分类</th><th>选考方法</th><th>配分</th>
        </tr></thead>
        <tbody>${rows.join('')}</tbody>
      </table>
    </div>
  `;
}

function remainingMinutes(deadlineStr) {
  if (!deadlineStr) return 0;
  const t = Date.parse(deadlineStr.replace(' ', 'T'));
  return Math.max(0, Math.round((t - Date.now()) / 60000));
}

function escapeHtml(s) {
  return String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;')
    .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
