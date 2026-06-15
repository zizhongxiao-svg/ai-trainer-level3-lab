import { API } from '../api.js';

const STATE = { tree: null, currentKp: null, filterType: null, onlyMode: null, cards: new Map() };

function parseHashParams(hash) {
  const qi = hash.indexOf('?');
  if (qi < 0) return {};
  return Object.fromEntries(new URLSearchParams(hash.slice(qi + 1)));
}

export async function renderTheory(host, ctx) {
  const params = parseHashParams(ctx.hash || window.location.hash);
  host.innerHTML = `<p class="label" style="padding:24px 0">加载考纲…</p>`;
  try { STATE.tree = await API.curriculum(); }
  catch (e) { host.innerHTML = `<div class="bk-card" style="color:var(--err)">${e.message}</div>`; return; }

  if (params.kp === 'all') {
    STATE.currentKp = 'all';
  } else if (params.kp) {
    STATE.currentKp = Number(params.kp);
  } else if (params.section) {
    const s = STATE.tree.find(x => String(x.id) === params.section);
    STATE.currentKp = s && s.kps[0] ? s.kps[0].id : null;
  } else if (!STATE.currentKp && STATE.tree.length) {
    STATE.currentKp = 'all';
  }
  if (params.only === 'wrong' || params.only === 'corrected' || params.only === 'unanswered') {
    STATE.onlyMode = params.only;
  }

  host.innerHTML = `
    <div class="bk-theory">
      <aside class="bk-theory-side bk-card" id="theory-side" style="padding:10px"></aside>
      <main id="theory-main"></main>
      <aside class="bk-theory-aside" id="theory-qnav"></aside>
    </div>
  `;
  renderSide();
  await renderMain();
}

function renderSide() {
  const el = document.getElementById('theory-side');
  if (!el) return;
  const grandTotal = STATE.tree.reduce((a, s) => a + s.kps.reduce((b, k) => b + k.total, 0), 0);
  const allOn = STATE.currentKp === 'all';
  const allEntry = `
    <div class="bk-navtree-section">
      <div class="bk-navtree-kp ${allOn?'on':''}" data-kp="all" style="font-weight:600">
        <span>全部题目</span>
        <span class="count" style="margin-left:auto">${grandTotal}</span>
      </div>
    </div>
  `;
  el.innerHTML = allEntry + STATE.tree.map(section => {
    const total = section.kps.reduce((a, k) => a + k.total, 0);
    const mastered = section.kps.reduce((a, k) => a + (k.mastered || 0), 0);
    const collapsed = section.kps.length === 1 || section.kps.every(k => k.title === '综合');
    if (collapsed) {
      const firstKp = section.kps[0];
      const kpId = firstKp ? firstKp.id : '';
      const pct = total ? Math.round(mastered / total * 100) : 0;
      const on = firstKp && STATE.currentKp === firstKp.id;
      return `
        <div class="bk-navtree-section">
          <div class="bk-navtree-kp ${on?'on':''}" data-kp="${kpId}" style="font-weight:600">
            <span>${escapeHtml(section.title)}</span>
            <div class="bar"><div class="fill" style="width:${pct}%"></div></div>
            <span class="count" style="margin-left:auto">${total}</span>
          </div>
        </div>
      `;
    }
    return `
      <div class="bk-navtree-section">
        <div class="bk-navtree-section-title">
          <span>${escapeHtml(section.title)}</span>
          <span class="count">${total}</span>
        </div>
        ${section.kps.map(k => `
          <div class="bk-navtree-kp ${STATE.currentKp===k.id?'on':''}" data-kp="${k.id}">
            <span>${escapeHtml(k.title)}</span>
            <div class="bar"><div class="fill" style="width:${k.total?Math.round((k.mastered||0)/k.total*100):0}%"></div></div>
          </div>
        `).join('')}
      </div>
    `;
  }).join('');
  el.querySelectorAll('[data-kp]').forEach(b => {
    b.addEventListener('click', () => {
      const v = b.dataset.kp;
      STATE.currentKp = (v === 'all') ? 'all' : Number(v);
      renderSide();
      renderMain();
    });
  });
}

async function renderMain() {
  const el = document.getElementById('theory-main');
  if (!el || !STATE.currentKp) { if (el) el.innerHTML = '<p class="small">请选择一个知识点</p>'; return; }

  if (!el.querySelector('.bk-toolbar')) {
    el.innerHTML = `
      <div class="bk-theory-head" style="display:none;align-items:center;justify-content:space-between;margin-bottom:10px"></div>
      <div class="bk-toolbar">
        <span class="bk-chip" data-type="">全部题型</span>
        <span class="bk-chip" data-type="judge">判断</span>
        <span class="bk-chip" data-type="single">单选</span>
        <span class="bk-chip" data-type="multi">多选</span>
        <span style="width:1px;height:16px;background:var(--line);margin:0 6px"></span>
        <span class="bk-chip" data-only="">全部</span>
        <span class="bk-chip" data-only="unanswered">未答</span>
        <span class="bk-chip" data-only="wrong">仅错题</span>
        <span class="bk-chip" data-only="corrected">已订正</span>
        <span class="bk-chip" data-only="flagged">★ 我的标记</span>
        <span style="flex:1"></span>
        <button class="bk-btn bk-btn-primary bk-btn-sm" data-batch-submit disabled style="margin-left:auto">批量提交 (0)</button>
      </div>
      <p class="small" id="theory-only-hint-wrong" style="color:var(--ink-3);margin:6px 2px 10px;display:none">
        错题清理：按<strong>最近一次</strong>作答判定 —— 最后一次错了 → 进错题集；在这里重新做对 1 次 → 自动移出；再错又会回来。
      </p>
      <p class="small" id="theory-only-hint-corrected" style="color:var(--ink-3);margin:6px 2px 10px;display:none">
        二刷三刷：曾经做错过、最近一次答对的题。重新答错会回到错题集。
      </p>
      <div id="theory-list"></div>
    `;
    el.querySelectorAll('[data-type]').forEach(b => b.addEventListener('click', () => {
      STATE.filterType = b.dataset.type || null;
      renderMain();
    }));
    el.querySelectorAll('[data-only]').forEach(b => b.addEventListener('click', () => {
      STATE.onlyMode = b.dataset.only || null;
      renderMain();
    }));
    el.querySelector('[data-batch-submit]')?.addEventListener('click', batchSubmitClick);
  }

  el.querySelectorAll('[data-type]').forEach(b => {
    b.classList.toggle('on', (b.dataset.type || null) === STATE.filterType);
  });
  el.querySelectorAll('[data-only]').forEach(b => {
    b.classList.toggle('on', (b.dataset.only || null) === STATE.onlyMode);
  });

  const head = el.querySelector('.bk-theory-head');
  if (head) {
    const section = (STATE.currentKp === 'all') ? null : findSectionByKp(STATE.currentKp);
    if (section) {
      const total = section.kps.reduce((a, k) => a + k.total, 0);
      head.innerHTML = `
        <div class="label" style="color:var(--ink-2)">当前模块 · <b>${escapeHtml(section.title)}</b> <span class="small" style="color:var(--ink-3);margin-left:6px">${total} 题</span></div>
        <button class="bk-btn bk-btn-ghost bk-btn-sm" data-reset-section style="color:var(--err);border-color:rgba(220,80,80,.35)">重置本模块</button>
      `;
      head.style.display = 'flex';
      head.querySelector('[data-reset-section]').onclick = () => resetSection(section);
    } else {
      head.innerHTML = '';
      head.style.display = 'none';
    }
  }
  const hintWrong = document.getElementById('theory-only-hint-wrong');
  if (hintWrong) hintWrong.style.display = STATE.onlyMode === 'wrong' ? '' : 'none';
  const hintCorrected = document.getElementById('theory-only-hint-corrected');
  if (hintCorrected) hintCorrected.style.display = STATE.onlyMode === 'corrected' ? '' : 'none';

  const list = document.getElementById('theory-list');
  list.innerHTML = '<p class="small">加载题目…</p>';

  const params = {};
  if (STATE.filterType) params.q_type = STATE.filterType;
  if (STATE.onlyMode) params.only = STATE.onlyMode;
  let res;
  try {
    res = (STATE.currentKp === 'all')
      ? await API.allQuestions(params)
      : await API.kpQuestions(STATE.currentKp, params);
  }
  catch (e) { list.innerHTML = `<div style="color:var(--err)">${e.message}</div>`; return; }

  renderQuestionList(res.questions);
}

function renderQuestionList(questions) {
  renderQnav(questions);
  const el = document.getElementById('theory-list');
  if (!questions.length) { el.innerHTML = '<p class="small">没有符合条件的题目</p>'; return; }

  el.innerHTML = questions.map(q => renderQuestion(q)).join('');

  STATE.cards.clear();
  el.querySelectorAll('[data-qid]').forEach(card => {
    const qid = Number(card.dataset.qid);
    const q = questions.find(x => x.id === qid);
    if (!q) return;
    const isWrongClear = STATE.onlyMode === 'wrong' && q.user_last_answer && !q.user_last_answer.is_correct;
    const isCorrectedRetry = STATE.onlyMode === 'corrected';
    const isFlaggedRetry = STATE.onlyMode === 'flagged';
    const clearForRetry = isWrongClear || isCorrectedRetry || isFlaggedRetry;
    const state = {
      selected: clearForRetry ? [] : (q.user_last_answer ? [...q.user_last_answer.selected] : []),
      done: !!q.user_last_answer && !clearForRetry,
      card,
      question: q,
    };
    STATE.cards.set(qid, state);

    const flagBtn = card.querySelector('[data-flag]');
    if (flagBtn) {
      flagBtn.addEventListener('click', async () => {
        if (flagBtn.disabled) return;
        flagBtn.disabled = true;
        const wasFlagged = flagBtn.getAttribute('aria-pressed') === 'true';
        try {
          if (wasFlagged) await API.unflagQuestion(qid);
          else await API.flagQuestion(qid);
          q.flagged = !wasFlagged;
          flagBtn.setAttribute('aria-pressed', String(q.flagged));
          flagBtn.textContent = q.flagged ? '★ 已标记' : '☆ 标记';
          flagBtn.title = q.flagged ? '取消标记' : '标记本题';
          flagBtn.style.color = q.flagged ? '#f0a040' : '';
          flagBtn.style.borderColor = q.flagged ? 'rgba(240,160,64,.45)' : '';
          if (STATE.onlyMode === 'flagged' && !q.flagged) await renderMain();
        } catch (e) {
          alert('标记失败：' + e.message);
        } finally {
          flagBtn.disabled = false;
        }
      });
    }

    const peekBtn = card.querySelector('[data-show-answer]');
    const peekEl = card.querySelector('[data-peek]');
    if (peekBtn && peekEl) {
      peekBtn.addEventListener('click', () => {
        const open = peekBtn.getAttribute('aria-pressed') === 'true';
        peekBtn.setAttribute('aria-pressed', String(!open));
        peekEl.style.display = open ? 'none' : '';
        peekBtn.textContent = open ? '答案' : '隐藏';
      });
    }

    const allLabels = q.options.map(o => o.label);
    const allBtn = card.querySelector('[data-allpick]');
    const syncAllBtn = () => {
      if (!allBtn) return;
      const all = allLabels.length > 0 && allLabels.every(l => state.selected.includes(l));
      allBtn.textContent = all ? '清空' : '全选';
      allBtn.classList.toggle('is-on', all);
      allBtn.setAttribute('aria-pressed', String(all));
    };

    card.querySelectorAll('.bk-opt').forEach(opt => {
      opt.addEventListener('click', () => {
        if (state.done) return;
        const label = opt.dataset.label;
        if (q.type === 'judge' || q.type === 'single') {
          state.selected = state.selected[0] === label ? [] : [label];
        } else {
          const i = state.selected.indexOf(label);
          if (i >= 0) state.selected.splice(i, 1); else state.selected.push(label);
        }
        card.querySelectorAll('.bk-opt').forEach(o => {
          o.classList.toggle('picked', state.selected.includes(o.dataset.label));
        });
        card.querySelector('[data-submit]').disabled = !state.selected.length;
        const pickedEl = card.querySelector('[data-picked]');
        if (pickedEl) pickedEl.textContent = `已选 ${state.selected.join(', ') || '—'}`;
        syncAllBtn();
        refreshBatchCount();
      });
    });

    if (allBtn) {
      allBtn.addEventListener('click', () => {
        if (state.done) return;
        const all = allLabels.every(l => state.selected.includes(l));
        state.selected = all ? [] : [...allLabels];
        card.querySelectorAll('.bk-opt').forEach(o => {
          o.classList.toggle('picked', state.selected.includes(o.dataset.label));
        });
        const submitBtn2 = card.querySelector('[data-submit]');
        if (submitBtn2) submitBtn2.disabled = !state.selected.length;
        const pickedEl = card.querySelector('[data-picked]');
        if (pickedEl) pickedEl.textContent = `已选 ${state.selected.join(', ') || '—'}`;
        syncAllBtn();
        refreshBatchCount();
      });
      syncAllBtn();
    }

    const submitBtn = card.querySelector('[data-submit]');
    if (submitBtn) {
      submitBtn.disabled = !state.selected.length;
      submitBtn.addEventListener('click', async () => {
        if (!state.selected.length) return;
        submitBtn.disabled = true;
        const originalText = submitBtn.textContent;
        submitBtn.textContent = '提交中…';
        try {
          const r = await API.submitAnswer(qid, state.selected);
          state.done = true;
          refreshBatchCount();
          q.user_last_answer = { selected: r.user_answer, is_correct: r.is_correct };
          q.attempts = (q.attempts || 0) + 1;
          markQuestionDone(card, q, r.user_answer, r.is_correct);
          updateQnavCell(qid, r.is_correct);
          if (STATE.onlyMode === 'wrong' && r.is_correct) {
            await renderMain();
            return;
          }
          if (STATE.onlyMode === 'corrected' && !r.is_correct) {
            await renderMain();
            return;
          }
          card.querySelector('[data-retry-wrong]')?.addEventListener('click', () => renderMain());
        } catch (e) {
          alert(e.message);
          submitBtn.textContent = originalText;
          submitBtn.disabled = false;
        }
      });
    }
  });
  refreshBatchCount();
}

function markQuestionDone(card, q, userSelected, isCorrect) {
  card.querySelectorAll('.bk-opt').forEach(opt => {
    const label = opt.dataset.label;
    const inAns = q.answer.includes(label);
    const inSel = userSelected.includes(label);
    opt.classList.remove('picked');
    if (inAns) opt.classList.add('right');
    else if (inSel) opt.classList.add('miss');
  });
  const footer = card.querySelector('[data-footer]');
  if (footer) {
    footer.innerHTML = isCorrect
      ? `<span class="bk-tag bk-tag-ok">回答正确</span>`
      : `<span class="bk-tag bk-tag-err">回答错误</span>
         <span class="small">正确答案 <b>${q.answer.join(', ')}</b></span>
         ${STATE.onlyMode === 'wrong' ? '<button class="bk-btn bk-btn-ghost bk-btn-sm" data-retry-wrong>再做一次</button>' : ''}`;
  }
  const head = card.querySelector('.bk-question-head');
  if (head && !head.querySelector('[data-attempts]')) {
    const span = document.createElement('span');
    span.className = 'small';
    span.dataset.attempts = '1';
    span.textContent = `练习 ${q.attempts} 次`;
    head.appendChild(span);
  } else if (head) {
    const span = head.querySelector('[data-attempts]');
    if (span) span.textContent = `练习 ${q.attempts} 次`;
  }
}

function renderQnav(questions) {
  const el = document.getElementById('theory-qnav');
  if (!el) return;
  if (!questions.length) { el.innerHTML = ''; STATE.qnavCounts = null; return; }

  let answered = 0, correct = 0, wrong = 0;
  for (const q of questions) {
    if (q.user_last_answer) {
      answered++;
      if (q.user_last_answer.is_correct) correct++; else wrong++;
    }
  }
  STATE.qnavCounts = { total: questions.length, correct, wrong };
  const cells = questions.map((q, i) => {
    const ua = q.user_last_answer;
    let cls = 'bk-exam-cell';
    if (ua) cls += ua.is_correct ? ' is-correct' : ' is-wrong';
    const title = `第 ${i + 1}/${questions.length} 题 · No.${q.id} · ${typeLabel(q.type)}${ua ? (ua.is_correct ? ' · 已答对' : ' · 答错') : ' · 未答'}`;
    return `<button class="${cls}" data-jump="${q.id}" title="${title}">${q.id}</button>`;
  }).join('');

  el.innerHTML = `
    <div class="bk-qnav">
      <div class="bk-qnav-head">
        <div class="label">题号导览</div>
        <div class="small">${answered}/${questions.length}</div>
      </div>
      <div class="bk-qnav-stats">
        <div class="bk-qnav-stats-row">
          <span><span class="dot dot-correct"></span>对 ${correct}</span>
          <span><span class="dot dot-wrong"></span>错 ${wrong}</span>
          <span><span class="dot dot-empty"></span>未答 ${questions.length - answered}</span>
        </div>
      </div>
      <div class="bk-qnav-grid">${cells}</div>
    </div>
  `;

  el.querySelectorAll('[data-jump]').forEach(b => {
    b.addEventListener('click', () => {
      const target = document.querySelector(`[data-qid="${b.dataset.jump}"]`);
      if (target) target.scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
  });
}

function updateQnavCell(qid, isCorrect) {
  const cell = document.querySelector(`#theory-qnav [data-jump="${qid}"]`);
  if (!cell || !STATE.qnavCounts) return;
  const wasCorrect = cell.classList.contains('is-correct');
  const wasWrong = cell.classList.contains('is-wrong');
  cell.classList.remove('is-correct', 'is-wrong');
  cell.classList.add(isCorrect ? 'is-correct' : 'is-wrong');

  const counts = STATE.qnavCounts;
  if (wasCorrect) counts.correct--;
  if (wasWrong) counts.wrong--;
  if (isCorrect) counts.correct++; else counts.wrong++;

  const { total, correct: c, wrong: w } = counts;
  const row = document.querySelector('#theory-qnav .bk-qnav-stats-row');
  if (row) {
    const spans = row.querySelectorAll(':scope > span');
    if (spans[0]) spans[0].innerHTML = `<span class="dot dot-correct"></span>对 ${c}`;
    if (spans[1]) spans[1].innerHTML = `<span class="dot dot-wrong"></span>错 ${w}`;
    if (spans[2]) spans[2].innerHTML = `<span class="dot dot-empty"></span>未答 ${total - c - w}`;
  }
  const head = document.querySelector('#theory-qnav .bk-qnav-head .small');
  if (head) head.textContent = `${c + w}/${total}`;
}

function renderQuestion(q) {
  const hasLast = !!q.user_last_answer;
  const lastWrong = hasLast && !q.user_last_answer.is_correct;
  const wrongClearMode = STATE.onlyMode === 'wrong' && lastWrong;
  const correctedRetryMode = STATE.onlyMode === 'corrected';
  const flaggedRetryMode = STATE.onlyMode === 'flagged';
  const done = hasLast && !wrongClearMode && !correctedRetryMode && !flaggedRetryMode;
  const ok = done && q.user_last_answer.is_correct;
  const selected = done ? q.user_last_answer.selected : [];
  const showAllToggle = q.type === 'multi' && !done;

  const optHtml = q.options.map(o => {
    let cls = '';
    if (done) {
      const inAns = q.answer.includes(o.label);
      const inSel = selected.includes(o.label);
      if (inAns) cls = 'right';
      else if (inSel && !inAns) cls = 'miss';
    } else if (selected.includes(o.label)) {
      cls = 'picked';
    }
    return `<div class="bk-opt ${cls}" data-label="${o.label}">
      <div class="bk-opt-lbl">${o.label}</div>
      <div class="bk-opt-txt">${escapeHtml(o.text)}</div>
    </div>`;
  }).join('');

  const flagged = !!q.flagged;
  return `
    <div class="bk-question" data-qid="${q.id}">
      <div class="bk-question-head">
        <span class="bk-question-id">No.${q.id}</span>
        <span class="bk-question-type">${typeLabel(q.type)}</span>
        ${q.attempts>0 ? `<span class="small" data-attempts>练习 ${q.attempts} 次</span>` : ''}
        <span style="margin-left:auto;display:flex;gap:6px;align-items:center">
          ${showAllToggle ? `<button class="bk-btn bk-btn-ghost bk-btn-sm" data-allpick aria-pressed="false" title="一键全选 / 清空">全选</button>` : ''}
          <button class="bk-btn bk-btn-ghost bk-btn-sm" data-flag aria-pressed="${flagged}" title="${flagged?'取消标记':'标记本题'}" style="${flagged?'color:#f0a040;border-color:rgba(240,160,64,.45)':''}">${flagged?'★ 已标记':'☆ 标记'}</button>
          <button class="bk-btn bk-btn-ghost bk-btn-sm" data-show-answer aria-pressed="false" title="显示答案（不影响作答）">答案</button>
        </span>
      </div>
      <div class="bk-question-body">${escapeHtml(q.text)}</div>
      ${optHtml}
      <div data-peek class="small" style="display:none;margin-top:10px;color:var(--ink-2)">正确答案 <b>${q.answer.join(', ')}</b></div>
      <div data-footer style="display:flex;gap:10px;align-items:center;margin-top:14px">
        ${done ? `
          <span class="bk-tag ${ok?'bk-tag-ok':'bk-tag-err'}">${ok?'回答正确':'回答错误'}</span>
          ${!ok ? `<span class="small">正确答案 <b>${q.answer.join(', ')}</b></span>` : ''}
        ` : `
          <button class="bk-btn bk-btn-primary bk-btn-sm" data-submit disabled>提交</button>
          <span class="small" data-picked>${wrongClearMode ? '重新作答，答对后移出错题本' : `已选 ${selected.join(', ') || '—'}`}</span>
        `}
      </div>
    </div>
  `;
}

function typeLabel(t) { return t === 'judge' ? '判断' : t === 'single' ? '单选' : '多选'; }
function escapeHtml(s) { return String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); }

function findSectionByKp(kpId) {
  if (!STATE.tree) return null;
  for (const s of STATE.tree) {
    for (const k of s.kps) if (k.id === kpId) return s;
  }
  return null;
}

async function resetSection(section) {
  if (!confirm(`将清空模块「${section.title}」的所有理论作答记录（含错题、掌握度）。\n\n此操作不可撤销，确认继续？`)) return;
  try {
    const r = await API.resetTheory({ section_id: section.id });
    alert(`已重置（删除 ${r.deleted} 条记录）`);
    STATE.tree = await API.curriculum();
    renderSide();
    await renderMain();
  } catch (e) {
    alert('重置失败：' + e.message);
  }
}

function refreshBatchCount() {
  const btn = document.querySelector('[data-batch-submit]');
  if (!btn) return;
  let n = 0;
  for (const s of STATE.cards.values()) {
    if (!s.done && s.selected.length > 0) n++;
  }
  btn.textContent = `批量提交 (${n})`;
  btn.disabled = n === 0;
  btn.title = n === 0 ? '先选择题目作答' : `提交已作答的 ${n} 道题`;
}

async function batchSubmitClick() {
  const btn = document.querySelector('[data-batch-submit]');
  if (!btn || btn.disabled) return;
  const items = [];
  for (const [qid, s] of STATE.cards) {
    if (!s.done && s.selected.length > 0) {
      items.push({ question_id: qid, selected: [...s.selected] });
    }
  }
  if (!items.length) return;

  btn.disabled = true;
  const originalText = btn.textContent;
  btn.textContent = '提交中…';
  try {
    const res = await API.batchSubmitAnswers(items);
    let okCount = 0, errCount = 0;
    for (const r of res.results) {
      const s = STATE.cards.get(r.question_id);
      if (!s) continue;
      s.done = true;
      s.question.user_last_answer = { selected: r.user_answer, is_correct: r.is_correct };
      s.question.attempts = (s.question.attempts || 0) + 1;
      markQuestionDone(s.card, s.question, r.user_answer, r.is_correct);
      updateQnavCell(r.question_id, r.is_correct);
      if (r.is_correct) okCount++; else errCount++;
    }
    refreshBatchCount();
    const failedN = (res.errors || []).length;
    if (failedN > 0) {
      showToast(`本次提交 ${res.results.length} 题 · ${okCount} 对 ${errCount} 错（${failedN} 题失败）`, 'warn');
    } else {
      showToast(`本次提交 ${res.results.length} 题 · ${okCount} 对 ${errCount} 错`, 'ok');
    }
  } catch (e) {
    showToast(`批量提交失败：${e.message}`, 'err');
    btn.textContent = originalText;
    btn.disabled = false;
  }
}

function showToast(text, kind = 'ok') {
  let host = document.getElementById('theory-toast');
  if (!host) {
    host = document.createElement('div');
    host.id = 'theory-toast';
    host.style.cssText = 'position:fixed;top:16px;left:50%;transform:translateX(-50%);z-index:9999;display:flex;flex-direction:column;gap:8px;pointer-events:none';
    document.body.appendChild(host);
  }
  const bg = kind === 'err' ? '#c0392b' : kind === 'warn' ? '#d18b1f' : '#2c8a4a';
  const el = document.createElement('div');
  el.textContent = text;
  el.style.cssText = `background:${bg};color:#fff;padding:10px 16px;border-radius:6px;box-shadow:0 4px 12px rgba(0,0,0,.18);font-size:14px;opacity:0;transition:opacity .2s`;
  host.appendChild(el);
  requestAnimationFrame(() => { el.style.opacity = '1'; });
  setTimeout(() => {
    el.style.opacity = '0';
    setTimeout(() => el.remove(), 250);
  }, 3000);
}
