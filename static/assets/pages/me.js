import { API } from '../api.js';
import { renderHeatmap } from '../components/heatmap-90d.js';

const BOARD_TABS = [
  { key: 'theory_progress', label: '理论题进度', kind: 'progress', doneKey: 'mastered' },
  { key: 'ops_progress',    label: '操作题进度', kind: 'progress', doneKey: 'submitted' },
  { key: 'theory_exam',     label: '理论模拟考', kind: 'exam' },
  { key: 'ops_exam',        label: '实操模拟考', kind: 'exam' },
];

export async function renderMe(host, ctx) {
  host.innerHTML = '<p class="label" style="padding:24px 0">加载中…</p>';

  let stats, heat, competition;
  try {
    [stats, heat, competition] = await Promise.all([
      API.stats(),
      API.statsHeatmap(90),
      API.competition(20),
    ]);
  } catch (e) {
    host.innerHTML = `<div class="bk-card" style="color:var(--err)">${e.message}</div>`;
    return;
  }

  const exam = stats.exams || {};
  const wrong = stats.wrong_count || 0;
  const corrected = stats.corrected_count || 0;
  const firstPass = stats.first_pass_count || 0;
  const examCount = exam.exam_count || 0;
  const examBest = exam.best_score;

  host.innerHTML = `
    <div style="margin-bottom:24px">
      <h2>我的数据</h2>
      <p class="small" style="color:var(--ink-2)">学习进度 · 错题复盘 · 公开排行</p>
    </div>

    <!-- KPI row -->
    <div style="display:grid;grid-template-columns:repeat(4,1fr);gap:12px;margin-bottom:16px">
      ${kpi('已答题量', stats.attempted, '/' + stats.total_questions)}
      ${kpi('正确率', stats.correct_rate + '%', '',
        stats.correct_rate >= 80 ? 'var(--ok)' : (stats.correct_rate >= 60 ? 'var(--warn)' : 'var(--err)'))}
      ${kpi('待清错题', wrong, '', wrong > 0 ? 'var(--err)' : 'var(--ok)')}
      ${kpi('已订正', corrected, corrected > 0 ? ' · 可二刷' : '', corrected > 0 ? 'var(--ok)' : 'var(--ink-2)')}
    </div>

    <!-- Heatmap card -->
    <div class="bk-card" style="margin-bottom:16px">
      <div class="label">90 天活跃</div>
      <div style="margin-top:14px" data-heatmap-host></div>
    </div>

    <!-- Wrong-book overview: 三档 -->
    <div class="bk-card" style="margin-bottom:16px">
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:12px">
        <div class="label">错题本概览</div>
        <span class="small" style="color:var(--ink-3)">按每题最近一次作答判定</span>
      </div>
      <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:12px">
        ${bucketCard('待清错题', wrong, '最近一次答错', 'var(--err)', '#/theory?only=wrong', '去清理', wrong > 0)}
        ${bucketCard('已订正', corrected, '错过但已答对，适合二刷三刷', 'var(--ok)', '#/theory?only=corrected', '去复盘', corrected > 0)}
        ${bucketCard('首答即对', firstPass, '从未做错过', 'var(--ink-2)', '', '', false)}
      </div>
    </div>

    <!-- Category mastery (full width) -->
    <div class="bk-card" style="margin-bottom:16px">
      <div class="label">分类掌握度</div>
      ${stats.categories?.length ? `
        <div style="margin-top:12px;display:grid;grid-template-columns:repeat(auto-fill,minmax(280px,1fr));gap:14px 24px">
          ${stats.categories.map(c => {
            const pct = c.total ? Math.round((c.mastered || 0) / c.total * 100) : 0;
            const color = pct >= 80 ? 'var(--ok)' : pct >= 50 ? 'var(--warn)' : 'var(--err)';
            return `
              <div>
                <div style="display:flex;justify-content:space-between;margin-bottom:4px">
                  <span style="font-size:0.9rem">${escHtml(c.category)}</span>
                  <span class="small" style="color:${color}">${c.mastered || 0}/${c.total} · ${pct}%</span>
                </div>
                <div style="background:var(--kbd);height:5px;border-radius:3px">
                  <div style="width:${pct}%;height:100%;background:${color};border-radius:3px"></div>
                </div>
              </div>`;
          }).join('')}
        </div>
      ` : '<p class="small" style="color:var(--ink-3);margin-top:12px">尚无答题记录</p>'}
    </div>

    <!-- Public competition with tabs -->
    <div class="bk-card" style="margin-bottom:16px">
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:12px;gap:12px;flex-wrap:wrap">
        <div class="label">公开排行</div>
        <div class="bk-toolbar" data-board-tabs style="gap:6px">
          ${BOARD_TABS.map((t, i) =>
            `<span class="bk-chip ${i === 0 ? 'on' : ''}" data-board="${t.key}">${t.label}</span>`
          ).join('')}
        </div>
      </div>
      <div data-board-host></div>
      <p class="small" style="color:var(--ink-3);margin-top:10px">
        普通用户只看到聚合结果（掌握/提交百分比、考试均分），具体作答记录不公开。${examCount > 0 ? `你已参加考试 ${examCount} 场${examBest != null ? `，最高 ${examBest} 分` : ''}。` : ''}
      </p>
    </div>
  `;

  // Mount heatmap
  const hh = host.querySelector('[data-heatmap-host]');
  hh.appendChild(renderHeatmap(heat.series));

  // Bucket card CTAs
  host.querySelectorAll('[data-goto]').forEach(b =>
    b.addEventListener('click', () => { window.location.hash = b.dataset.goto; })
  );

  // Board tabs
  const boardHost = host.querySelector('[data-board-host]');
  const renderBoard = (key) => {
    const tab = BOARD_TABS.find(t => t.key === key);
    const rows = competition[key] || [];
    boardHost.innerHTML = tab.kind === 'progress'
      ? progressBoardBody(rows, tab.doneKey)
      : examBoardBody(rows);
  };
  renderBoard(BOARD_TABS[0].key);
  host.querySelectorAll('[data-board]').forEach(chip => {
    chip.addEventListener('click', () => {
      host.querySelectorAll('[data-board]').forEach(c => c.classList.toggle('on', c === chip));
      renderBoard(chip.dataset.board);
    });
  });
}

function kpi(label, val, unit = '', color = 'var(--ink-1)') {
  return `<div class="bk-card" style="text-align:center">
    <div class="label">${label}</div>
    <div class="bk-metric-val" style="color:${color}">${val}<span style="font-size:0.7rem;color:var(--ink-3);font-weight:400">${unit}</span></div>
  </div>`;
}

function bucketCard(title, count, hint, color, goto, btnText, hasBtn) {
  return `<div style="border-left:3px solid ${color};padding:10px 14px;background:var(--surface-alt);border-radius:6px">
    <div style="display:flex;align-items:baseline;gap:8px">
      <strong style="font-size:1.5rem;color:${color}">${count}</strong>
      <span class="small" style="color:var(--ink-2)">${title}</span>
    </div>
    <p class="small" style="color:var(--ink-3);margin:4px 0 ${hasBtn ? '8px' : '0'};line-height:1.5">${hint}</p>
    ${hasBtn ? `<button class="bk-btn bk-btn-ghost bk-btn-sm" data-goto="${goto}">${btnText}</button>` : ''}
  </div>`;
}

function progressBoardBody(rows, doneKey) {
  if (!rows.length) return '<p class="small" style="color:var(--ink-3)">暂无数据</p>';
  return `<table class="bk-table">
    <thead><tr><th>名次</th><th>用户</th><th>完成</th><th>进度</th></tr></thead>
    <tbody>
      ${rows.map(r => {
        const pct = Number(r.progress_pct || 0);
        const color = pct >= 80 ? 'var(--ok)' : pct >= 50 ? 'var(--warn)' : 'var(--err)';
        return `
          <tr ${r.is_me ? 'style="background:var(--surface-alt)"' : ''}>
            <td>${r.rank}</td>
            <td>${escHtml(r.display_name || r.username)}${r.is_me ? ' <span class="small" style="color:var(--ink-3)">(我)</span>' : ''}</td>
            <td class="small">${r[doneKey] || 0}/${r.total || 0}</td>
            <td style="min-width:120px">
              <div class="small" style="color:${color};margin-bottom:3px">${pct}%</div>
              <div style="background:var(--kbd);height:4px;border-radius:3px">
                <div style="width:${Math.max(0, Math.min(100, pct))}%;height:100%;background:${color};border-radius:3px"></div>
              </div>
            </td>
          </tr>`;
      }).join('')}
    </tbody>
  </table>`;
}

function examBoardBody(rows) {
  if (!rows.length) return '<p class="small" style="color:var(--ink-3)">还没有考试记录</p>';
  return `<table class="bk-table">
    <thead><tr><th>名次</th><th>用户</th><th>场次</th><th>均分</th><th>最高</th></tr></thead>
    <tbody>
      ${rows.map(r => `
        <tr ${r.is_me ? 'style="background:var(--surface-alt)"' : ''}>
          <td>${r.rank}</td>
          <td>${escHtml(r.display_name || r.username)}${r.is_me ? ' <span class="small" style="color:var(--ink-3)">(我)</span>' : ''}</td>
          <td class="small">${r.exam_count}</td>
          <td><strong>${r.avg_score ?? '-'}</strong></td>
          <td class="small">${r.best_score ?? '-'}</td>
        </tr>`).join('')}
    </tbody>
  </table>`;
}

function escHtml(s) {
  return String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;')
    .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
