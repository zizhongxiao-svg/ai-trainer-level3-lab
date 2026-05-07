import { API } from '../api.js';
import { renderQuestionCard } from '../components/question-card.js';
import { installExamAutoSave } from './_exam-autosave.js';

// State carried across renders within one exam session
let session = null;       // {session_id, questions, deadline, ...}
let answers = new Map();  // qid -> [labels]
let flagged = new Set();  // qids marked for review (client-side only)
let currentIdx = 0;
let dirty = false;        // unsaved changes vs server
let autosaver = null;
let timerInterval = null;

export async function renderExamTake(host, ctx) {
  const sid = Number(ctx.sid);
  host.innerHTML = '<p class="label" style="padding:24px 0">加载试卷中…</p>';

  // Always pull fresh active session (fallback to start if missing)
  let payload;
  try {
    const active = await API.examActive();
    if (active.session_id === sid) {
      payload = active;
    } else {
      // Either no active or different session: tell user
      host.innerHTML = `<div class="bk-card" style="color:var(--err)">考试会话不可用，请回到入口重新开始。</div>
        <button class="bk-btn" id="back-entry" style="margin-top:12px">返回入口</button>`;
      host.querySelector('#back-entry').addEventListener('click', () =>
        window.location.hash = '#/exam'
      );
      return;
    }
  } catch (e) {
    host.innerHTML = `<div class="bk-card" style="color:var(--err)">${e.message}</div>`;
    return;
  }

  session = payload;
  answers = new Map();
  flagged = new Set();
  for (const [qid, sel] of Object.entries(payload.progress || {})) {
    answers.set(Number(qid), sel);
  }
  currentIdx = 0;
  dirty = false;

  host.innerHTML = `
    <div class="bk-exam-shell">
      <aside class="bk-exam-nav">
        <div class="bk-exam-nav-head">
          <div class="label">答题卡</div>
          <div class="small" style="color:var(--ink-2)" data-progress></div>
        </div>
        <div class="small" data-flag-summary style="color:var(--ink-3);margin-bottom:8px;display:none"></div>
        <div class="bk-exam-nav-grid" data-grid></div>
      </aside>

      <main class="bk-exam-main">
        <header class="bk-exam-bar">
          <div class="bk-exam-title">
            <div class="label" style="color:var(--ink-2)">官方模拟卷 · 第 ${session.session_id} 场</div>
            <div class="small" data-saved-status style="color:var(--ink-3)"></div>
          </div>
          <div class="bk-exam-actions">
            <button class="bk-btn bk-btn-sm" data-flag>⚑ <span data-flag-label>标记待复查</span></button>
            <div class="bk-exam-timer" data-timer>--:--</div>
            <button class="bk-btn bk-btn-sm bk-btn-ghost" data-flush>立即保存</button>
            <button class="bk-btn bk-btn-sm bk-btn-primary" data-submit>交卷</button>
          </div>
        </header>

        <section class="bk-exam-slot" data-slot></section>

        <footer class="bk-exam-foot">
          <button class="bk-btn bk-btn-lg bk-btn-nav" data-prev>← 上一题</button>
          <span class="small" data-counter style="color:var(--ink-2)"></span>
          <button class="bk-btn bk-btn-lg bk-btn-nav" data-next>下一题 →</button>
        </footer>
      </main>
    </div>
  `;

  // Set up host pushDraft for autosaver
  host.__bkPushDraft = async () => {
    if (!dirty) return;
    const list = [...answers.entries()].map(([qid, sel]) => ({ question_id: qid, selected: sel }));
    try {
      await API.examProgress(session.session_id, list);
      dirty = false;
      const status = host.querySelector('[data-saved-status]');
      if (status) status.textContent = `已保存 · ${new Date().toLocaleTimeString()}`;
    } catch (e) {
      console.warn('progress save failed', e);
    }
  };
  if (autosaver) autosaver.cancel();
  autosaver = installExamAutoSave(host, 15000);

  renderNav(host);
  renderCurrent(host);
  startTimer(host);

  host.addEventListener('bk-cell-change', (e) => {
    const { qid, selected } = e.detail;
    if (!selected.length) answers.delete(qid); else answers.set(qid, selected);
    dirty = true;
    const status = host.querySelector('[data-saved-status]');
    if (status) status.textContent = '有未保存改动…';
    renderNav(host);
  });

  host.querySelector('[data-prev]').addEventListener('click', () => move(host, -1));
  host.querySelector('[data-next]').addEventListener('click', () => move(host, +1));
  host.querySelector('[data-flag]').addEventListener('click', () => toggleFlag(host));
  host.querySelector('[data-flush]').addEventListener('click', async () => {
    dirty = true;
    await host.__bkPushDraft();
  });
  host.querySelector('[data-submit]').addEventListener('click', () => doSubmit(host));
}

function renderNav(host) {
  const grid = host.querySelector('[data-grid]');
  if (!grid) return;
  const total = session.questions.length;
  const answeredN = answers.size;
  host.querySelector('[data-progress]').textContent = `${answeredN} / ${total}`;
  const fs = host.querySelector('[data-flag-summary]');
  if (fs) {
    if (flagged.size) {
      fs.textContent = `⚑ 已标记 ${flagged.size} 题`;
      fs.style.display = '';
    } else {
      fs.style.display = 'none';
    }
  }
  grid.innerHTML = session.questions.map((q, i) => {
    const has = answers.has(q.id);
    let cls = 'bk-exam-cell';
    if (has) cls += ' is-answered';
    if (flagged.has(q.id)) cls += ' is-flagged';
    if (i === currentIdx) cls += ' is-current';
    const title = flagged.has(q.id) ? `${typeLabel(q.type)} · 已标记` : typeLabel(q.type);
    return `<button class="${cls}" data-jump="${i}" title="${title}">${i + 1}</button>`;
  }).join('');
  grid.querySelectorAll('[data-jump]').forEach(b =>
    b.addEventListener('click', () => jumpTo(host, Number(b.dataset.jump)))
  );
}

function renderCurrent(host) {
  const slot = host.querySelector('[data-slot]');
  const q = session.questions[currentIdx];
  slot.innerHTML = '';
  slot.scrollTop = 0;
  const card = renderQuestionCard(q, {
    mode: 'exam',
    selected: answers.get(q.id) || [],
    index: currentIdx + 1,
    total: session.questions.length,
  });
  slot.appendChild(card);
  requestAnimationFrame(() => {
    slot.scrollTop = 0;
    if (window.matchMedia('(max-width: 900px)').matches) {
      host.querySelector('.bk-exam-main')?.scrollIntoView({ block: 'start' });
    }
  });
  host.querySelector('[data-counter]').textContent = `${currentIdx + 1} / ${session.questions.length}`;
  host.querySelector('[data-prev]').disabled = currentIdx === 0;
  host.querySelector('[data-next]').disabled = currentIdx === session.questions.length - 1;
  const btn = host.querySelector('[data-flag]');
  const lbl = host.querySelector('[data-flag-label]');
  if (btn && lbl) {
    const on = flagged.has(q.id);
    btn.classList.toggle('is-on', on);
    lbl.textContent = on ? '已标记（点击取消）' : '标记待复查';
  }
}

function toggleFlag(host) {
  const q = session.questions[currentIdx];
  if (flagged.has(q.id)) flagged.delete(q.id);
  else flagged.add(q.id);
  renderCurrent(host);
  renderNav(host);
}

function move(host, delta) {
  const next = currentIdx + delta;
  if (next < 0 || next >= session.questions.length) return;
  currentIdx = next;
  renderCurrent(host);
  renderNav(host);
}
function jumpTo(host, idx) {
  currentIdx = idx;
  renderCurrent(host);
  renderNav(host);
}

function startTimer(host) {
  if (timerInterval) clearInterval(timerInterval);
  const deadlineMs = Date.parse((session.deadline || '').replace(' ', 'T'));
  const tick = () => {
    const remaining = Math.max(0, deadlineMs - Date.now());
    const m = Math.floor(remaining / 60000);
    const s = Math.floor((remaining % 60000) / 1000);
    const el = host.querySelector('[data-timer]');
    if (!el) { clearInterval(timerInterval); return; }
    el.textContent = `${pad(m)}:${pad(s)}`;
    if (remaining < 5 * 60000) el.classList.add('is-urgent');
    if (remaining <= 0) {
      clearInterval(timerInterval);
      el.textContent = '00:00';
      alert('考试时间已到，正在自动交卷。');
      doSubmit(host);
    }
  };
  tick();
  timerInterval = setInterval(tick, 1000);
}

async function doSubmit(host) {
  if (timerInterval) clearInterval(timerInterval);
  const unanswered = session.questions.length - answers.size;
  if (unanswered > 0) {
    if (!confirm(`还有 ${unanswered} 题未作答，确定交卷？`)) {
      startTimer(host);
      return;
    }
  }
  const list = [...answers.entries()].map(([qid, sel]) => ({ question_id: qid, selected: sel }));
  try {
    await API.examSubmit(session.session_id, list);
    if (autosaver) autosaver.cancel();
    window.location.hash = `#/exam/${session.session_id}/result`;
  } catch (e) {
    alert('交卷失败：' + e.message);
    startTimer(host);
  }
}

function pad(n) { return n < 10 ? '0' + n : '' + n; }
function typeLabel(t) { return { judge: '判', single: '单', multi: '多' }[t] || t; }
