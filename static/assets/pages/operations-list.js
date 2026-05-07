import { API } from '../api.js';
import { opCategoryNo, opSectionNo } from './_op-helpers.js?v=20260428-2';

const OPS_FILTER_KEY = 'ops:list-filter:v1';

export async function renderOperationsList(host) {
  host.innerHTML = `
    <div class="bk-card" style="margin-bottom:14px;padding:14px 18px">
      <div style="display:flex;align-items:center;gap:16px;flex-wrap:wrap">
        <div style="flex:1;min-width:240px">
          <div class="label" style="margin-bottom:2px">操作实训</div>
          <div style="display:flex;align-items:baseline;gap:12px;flex-wrap:wrap">
            <h2 style="margin:0;font-size:1.15rem">实操训练台</h2>
            <span class="small" style="color:var(--ink-3)">代码题进 Jupyter 三栏训练台；文档题按评分项作答，提交后由 AI 自动判分。</span>
          </div>
        </div>
        <div id="ops-drafts-pill"></div>
      </div>
      <div class="bk-filter-bar" id="ops-filter" style="margin-top:12px;padding-top:10px;border-top:1px solid var(--line)"></div>
    </div>
    <div id="ops-grid" class="bk-ops-grid"><p class="small">加载…</p></div>
  `;

  let allOps = [];
  let categories = [];
  let activeIds = new Set();
  const state = { category: 'all', type: 'all' };

  try {
    const [catD, listD, draftsD] = await Promise.all([
      API.operationCategories(),
      API.operations(),
      API.opActiveDrafts().catch(() => ({ drafts: [] })),
    ]);
    categories = catD.categories || [];
    allOps = listD.questions || [];
    const completedIds = new Set(allOps.filter((q) => q.practice_result).map((q) => q.id));
    activeIds = new Set((draftsD.drafts || [])
      .map((d) => d.operation_id)
      .filter((id) => !completedIds.has(id)));
  } catch (e) {
    host.querySelector('#ops-grid').innerHTML =
      `<div style="color:var(--err)">${escapeHtml(e.message)}</div>`;
    return;
  }

  Object.assign(state, readFilterState(categories));
  persistFilterState(state);
  renderDraftsPill();
  renderFilters();
  renderGrid();

  function renderDraftsPill() {
    const slot = host.querySelector('#ops-drafts-pill');
    if (!activeIds.size) { slot.innerHTML = ''; return; }
    slot.innerHTML = `
      <button type="button" id="ops-pill-btn" title="跳到第一道进行中的题"
              style="display:inline-flex;align-items:center;gap:8px;padding:6px 14px;
                     border-radius:999px;border:1px solid var(--warn);
                     background:var(--warn-soft);color:var(--warn);
                     font-size:0.82rem;font-weight:500;cursor:pointer;
                     transition:background .15s,transform .15s"
              onmouseover="this.style.background='rgba(217,119,6,0.14)'"
              onmouseout="this.style.background='var(--warn-soft)'">
        <span>⏳</span>
        <span>${activeIds.size} 道未提交</span>
        <span style="opacity:.7">→</span>
      </button>
    `;
    slot.querySelector('#ops-pill-btn').addEventListener('click', () => {
      const first = host.querySelector('.bk-ops-card[data-active="1"]');
      if (first) first.scrollIntoView({ behavior: 'smooth', block: 'center' });
    });
  }

  function renderFilters() {
    const bar = host.querySelector('#ops-filter');
    const chipsCat = ['all', ...categories.map((c) => c.name)].map((c) => {
      const no = c === 'all' ? '' : opCategoryNo(c);
      const label = c === 'all'
        ? '全部'
        : (no ? `<span style="opacity:.7;margin-right:4px">${no}</span>${escapeHtml(c)}` : escapeHtml(c));
      return `
        <button class="bk-chip ${state.category === c ? 'on' : ''}" data-cat="${escapeHtml(c)}">
          ${label}
        </button>
      `;
    }).join('');
    const chipsType = `
      <span class="bk-chip-divider">|</span>
      <button class="bk-chip ${state.type === 'all' ? 'on' : ''}" data-type="all">全部题型</button>
      <button class="bk-chip ${state.type === 'code' ? 'on' : ''}" data-type="code">代码题</button>
      <button class="bk-chip ${state.type === 'doc' ? 'on' : ''}" data-type="doc">文档题</button>
    `;
    bar.innerHTML = chipsCat + chipsType;
    bar.querySelectorAll('[data-cat]').forEach((btn) =>
      btn.addEventListener('click', () => {
        state.category = btn.dataset.cat;
        persistFilterState(state);
        renderFilters();
        renderGrid();
      }),
    );
    bar.querySelectorAll('[data-type]').forEach((btn) =>
      btn.addEventListener('click', () => {
        state.type = btn.dataset.type;
        persistFilterState(state);
        renderFilters();
        renderGrid();
      }),
    );
  }

  function renderGrid() {
    const ops = allOps.filter((q) =>
      (state.category === 'all' || q.category === state.category) &&
      (state.type === 'all' || q.type === state.type),
    );
    const grid = host.querySelector('#ops-grid');
    if (!ops.length) {
      grid.innerHTML = `<p class="small">没有符合条件的操作题。</p>`;
      return;
    }
    grid.innerHTML = ops.map(cardHtml).join('');
    grid.querySelectorAll('[data-open]').forEach((el) =>
      el.addEventListener('click', () => {
        persistFilterState(state);
        window.location.hash = el.dataset.session
          ? `#/ops/${el.dataset.open}?session=${el.dataset.session}`
          : `#/ops/${el.dataset.open}`;
      }),
    );
  }

  function cardHtml(q) {
    const typeLabel = q.type === 'code' ? '代码' : '文档';
    const isActive = activeIds.has(q.id) && !q.practice_result;
    const hasResult = !!q.practice_result;
    const resultTone = scoreTone(q.practice_result);
    const sessionId = q.practice_result?.session_id || '';
    const resultBadge = renderResultBadge(q.practice_result);
    const activeBadge = isActive
      ? `<span class="bk-ops-active">⏳ 进行中</span>`
      : '';
    return `
      <div class="bk-ops-card ${hasResult ? `has-score score-${resultTone}` : ''} ${isActive ? 'has-active' : ''}" data-open="${q.id}" data-session="${escapeHtml(sessionId)}" data-active="${isActive ? 1 : 0}" tabindex="0">
        ${resultBadge}
        ${activeBadge}
        <div class="bk-ops-head">
          <span class="bk-ops-no" title="题目编号 #${q.id}">${opSectionNo(q.id) || '#' + q.id}</span>
          <span class="bk-chip on" style="pointer-events:none">${typeLabel}</span>
          <span class="small bk-ops-cat">${escapeHtml(q.category)}</span>
        </div>
        <div class="bk-ops-title">${escapeHtml(q.title || '')}</div>
        <div class="bk-ops-meta">${escapeHtml(q.time_limit || '')} · ${q.total_score || ''}分</div>
        <p class="bk-ops-scenario small">${escapeHtml((q.scenario || '').slice(0, 180))}${(q.scenario || '').length > 180 ? '…' : ''}</p>
      </div>
    `;
  }
}

function renderResultBadge(result) {
  if (!result) return '';
  const tone = scoreTone(result);
  const score = fmtScore(result.score);
  const total = fmtScore(result.total);
  return `
    <span class="bk-ops-score ${tone}" title="最近一次提交：${escapeHtml(score)} / ${escapeHtml(total)} 分">
      <span class="dot"></span>
      <strong>${escapeHtml(score)}</strong><span class="bk-ops-score-total">/${escapeHtml(total)}分</span>
    </span>
  `;
}

function scoreTone(result) {
  if (!result) return '';
  const pct = result.score_pct ?? 0;
  if (pct >= 85) return 'ok';
  if (pct >= 60) return 'warn';
  return 'err';
}

function fmtScore(n) {
  const v = Number(n || 0);
  return Number.isInteger(v) ? String(v) : v.toFixed(1);
}

function readFilterState(categories) {
  const validCategories = new Set(['all', ...categories.map((c) => c.name)]);
  const validTypes = new Set(['all', 'code', 'doc']);
  const params = new URLSearchParams((window.location.hash.split('?')[1] || '').split('#')[0]);
  const saved = readSavedFilter();
  const category = params.get('cat') || saved.category || 'all';
  const type = params.get('type') || saved.type || 'all';
  return {
    category: validCategories.has(category) ? category : 'all',
    type: validTypes.has(type) ? type : 'all',
  };
}

function readSavedFilter() {
  try {
    return JSON.parse(sessionStorage.getItem(OPS_FILTER_KEY) || '{}') || {};
  } catch {
    return {};
  }
}

function persistFilterState(state) {
  try {
    sessionStorage.setItem(OPS_FILTER_KEY, JSON.stringify({
      category: state.category,
      type: state.type,
    }));
  } catch {
    /* sessionStorage may be unavailable in private contexts. */
  }

  const params = new URLSearchParams();
  if (state.category && state.category !== 'all') params.set('cat', state.category);
  if (state.type && state.type !== 'all') params.set('type', state.type);
  const nextHash = params.toString() ? `#/ops?${params.toString()}` : '#/ops';
  if (window.location.hash !== nextHash) {
    history.replaceState(null, '', nextHash);
  }
}

function escapeHtml(s) {
  return String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;')
    .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
