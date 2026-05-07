import { API } from '../api.js';
import { opSectionNo } from './_op-helpers.js?v=20260428-2';

export async function renderDocFlash(host) {
  host.innerHTML = `<p class="small" style="padding:24px">加载…</p>`;

  let allOps = [];
  try {
    const d = await API.operations();
    allOps = (d.questions || []).filter(q => q.type === 'doc' && q.flash_points?.length);
  } catch (e) {
    host.innerHTML = `<div class="bk-card" style="color:var(--err)">${esc(e.message)}</div>`;
    return;
  }

  const cats = ['全部', ...new Set(allOps.map(o => o.category))];
  const state = { cat: '全部', showAll: false };

  host.innerHTML = `
    <div style="padding:20px 24px 0">
      <div class="bk-card" style="margin-bottom:0;padding:14px 18px">
        <div style="display:flex;align-items:center;gap:14px;flex-wrap:wrap">
          <div style="flex:1;min-width:200px">
            <div class="label" style="margin-bottom:2px">小作文速记</div>
            <div style="display:flex;align-items:baseline;gap:10px;flex-wrap:wrap">
              <h2 style="margin:0;font-size:1.1rem">文档题考点速查</h2>
              <span class="small" style="color:var(--ink-3)">20道题 · 看考点背要点，不用背整篇答案</span>
            </div>
          </div>
          <button id="df-toggle-all" class="bk-btn bk-btn-ghost bk-btn-sm"
                  style="min-width:96px">显示答案</button>
        </div>
        <div id="df-cats" class="bk-filter-bar" style="margin-top:10px;padding-top:8px;border-top:1px solid var(--line)"></div>
      </div>
    </div>
    <div id="df-grid" style="padding:12px 24px 32px"></div>
  `;

  const toggleBtn = host.querySelector('#df-toggle-all');
  toggleBtn.addEventListener('click', () => {
    state.showAll = !state.showAll;
    toggleBtn.textContent = state.showAll ? '隐藏答案' : '显示答案';
    host.querySelectorAll('.df-answers').forEach(el => {
      el.style.display = state.showAll ? 'block' : 'none';
    });
    host.querySelectorAll('.df-card-toggle').forEach(btn => {
      btn.textContent = state.showAll ? '隐藏答案 ▲' : '显示答案 ▼';
    });
  });

  renderCats();
  renderGrid();

  function renderCats() {
    const bar = host.querySelector('#df-cats');
    bar.innerHTML = cats.map(c => `
      <button class="bk-chip ${state.cat === c ? 'on' : ''}" data-cat="${esc(c)}">
        ${c === '全部' ? '全部 (' + allOps.length + ')' : esc(c)}
      </button>
    `).join('');
    bar.querySelectorAll('[data-cat]').forEach(btn =>
      btn.addEventListener('click', () => {
        state.cat = btn.dataset.cat;
        renderCats();
        renderGrid();
      })
    );
  }

  function renderGrid() {
    const ops = allOps.filter(o => state.cat === '全部' || o.category === state.cat);
    const grid = host.querySelector('#df-grid');
    if (!ops.length) { grid.innerHTML = `<p class="small">暂无题目</p>`; return; }

    // Group by category if showing all
    let html = '';
    if (state.cat === '全部') {
      const groups = {};
      ops.forEach(o => { (groups[o.category] = groups[o.category] || []).push(o); });
      for (const [cat, items] of Object.entries(groups)) {
        html += `<div class="df-group-label">${esc(cat)}</div>`;
        html += items.map(cardHtml).join('');
      }
    } else {
      html = ops.map(cardHtml).join('');
    }
    grid.innerHTML = html;

    grid.querySelectorAll('.df-card-toggle').forEach(btn => {
      btn.addEventListener('click', () => {
        const card = btn.closest('.df-card');
        const answers = card.querySelector('.df-answers');
        const visible = answers.style.display !== 'none';
        answers.style.display = visible ? 'none' : 'block';
        btn.textContent = visible ? '显示答案 ▼' : '隐藏答案 ▲';
      });
    });

    grid.querySelectorAll('[data-goto-op]').forEach(btn => {
      btn.addEventListener('click', () => {
        window.location.hash = `#/ops/${btn.dataset.gotoOp}`;
      });
    });
  }

  function cardHtml(o) {
    const fps = o.flash_points || [];
    const sectionNo = opSectionNo(o.id);
    const titlePrefix = sectionNo || `#${o.id}`;
    const answersHtml = fps.map(fp => `
      <div class="df-fp-group">
        <div class="df-fp-tag">${esc(fp.tag)}</div>
        <ul class="df-fp-list">
          ${(fp.points || []).map(p => `<li>${esc(p)}</li>`).join('')}
        </ul>
      </div>
    `).join('');

    return `
      <div class="df-card bk-card">
        <div class="df-card-head">
          <span class="df-card-no" title="题目编号 #${o.id}">${esc(titlePrefix)}</span>
          <span class="bk-chip on" style="pointer-events:none;font-size:0.75rem">${esc(o.category)}</span>
          <span class="df-card-score">${o.total_score}分 · ${esc(o.time_limit || '')}</span>
          <button class="df-card-toggle bk-btn bk-btn-ghost bk-btn-sm"
                  style="margin-left:auto;min-width:88px">显示答案 ▼</button>
        </div>
        <div class="df-card-title"><span class="df-title-no">${esc(titlePrefix)}</span>${esc(o.title || '')}</div>
        <div class="df-card-tasks">
          ${(o.tasks || []).map(t => `<p class="df-task small">${esc(t.num + '. ' + (t.text || '').replace(/（对应作答框题号[^）]*）/g, '').trim())}</p>`).join('')}
        </div>
        <div class="df-answers" style="display:none">
          <div class="df-answers-inner">
            ${answersHtml}
          </div>
        </div>
        <div class="df-card-foot">
          <button class="bk-btn bk-btn-ghost bk-btn-sm" data-goto-op="${o.id}"
                  style="font-size:0.78rem;color:var(--ink-3)">去练习 →</button>
        </div>
      </div>
    `;
  }
}

function esc(s) {
  return String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;')
    .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
