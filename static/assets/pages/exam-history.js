import { API } from '../api.js';

export async function renderExamHistory(host) {
  host.innerHTML = '<p class="label" style="padding:24px 0">加载中…</p>';
  let rows;
  try { rows = await API.examHistory(); }
  catch (e) {
    host.innerHTML = `<div class="bk-card" style="color:var(--err)">${e.message}</div>`;
    return;
  }

  host.innerHTML = `
    <div style="display:flex;align-items:baseline;justify-content:space-between;margin-bottom:18px">
      <h2>考试历史</h2>
      <button class="bk-btn" data-back>返回模拟考试</button>
    </div>
    ${rows.length === 0 ? `
      <div class="bk-card" style="text-align:center;padding:40px">
        <p class="small" style="color:var(--ink-3)">还没有考试记录</p>
        <button class="bk-btn bk-btn-primary" data-start style="margin-top:12px">去考第一场</button>
      </div>
    ` : `
      <div class="bk-card" style="padding:0">
        <table class="bk-table">
          <thead><tr>
            <th>场次</th><th>开始时间</th><th>用时</th><th>分数</th><th>结果</th><th></th>
          </tr></thead>
          <tbody>
            ${rows.map(r => {
              const passed = r.score >= 60;
              return `
                <tr>
                  <td>#${r.id}</td>
                  <td class="small">${(r.start_time || '').slice(0, 16)}</td>
                  <td class="small" style="color:var(--ink-3)">${duration(r.start_time, r.end_time)}</td>
                  <td><strong style="color:${passed ? 'var(--ok)' : 'var(--err)'}">${r.score ?? '-'}</strong></td>
                  <td><span class="${passed ? 'bk-tag-ok' : 'bk-tag-err'}">${passed ? '通过' : '未通过'}</span></td>
                  <td><button class="bk-btn bk-btn-sm" data-replay="${r.id}">复盘</button></td>
                </tr>`;
            }).join('')}
          </tbody>
        </table>
      </div>
    `}
  `;

  host.querySelector('[data-back]')?.addEventListener('click', () =>
    window.location.hash = '#/exam'
  );
  host.querySelector('[data-start]')?.addEventListener('click', () =>
    window.location.hash = '#/exam'
  );
  host.querySelectorAll('[data-replay]').forEach(b =>
    b.addEventListener('click', () =>
      window.location.hash = `#/exam/${b.dataset.replay}/result`
    )
  );
}

function duration(start, end) {
  if (!start || !end) return '—';
  const ms = Date.parse(end.replace(' ', 'T') + 'Z') - Date.parse(start.replace(' ', 'T') + 'Z');
  if (!ms || ms < 0) return '—';
  const m = Math.floor(ms / 60000);
  return `${m} 分`;
}
