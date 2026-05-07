import { API } from '../api.js';
import { renderQuestionCard } from '../components/question-card.js';

export async function renderExamResult(host, ctx) {
  const sid = Number(ctx.sid);
  host.innerHTML = '<p class="label" style="padding:24px 0">加载结果中…</p>';

  let data;
  try { data = await API.examReview(sid); }
  catch (e) {
    host.innerHTML = `<div class="bk-card" style="color:var(--err)">${e.message}</div>
      <button class="bk-btn" id="back" style="margin-top:12px">返回</button>`;
    host.querySelector('#back').addEventListener('click', () =>
      window.location.hash = '#/exam'
    );
    return;
  }

  const passed = data.score >= data.pass_score;
  const correctCount = data.items.filter(i => i.is_correct).length;
  const breakdown = aggregate(data.items);

  host.innerHTML = `
    <div style="margin-bottom:24px;display:flex;align-items:baseline;justify-content:space-between">
      <h2>考试结果 · 第 ${data.session_id} 场</h2>
      <button class="bk-btn" data-back>返回模拟考试</button>
    </div>

    <div style="display:grid;grid-template-columns:1fr 2fr;gap:16px;margin-bottom:16px">
      <div class="bk-card" style="text-align:center;border-left:4px solid ${passed ? 'var(--ok)' : 'var(--err)'}">
        <div class="label">总分</div>
        <div class="bk-metric-val" style="font-size:2.6rem;color:${passed ? 'var(--ok)' : 'var(--err)'}">${data.score ?? 0}</div>
        <div class="small">${passed ? '✅ 通过' : `差 ${(data.pass_score - (data.score || 0)).toFixed(1)} 分及格`} · ${correctCount}/${data.items.length} 正确</div>
        <div class="small" style="color:var(--ink-3);margin-top:8px">${data.start_time?.slice(0, 16) || ''}</div>
      </div>
      <div class="bk-card">
        <div class="label">分项得分</div>
        <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:12px;margin-top:12px">
          ${['judge', 'single', 'multi'].map(t => `
            <div style="text-align:center">
              <div class="bk-metric-val">${breakdown[t].score}</div>
              <div class="small">${typeLabel(t)} ${breakdown[t].correct}/${breakdown[t].total}</div>
            </div>
          `).join('')}
        </div>
      </div>
    </div>

    <div style="margin:18px 0 12px;display:flex;gap:8px;align-items:center">
      <h3 style="margin:0">逐题复盘</h3>
      <span class="small" style="color:var(--ink-3)">点击展开/折叠</span>
      <span style="flex:1"></span>
      <button class="bk-btn bk-btn-sm" data-filter="all">全部</button>
      <button class="bk-btn bk-btn-sm" data-filter="wrong">仅错题</button>
    </div>

    <div data-review-list></div>
  `;

  host.querySelector('[data-back]').addEventListener('click', () =>
    window.location.hash = '#/exam'
  );

  const listHost = host.querySelector('[data-review-list]');
  const renderList = (filter) => {
    listHost.innerHTML = '';
    const items = filter === 'wrong' ? data.items.filter(i => !i.is_correct) : data.items;
    items.forEach((item, idx) => {
      const det = document.createElement('details');
      det.className = 'bk-review-row';
      det.open = !item.is_correct && filter !== 'all';
      det.innerHTML = `<summary>
        <span class="bk-review-num">${item.is_correct ? '✓' : '✗'}</span>
        <span class="bk-review-title">${idx + 1}. ${escHtml(item.text).slice(0, 60)}${item.text.length > 60 ? '…' : ''}</span>
        <span class="bk-review-tag ${item.is_correct ? 'ok' : 'err'}">${item.is_correct ? '答对' : '答错'}</span>
      </summary>`;
      det.appendChild(renderQuestionCard(item, { mode: 'review' }));
      listHost.appendChild(det);
    });
    if (!items.length) listHost.innerHTML = '<p class="small" style="color:var(--ink-3);padding:24px;text-align:center">没有错题，太厉害了</p>';
  };
  renderList('all');
  host.querySelectorAll('[data-filter]').forEach(b =>
    b.addEventListener('click', () => renderList(b.dataset.filter))
  );
}

function aggregate(items) {
  const out = {
    judge: { correct: 0, total: 0, score: 0 },
    single: { correct: 0, total: 0, score: 0 },
    multi: { correct: 0, total: 0, score: 0 },
  };
  for (const it of items) {
    const t = it.type;
    if (!out[t]) continue;
    out[t].total += 1;
    if (it.is_correct) out[t].correct += 1;
    out[t].score = +(out[t].score + (it.points_awarded || 0)).toFixed(1);
  }
  return out;
}
function typeLabel(t) { return { judge: '判断', single: '单选', multi: '多选' }[t] || t; }
function escHtml(s) {
  return String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;')
    .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
