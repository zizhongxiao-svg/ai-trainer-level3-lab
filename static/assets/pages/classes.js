import { API } from '../api.js';

const TABS = [
  { key: 'roster',    label: '分班名单' },
  { key: 'schedule',  label: '课程安排' },
  { key: 'recording', label: '录屏回放' },
];

function parseTab(hash) {
  const m = (hash || '').match(/^#\/classes\/([^/?]+)/);
  const key = m && m[1];
  return TABS.find(t => t.key === key)?.key || 'roster';
}

export async function renderClasses(host, ctx) {
  const tab = parseTab(ctx.hash);
  host.innerHTML = `
    <div class="bk-chip-row" style="margin-bottom:16px">
      ${TABS.map(t => `
        <button class="bk-chip ${t.key === tab ? 'on' : ''}" data-tab="${t.key}">${t.label}</button>
      `).join('')}
    </div>
    <div data-panel></div>
  `;
  host.querySelectorAll('[data-tab]').forEach(b =>
    b.addEventListener('click', () => {
      window.location.hash = `#/classes/${b.dataset.tab}`;
    })
  );
  const panel = host.querySelector('[data-panel]');
  const data = await loadData(panel);
  if (!data) return;
  if (tab === 'roster') renderRoster(panel, data);
  else if (tab === 'schedule') renderSchedule(panel, data);
  else renderRecording(panel, data);
}

let _cache = null;
async function loadData(panel) {
  if (_cache) return _cache;
  panel.innerHTML = '<p class="label" style="padding:16px 0">加载中…</p>';
  try { _cache = await API.classes(); return _cache; }
  catch (e) {
    panel.innerHTML = `<div class="bk-card" style="color:var(--err)">${esc(e.message)}</div>`;
    return null;
  }
}

function renderRoster(panel, data) {
  const classes = data.classes || [];
  if (!classes.length) {
    panel.innerHTML = `<div class="bk-card"><p class="small">暂无分班信息</p></div>`;
    return;
  }
  panel.innerHTML = `
    <div class="bk-card" style="padding:0">
      <table class="bk-table">
        <thead>
          <tr>
            <th style="width:110px">班级</th>
            <th>班委</th>
            <th>电话</th>
            <th>邮箱</th>
            <th>辅导老师</th>
            <th>老师电话</th>
          </tr>
        </thead>
        <tbody>
          ${classes.flatMap(c => {
            const reps = c.reps || [];
            const teacher = c.teacher || (reps[0] && reps[0].teacher) || '';
            const teacherPhone = c.teacher_phone || (reps[0] && reps[0].teacher_phone) || '';
            if (!reps.length) {
              return [`<tr><td><strong>${esc(c.name)}</strong></td><td colspan="5" class="small" style="color:var(--ink-3)">—</td></tr>`];
            }
            return reps.map((r, idx) => `
              <tr>
                <td>${idx === 0 ? `<strong>${esc(c.name)}</strong>` : ''}</td>
                <td>${esc(r.name)}</td>
                <td class="small"><a href="tel:${esc(r.phone)}" style="color:var(--ink-2)">${esc(r.phone)}</a></td>
                <td class="small"><a href="mailto:${esc(r.email)}" style="color:var(--ink-2)">${esc(r.email)}</a></td>
                <td class="small">${idx === 0 ? esc(teacher) : ''}</td>
                <td class="small">${idx === 0 ? `<a href="tel:${esc(teacherPhone)}" style="color:var(--ink-2)">${esc(teacherPhone)}</a>` : ''}</td>
              </tr>
            `);
          }).join('')}
        </tbody>
      </table>
    </div>
    <p class="small" style="color:var(--ink-3);margin-top:10px">
      共 ${classes.length} 个班级 · 数据源 <code>data/classes.json</code>，如有更新可直接编辑文件。
    </p>
  `;
}

let _scheduleGroupIdx = 0;
function renderSchedule(panel, data) {
  const schedules = data.schedules || [];
  if (!schedules.length) {
    panel.innerHTML = `
      <div class="bk-card" style="text-align:center;padding:40px 24px">
        <div class="label" style="margin-bottom:10px">课程安排</div>
        <p class="small" style="color:var(--ink-3)">暂无排期。数据位置：<code>data/classes.json → schedules</code></p>
      </div>
    `;
    return;
  }
  if (_scheduleGroupIdx >= schedules.length) _scheduleGroupIdx = 0;
  const g = schedules[_scheduleGroupIdx];
  const today = new Date();
  panel.innerHTML = `
    <div class="bk-chip-row" style="margin-bottom:12px">
      ${schedules.map((s, i) => `
        <button class="bk-chip ${i === _scheduleGroupIdx ? 'on' : ''}" data-gidx="${i}">${esc(s.group)}</button>
      `).join('')}
    </div>
    <div class="bk-card" style="padding:0">
      <div style="padding:14px 18px;border-bottom:1px solid var(--line);display:flex;align-items:baseline;justify-content:space-between;gap:12px;flex-wrap:wrap">
        <div><strong>人工智能三级 · ${esc(g.group)}</strong></div>
        ${g.note ? `<div class="small" style="color:var(--ink-3)">${esc(g.note)}</div>` : ''}
      </div>
      <table class="bk-table">
        <thead>
          <tr>
            <th style="width:60px">课次</th>
            <th style="width:140px">上课日期</th>
            <th style="width:130px">上课时间</th>
            <th>课程主题</th>
            <th style="width:220px">地点</th>
          </tr>
        </thead>
        <tbody>
          ${(g.sessions || []).map(s => {
            const past = isPast(s.date, today);
            const rowStyle = past ? 'color:var(--ink-3);opacity:.65' : '';
            return `
              <tr style="${rowStyle}">
                <td>${esc(String(s.no ?? ''))}</td>
                <td class="small">${esc(s.date || '')}${s.weekday ? ` <span style="color:var(--ink-3)">${esc(s.weekday)}</span>` : ''}</td>
                <td class="small">${esc(s.time || '')}</td>
                <td>${esc(s.topic || '')}</td>
                <td class="small">${esc(s.location || '')}</td>
              </tr>
            `;
          }).join('')}
        </tbody>
      </table>
    </div>
  `;
  panel.querySelectorAll('[data-gidx]').forEach(b =>
    b.addEventListener('click', () => {
      _scheduleGroupIdx = parseInt(b.dataset.gidx, 10) || 0;
      renderSchedule(panel, data);
    })
  );
}

function isPast(dateStr, today) {
  const m = String(dateStr || '').match(/(\d+)月(\d+)日/);
  if (!m) return false;
  const year = today.getFullYear();
  const d = new Date(year, parseInt(m[1], 10) - 1, parseInt(m[2], 10));
  return d < new Date(today.getFullYear(), today.getMonth(), today.getDate());
}

function renderRecording(panel, data) {
  const recordings = data.recordings || [];
  if (!recordings.length) {
    panel.innerHTML = `
      <div class="bk-card" style="text-align:center;padding:40px 24px">
        <div class="label" style="margin-bottom:10px">录屏回放</div>
        <p class="small" style="color:var(--ink-3);max-width:480px;margin:0 auto">
          暂无录屏。数据位置：<code>data/classes.json → recordings</code>
        </p>
      </div>
    `;
    return;
  }
  panel.innerHTML = `
    <div style="display:grid;gap:12px">
      ${recordings.map((r) => `
        <div class="bk-card">
          <div style="display:flex;align-items:flex-start;justify-content:space-between;gap:14px;flex-wrap:wrap">
            <div>
              <div class="label">${esc(r.course || '录屏回放')}</div>
              <h3 style="margin:4px 0 8px;font-size:1.08rem">${esc(r.title || '')}</h3>
              <div class="small" style="display:flex;gap:10px;flex-wrap:wrap;color:var(--ink-3)">
                ${r.recorded_at ? `<span>录制时间：${esc(r.recorded_at)}</span>` : ''}
                ${r.group ? `<span>适用班级：${esc(r.group)}</span>` : ''}
                ${r.source ? `<span>来源：${esc(r.source)}</span>` : ''}
              </div>
            </div>
            <a class="bk-btn bk-btn-primary" href="${esc(r.url || '#')}" target="_blank" rel="noopener">打开回放</a>
          </div>
          <div style="margin-top:12px;display:flex;align-items:center;gap:10px;flex-wrap:wrap">
            ${r.password ? `<span class="bk-chip pwd-copy" data-pwd="${esc(r.password)}" style="cursor:pointer;user-select:none" title="点击复制密码">访问密码：${esc(r.password)}</span>` : ''}
          </div>
          ${r.summary ? `<p style="margin:12px 0 0;line-height:1.7;color:var(--ink-2)">${esc(r.summary)}</p>` : ''}
        </div>
      `).join('')}
    </div>
  `;
  panel.querySelectorAll('.pwd-copy').forEach((chip) => {
    chip.addEventListener('click', () => copyPassword(chip));
  });
}

async function copyPassword(chip) {
  const pwd = chip.dataset.pwd || '';
  if (!pwd) return;
  const ok = await copyText(pwd);
  showCopyToast(chip, ok ? '已复制 ✓' : '复制失败');
}

export async function copyText(text) {
  if (!text) return false;
  try {
    if (navigator.clipboard && window.isSecureContext) {
      await navigator.clipboard.writeText(text);
      return true;
    }
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.select();
    const ok = document.execCommand('copy');
    document.body.removeChild(ta);
    return ok;
  } catch {
    return false;
  }
}

export function showCopyToast(anchor, text) {
  const toast = document.createElement('div');
  toast.textContent = text;
  toast.style.cssText = [
    'position:fixed', 'z-index:9999',
    'padding:6px 12px', 'border-radius:6px',
    'background:rgba(20,20,20,0.88)', 'color:#fff',
    'font-size:0.85rem', 'pointer-events:none',
    'box-shadow:0 4px 12px rgba(0,0,0,0.18)',
    'transition:opacity 0.18s ease, transform 0.18s ease',
    'opacity:0', 'transform:translateY(4px)',
  ].join(';');
  document.body.appendChild(toast);
  const rect = anchor.getBoundingClientRect();
  const tw = toast.offsetWidth;
  toast.style.top = `${Math.max(8, rect.top - toast.offsetHeight - 8)}px`;
  toast.style.left = `${Math.max(8, rect.left + rect.width / 2 - tw / 2)}px`;
  requestAnimationFrame(() => {
    toast.style.opacity = '1';
    toast.style.transform = 'translateY(0)';
  });
  setTimeout(() => {
    toast.style.opacity = '0';
    toast.style.transform = 'translateY(4px)';
    setTimeout(() => toast.remove(), 220);
  }, 1100);
}

function esc(s) {
  return String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;')
    .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
