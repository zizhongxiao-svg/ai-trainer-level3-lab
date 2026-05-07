import { API, BASE } from '../api.js';
import { makeCsvDownloadButton } from '../components/csv-download-btn.js';

export async function renderAdmin(host) {
  host.innerHTML = '<p class="label" style="padding:24px 0">加载中…</p>';
  let data;
  try { data = await API.adminStats(); }
  catch (e) {
    host.innerHTML = `<div class="bk-card" style="color:var(--err)">${e.message}</div>`;
    return;
  }

  host.innerHTML = `
    <div style="margin-bottom:24px;display:flex;align-items:baseline;justify-content:space-between">
      <div>
        <h2>管理员</h2>
        <p class="small" style="color:var(--ink-2)">用户进度 · 考试排行 · 数据导出</p>
      </div>
      <div class="bk-admin-actions" style="display:flex;gap:8px"></div>
    </div>

    <div class="bk-card" style="margin-bottom:16px;padding:0">
      <div style="padding:14px 22px;border-bottom:1px solid var(--line)"><div class="label">用户学习进度（${data.users.length} 人）</div></div>
      <table class="bk-table">
        <thead><tr>
          <th>用户</th><th>注册时间</th><th>已练题</th><th>答题次数</th><th>正确率</th>
        </tr></thead>
        <tbody>
          ${data.users.map(u => {
            const rate = u.total_attempts ? Math.round(u.correct_attempts / u.total_attempts * 100) : null;
            const rateColor = rate == null ? 'var(--ink-3)' : rate >= 70 ? 'var(--ok)' : rate >= 50 ? 'var(--warn)' : 'var(--err)';
            return `<tr>
              <td>${escHtml(u.display_name || u.username)} <span class="small" style="color:var(--ink-3)">@${escHtml(u.username)}</span></td>
              <td class="small">${(u.created_at || '').slice(0, 10)}</td>
              <td>${u.attempted}</td>
              <td class="small">${u.total_attempts}</td>
              <td style="color:${rateColor}"><strong>${rate == null ? '-' : rate + '%'}</strong></td>
            </tr>`;
          }).join('')}
        </tbody>
      </table>
    </div>

    <div class="bk-card" style="padding:0">
      <div style="padding:14px 22px;border-bottom:1px solid var(--line)"><div class="label">考试排行</div></div>
      ${data.leaderboard?.length ? `
        <table class="bk-table">
          <thead><tr><th>名次</th><th>用户</th><th>场次</th><th>平均分</th><th>最高分</th></tr></thead>
          <tbody>
            ${data.leaderboard.map((e, i) => `<tr>
              <td>${i + 1}</td>
              <td>${escHtml(e.display_name || e.username)}</td>
              <td>${e.exam_count}</td>
              <td><strong>${e.avg_score ?? '-'}</strong></td>
              <td style="color:var(--ok)"><strong>${e.best_score ?? '-'}</strong></td>
            </tr>`).join('')}
          </tbody>
        </table>
      ` : '<p class="small" style="color:var(--ink-3);padding:18px 22px">暂无考试数据</p>'}
    </div>
  `;

  // Inject CSV buttons
  const actions = host.querySelector('.bk-admin-actions');
  actions.appendChild(makeCsvDownloadButton('导出用户 CSV', BASE + '/api/admin/export/users.csv', 'users.csv'));
  actions.appendChild(makeCsvDownloadButton('导出考试 CSV', BASE + '/api/admin/export/exams.csv', 'exams.csv'));
}

function escHtml(s) {
  return String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;')
    .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
