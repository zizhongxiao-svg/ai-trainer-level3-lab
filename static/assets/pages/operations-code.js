import { API } from '../api.js?v=20260611-report-1';
import { openOpWS } from '../ws-client.js?v=20260518-kernel-heartbeat';
import { createCell } from '../components/jupyter-cell.js?v=20260602-indentcomments';
import { installAutoSave } from './_draft-autosave.js';
import { bindOperationFiles, bindSolutionGuideButton, confirmModal, escapeHtml, notifySubmitResult, opSectionNo, pickResetMode, renderFilesPanelShell, renderOperationTasks, renderSolutionGuideButton, withSubmittingOverlay } from './_op-helpers.js?v=20260610-dialogfree';
import { handleOpsUnlockError } from './_ops-unlock.js?v=20260429-2';
import { parseReportDraft, serializeReportDraft, REPORT_DRAFT_KEY } from './_report-training.js?v=20260611-report-1';
import { segmentsToCells } from './_segments-to-cells.js?v=20260601-cellfallback';

// 从 answer_sections 的 OCR 文本里提取「预期输出」：
// 模式 — 找到最后一行 print(...)，取其后内容；若其中还出现 `# ---` 分隔符
// （后面是任务文字描述），再在该处截断。找不到则返回 null。
// 前置：必须代码本身确有 print(...) 才尝试提取，否则不可能有预期输出。
function extractExpectedOutput(answerSections, codeSegments) {
  const codeHasPrint = (codeSegments || []).some((s) =>
    s && s.type === 'given' && /\bprint\s*\(/.test(String(s.code || ''))
  );
  if (!codeHasPrint) return null;
  const sec = (answerSections || []).find((s) => s && s.type === 'code');
  if (!sec) return null;
  const content = String(sec.content || '');
  const lines = content.split('\n');
  let lastPrintIdx = -1;
  for (let i = 0; i < lines.length; i++) {
    if (/\bprint\s*\(/.test(lines[i])) lastPrintIdx = i;
  }
  if (lastPrintIdx < 0) return null;
  let after = lines.slice(lastPrintIdx + 1).join('\n');
  // 常见的「输出结束、任务描述开始」分隔符（OCR 文本里的标记）
  const stoppers = ['# ---', '请勿修改答题卷', /\bIn\s*\[\s*\d*\s*\]\s*:/];
  let cutAt = after.length;
  for (const s of stoppers) {
    let idx = -1;
    if (typeof s === 'string') idx = after.indexOf(s);
    else { const m = after.match(s); if (m) idx = m.index; }
    if (idx >= 0 && idx < cutAt) cutAt = idx;
  }
  after = after.slice(0, cutAt).replace(/^[\s\n]+|[\s\n]+$/g, '');
  return after || null;
}

export async function renderOperationsCode(host, {
  id,
  examMode = false,
  examModeLabel = '实操模拟考试进行中',
  examSessionId = null,
  examIndex = null,
  examBackHash = '#/exam-ops',
  sessionId = null,
} = {}) {
  host.innerHTML = `<p class="small">加载…</p>`;

  let session, op;
  try {
    const s = sessionId ? { session_id: sessionId } : await API.opSessionCreate(Number(id));
    session = await API.opSessionGet(s.session_id);
    op = session.operation;
    if (op.type !== 'code') {
      location.hash = examMode ? `#/exam-ops/op/${id}` : `#/ops/${id}`;
      return;
    }
  } catch (e) {
    if (handleOpsUnlockError(e, () => renderOperationsCode(host, { id, examMode, examModeLabel, examSessionId, examIndex, examBackHash, sessionId }))) {
      host.innerHTML = `<div class="bk-card"><p class="small">操作题训练需要先解锁。</p></div>`;
      return;
    }
    host.innerHTML = `<div class="bk-card" style="color:var(--err)">${escapeHtml(e.message)}</div>`;
    return;
  }

  const cells = segmentsToCells(op.code_segments || []);
  const state = {
    sessionId: session.session_id,
    blanks: { ...(session.blanks_draft || {}) },
    rubricChecks: { ...(session.rubric_checks || {}) },
    submitted: session.submitted,
    selfScore: session.self_score,
    blankResults: session.blank_results || {},
    autoScore: session.auto_score || null,
    kernelReady: false,
    busy: false,
    showAnswer: false,
    fullscreen: false,
  };

  host.innerHTML = `
    ${examMode ? renderExamContextBar(examModeLabel, examSessionId, examIndex, `${opSectionNo(id) ? opSectionNo(id) + ' ' : ''}${op.title || '实操题'}`) : ''}
    <div class="bk-op-layout">
      <div class="bk-op-ctrl-strip">
        <button class="bk-op-panel-btn bk-op-back-btn" data-back-to-list title="${examMode ? '返回考试题单' : '返回操作实训列表'}">
          <span class="bk-op-panel-btn-icon">←</span>
          <span class="bk-op-panel-btn-label">返回</span>
        </button>
        <div class="bk-op-strip-sep"></div>
        <button class="bk-op-panel-btn is-active" data-panel="left" title="题目背景 / 工作任务">
          <span class="bk-op-panel-btn-icon">≡</span>
          <span class="bk-op-panel-btn-label">题目</span>
        </button>
        <button class="bk-op-panel-btn" data-panel="files" title="数据集 / 模型 / 图片素材">
          <span class="bk-op-panel-btn-icon">▦</span>
          <span class="bk-op-panel-btn-label">文件</span>
        </button>
        <button class="bk-op-panel-btn" data-panel="right" title="评分项 / 提交">
          <span class="bk-op-panel-btn-icon">✎</span>
          <span class="bk-op-panel-btn-label">评分</span>
        </button>
        <div class="bk-op-strip-sep"></div>
        <button class="bk-op-panel-btn bk-op-strip-submit" title="提交本题" ${state.submitted ? 'disabled' : ''}>
          <span class="bk-op-panel-btn-icon">✓</span>
          <span class="bk-op-panel-btn-label">${state.submitted ? '已交' : '提交'}</span>
        </button>
        <button class="bk-op-panel-btn bk-op-strip-reset" title="${state.submitted ? '撤销提交，回到草稿' : '清空当前作答'}">
          <span class="bk-op-panel-btn-icon">↻</span>
          <span class="bk-op-panel-btn-label">重置</span>
        </button>
        ${session.in_exam ? '' : `
        <button class="bk-op-panel-btn bk-op-strip-answer" title="查看参考答案">
          <span class="bk-op-panel-btn-icon">★</span>
          <span class="bk-op-panel-btn-label">答案</span>
        </button>`}
        ${renderSolutionGuideButton(op.solution_guide)}
      </div>

      <div class="bk-op-modal-bd" id="bk-op-modal-bd"></div>

      <aside class="bk-op-left" id="bk-op-left">
        <div class="bk-op-panel-hd">
          <span class="bk-op-panel-hd-title">题目</span>
          <button class="bk-op-panel-close" data-close-panel="left">✕</button>
        </div>
        <div class="bk-op-panel-content">
          <div class="bk-card">
            <div class="label">题目背景</div>
            <p class="bk-op-prose">${escapeHtml(op.scenario || '')}</p>
          </div>
          <div class="bk-card">
            <div class="label">工作任务</div>
            ${renderOperationTasks(op.tasks)}
          </div>
        </div>
      </aside>

      <aside class="bk-op-files" id="bk-op-files">
        <div class="bk-op-panel-hd">
          <span class="bk-op-panel-hd-title">题目文件</span>
          <button class="bk-op-panel-close" data-close-panel="files">✕</button>
        </div>
        <div class="bk-op-panel-content">
          ${renderFilesPanelShell('本题素材')}
        </div>
      </aside>

      <main class="bk-op-main">
        <div class="bk-nb-widget">
          <div class="bk-nb-stickybar">
            <div class="bk-nb-header">
              <span class="bk-nb-title">${examMode ? '实操考试作答' : (opSectionNo(id) || `#${id}`)} · ${escapeHtml(op.title || '实操题')}</span>
              <span class="bk-op-kstatus"><span class="bk-jcell-status is-idle"></span>Kernel 启动中…</span>
            </div>
            <div class="bk-nb-toolbar">
              <button class="bk-btn bk-btn-ghost bk-btn-sm bk-op-runall" disabled>▶▶ 全部运行</button>
              <div class="bk-nb-tb-sep"></div>
              <button class="bk-btn bk-btn-ghost bk-btn-sm bk-op-interrupt" disabled>■ 中断</button>
              <div class="bk-nb-tb-sep"></div>
              <button class="bk-btn bk-btn-ghost bk-btn-sm bk-op-fullscreen" title="切换全屏沉浸模式">⛶ 全屏</button>
              ${examMode ? `<button class="bk-btn bk-btn-ghost bk-btn-sm bk-op-exam-back" title="返回实操考试题单">返回考试</button>` : ''}
              <span class="small bk-op-draft-hint" style="margin-left:auto">草稿每 5 秒自动保存</span>
            </div>
          </div>
          <div class="bk-op-autobar" id="bk-op-autobar" style="display:none"></div>
          <div class="bk-nb-cells" id="bk-op-cells"></div>
          <div id="bk-op-report"></div>
        </div>
      </main>

      <aside class="bk-op-right" id="bk-op-right">
        <div class="bk-op-panel-hd">
          <span class="bk-op-panel-hd-title">评分 &amp; 提交</span>
          <button class="bk-op-panel-close" data-close-panel="right">✕</button>
        </div>
        <div class="bk-op-panel-content">
          <div class="bk-card">
            <div class="label">评分项（rubric）</div>
            <ul class="bk-rubric-list" id="bk-rubric-list"></ul>
          </div>
          ${session.in_exam ? `
          <p class="small" style="margin-top:12px;color:var(--ink-3)">📝 实操模拟考试进行中 · 参考答案已锁定，交卷后可在「复盘」查看。</p>
          ` : `
          <div style="margin-top:12px">
            <button class="bk-btn bk-btn-ghost bk-btn-sm bk-op-toggle-answer" style="width:100%">查看参考答案</button>
          </div>`}
          <div class="bk-card" style="margin-top:12px">
            <div class="label">提交</div>
            <p class="small" style="margin:6px 0 8px">提交后系统按 blank 自动判分（参考答案逐项比对）。</p>
            <div class="bk-op-submit-actions ${state.submitted ? 'is-single' : ''}">
              ${state.submitted ? '' : `
              <button class="bk-btn bk-btn-ghost bk-btn-sm bk-op-discard"
                      title="删除这道题的草稿，${examMode ? '回到实操考试' : '回到操作列表'}">放弃此次作答</button>`}
              <button class="bk-btn bk-btn-primary bk-op-submit"
                      ${state.submitted ? 'disabled' : ''}>
                ${state.submitted ? '已提交' : '提交'}
              </button>
            </div>
            ${state.submitted ? `<p class="small" style="margin-top:8px">得分 <b>${state.selfScore}</b> / ${op.total_score || 10} 分</p>` : ''}
          </div>
        </div>
      </aside>
    </div>
  `;

  host.querySelectorAll('[data-exam-back], .bk-op-exam-back').forEach((btn) =>
    btn.addEventListener('click', () => { window.location.hash = examBackHash; })
  );
  host.querySelector('[data-back-to-list]')?.addEventListener('click', () => {
    window.location.hash = examMode ? examBackHash : '#/ops';
  });

  bindOperationFiles(host, Number(id));
  bindSolutionGuideButton(host, Number(id), op.solution_guide);

  // ── cells ─────────────────────────────────────────────────
  const cellHost = host.querySelector('#bk-op-cells');
  const cellEls = cells.map((c, i) => {
    const el = createCell({
      id: `c${i + 1}`,
      index: i + 1,
      segments: c.segments,
      initialBlanks: state.blanks,
      onBlankInput: (blankIndex, v) => {
        state.blanks[String(blankIndex)] = v;
        host.dispatchEvent(new CustomEvent('bk-draft-dirty'));
      },
      onRun: () => runUpTo(i),
    });
    cellHost.appendChild(el);
    return el;
  });

  // ── 测试报告小作文（仅练习模式，且本题配置了 report_training）──
  const reportHost = host.querySelector('#bk-op-report');
  const reportCfg = op.report_training;
  if (reportHost && reportCfg && !examMode && !session.in_exam) {
    const rRubric = reportCfg.rubric || [];
    const draft0 = parseReportDraft(state.blanks);
    reportHost.innerHTML = `
      <div class="bk-card" style="margin-top:14px">
        <div class="label">📝 测试报告小作文 · 真考占 ${rRubric.reduce((a, r) => a + (r.points || 0), 0)} 分</div>
        <p class="small" style="margin:6px 0 10px;color:var(--ink-3)">${escapeHtml(reportCfg.prompt || '根据上方运行结果撰写测试报告。')}</p>
        ${rRubric.map((r) => `
          <div style="margin-bottom:10px">
            <div class="small" style="margin-bottom:4px"><b>${escapeHtml(r.label || r.id)}</b> · ${r.points} 分</div>
            <textarea data-rkey="${escapeHtml(r.key || r.id)}" rows="3"
              style="width:100%;resize:vertical;font:inherit;padding:8px;border:1px solid var(--line);border-radius:8px;background:var(--bg-1);color:var(--ink-1)"
              placeholder="写下你的${escapeHtml(r.label || '')}…">${escapeHtml(draft0[r.key || r.id] || '')}</textarea>
          </div>`).join('')}
        <div style="display:flex;gap:10px;align-items:center">
          <button class="bk-btn bk-btn-primary bk-btn-sm" data-report-grade>AI 判分</button>
          <span class="small" style="color:var(--ink-3)">判分不计入本题得分；点左侧「答案」可查看范文</span>
        </div>
        <div data-report-result style="display:none;margin-top:10px"></div>
        <div data-report-ref-body style="display:none;margin-top:10px;border-top:1px dashed var(--line);padding-top:8px">
          <div class="small" style="margin-bottom:6px;color:var(--ink-3)">📖 参考范文</div>
          ${rRubric.map((rr) => `
            <div class="small" style="margin-bottom:8px">
              <b>${escapeHtml(rr.label || rr.id)}</b>
              <p class="bk-op-prose" style="margin:4px 0;white-space:pre-wrap">${escapeHtml((reportCfg.reference || {})[rr.key || rr.id] || '')}</p>
            </div>`).join('')}
        </div>
      </div>
    `;
    const collectSections = () => {
      const s = {};
      reportHost.querySelectorAll('textarea[data-rkey]').forEach((t) => { s[t.dataset.rkey] = t.value; });
      return s;
    };
    reportHost.querySelectorAll('textarea[data-rkey]').forEach((t) =>
      t.addEventListener('input', () => {
        state.blanks[REPORT_DRAFT_KEY] = serializeReportDraft(collectSections());
        host.dispatchEvent(new CustomEvent('bk-draft-dirty'));
      }));
    const gradeBtn = reportHost.querySelector('[data-report-grade]');
    gradeBtn.addEventListener('click', async () => {
      const sections = collectSections();
      if (!Object.values(sections).some((v) => v.trim())) {
        alert('先写点内容再判分');
        return;
      }
      gradeBtn.disabled = true;
      gradeBtn.textContent = 'AI 判分中…';
      try {
        const r = await API.opReportGrade(state.sessionId, sections);
        const resEl = reportHost.querySelector('[data-report-result]');
        resEl.style.display = '';
        resEl.innerHTML = `
          <p style="margin:0 0 6px"><b>得分 ${r.score} / ${r.max_score}</b></p>
          ${(r.items || []).map((it) => `
            <p class="small" style="margin:2px 0">
              <span class="bk-tag ${it.earned >= it.points ? 'bk-tag-ok' : 'bk-tag-err'}">${escapeHtml(it.label || it.id)} ${it.earned}/${it.points}</span>
              ${escapeHtml(it.comment || '')}
            </p>`).join('')}
        `;
      } catch (e) {
        alert('AI 判分失败：' + (e.message || e));
      } finally {
        gradeBtn.disabled = false;
        gradeBtn.textContent = 'AI 判分';
      }
    });
  }

  // ── rubric ────────────────────────────────────────────────
  const rubricList = host.querySelector('#bk-rubric-list');
  rubricList.innerHTML = (op.rubric || []).map((r) => `
    <li class="bk-rubric-item">
      ${examMode ? `
        <span><b>${escapeHtml(r.id)}</b> · ${r.points} 分</span>
      ` : `
        <label>
          <input type="checkbox" data-rid="${escapeHtml(r.id)}" ${state.rubricChecks[r.id] ? 'checked' : ''} ${state.submitted ? 'disabled' : ''}>
          <span><b>${escapeHtml(r.id)}</b> · ${r.points} 分</span>
        </label>
      `}
      <p class="small">${escapeHtml(r.desc || '')}</p>
    </li>
  `).join('');
  rubricList.querySelectorAll('input[data-rid]').forEach((ck) =>
    ck.addEventListener('change', () => {
      state.rubricChecks[ck.dataset.rid] = ck.checked;
      host.dispatchEvent(new CustomEvent('bk-draft-dirty'));
    }),
  );

  // ── answer toggle ─────────────────────────────────────────
  const syncAnswerLabels = () => {
    const orig = host.querySelector('.bk-op-toggle-answer');
    if (orig) orig.textContent = state.showAnswer ? '隐藏参考答案' : '查看参考答案';
    const stripLbl = host.querySelector('.bk-op-strip-answer .bk-op-panel-btn-label');
    if (stripLbl) stripLbl.textContent = state.showAnswer ? '隐藏' : '答案';
  };
  const expectedOutput = extractExpectedOutput(op.answer_sections, op.code_segments);
  const toggleAnswer = () => {
    state.showAnswer = !state.showAnswer;
    cells.forEach((c, i) => {
      const el = cellEls[i];
      const hint = el.querySelector('.bk-jcell-reference');
      if (state.showAnswer) {
        if (!hint) {
          const ref = document.createElement('pre');
          ref.className = 'bk-jcell-reference';
          ref.textContent = (c.segments
            .filter((s) => s.type === 'blank')
            .map((s) => `// ${s.hint || 'blank'}\n${s.answer || ''}`)
            .join('\n'));
          el.querySelector('.bk-jcell-body').appendChild(ref);
        }
      } else if (hint) hint.remove();
    });
    // 预期输出：附在 cells 容器末尾
    const existingOut = cellHost.querySelector('.bk-op-expected-output');
    if (state.showAnswer && expectedOutput) {
      if (!existingOut) {
        const box = document.createElement('div');
        box.className = 'bk-jcell-reference bk-op-expected-output';
        box.style.cssText = 'margin-top:8px;white-space:pre-wrap;word-break:break-word';
        box.textContent = `📤 预期输出\n${expectedOutput}`;
        cellHost.appendChild(box);
      }
    } else if (existingOut) {
      existingOut.remove();
    }
    // 测试报告小作文范文：随「答案」开关一起显示
    const reportRef = host.querySelector('#bk-op-report [data-report-ref-body]');
    if (reportRef) reportRef.style.display = state.showAnswer ? '' : 'none';
    syncAnswerLabels();
  };
  host.querySelector('.bk-op-toggle-answer')?.addEventListener('click', toggleAnswer);
  host.querySelector('.bk-op-strip-answer')?.addEventListener('click', toggleAnswer);

  // ── submit ────────────────────────────────────────────────
  host.querySelector('.bk-op-submit').addEventListener('click', async () => {
    if (state.submitted) return;
    const okGo = await confirmModal({
      title: '确认提交',
      message: '提交后系统将自动按 blank 对错判分，不可再修改。',
      confirmLabel: '确认提交',
    });
    if (!okGo) return;
    const submitBtn = host.querySelector('.bk-op-submit');
    const stripBtn = host.querySelector('.bk-op-strip-submit');
    submitBtn?.setAttribute('disabled', '');
    stripBtn?.setAttribute('disabled', '');
    try {
      const resp = await withSubmittingOverlay(
        () => API.opSessionSubmit(state.sessionId, {
          blanks_draft: state.blanks,
          ...(examMode ? {} : { rubric_checks: state.rubricChecks }),
        }),
        { title: '正在提交答案', detail: '系统按 blank 自动判分，请稍候…' }
      );
      state.submitted = true;
      state.selfScore = resp.self_score ?? 0;
      state.blankResults = resp.blank_results || {};
      state.autoScore = resp.auto_score || null;
      host.querySelector('.bk-op-submit').textContent = '已提交';
      host.querySelector('.bk-op-submit').setAttribute('disabled', '');
      const stripBtn2 = host.querySelector('.bk-op-strip-submit');
      if (stripBtn2) {
        stripBtn2.setAttribute('disabled', '');
        const lbl = stripBtn2.querySelector('.bk-op-panel-btn-label');
        if (lbl) lbl.textContent = '已交';
      }
      const discardBtn = host.querySelector('.bk-op-discard');
      if (discardBtn) discardBtn.remove();
      host.querySelector('.bk-op-submit-actions')?.classList.add('is-single');
      renderAutoFeedback();
      const totalScoreVal = (op.total_score ?? state.autoScore?.total ?? 0);
      await notifySubmitResult({
        score: state.selfScore ?? 0,
        total: totalScoreVal,
        title: '本题已判分',
        detail: '代码区已逐项标注对错，可点「查看参考答案」对照。',
      });
    } catch (e) {
      submitBtn?.removeAttribute('disabled');
      stripBtn?.removeAttribute('disabled');
      await notifySubmitResult({ title: '提交失败', detail: e.message || String(e) });
    }
  });

  host.querySelector('.bk-op-strip-submit')?.addEventListener('click', () => {
    if (state.submitted) return;
    host.querySelector('.bk-op-submit')?.click();
  });

  // ── reset：弹两种模式 —— 1) 保留作答仅清状态；2) 完全清空 ──
  host.querySelector('.bk-op-strip-reset')?.addEventListener('click', async () => {
    if (examMode && state.submitted) {
      await notifySubmitResult({ title: '无法重置', detail: '考试模式不允许撤销已提交的作答。' });
      return;
    }
    const mode = await pickResetMode({
      submitted: state.submitted,
      keepHint: '清掉判分/提交状态，代码作答保留（Jupyter kernel 不重启，已运行的变量仍在内存中）。',
      clearHint: '清掉判分/提交状态 + blank 代码作答（Jupyter kernel 不动），无法撤销。',
    });
    if (!mode) return;
    try {
      await API.opSessionReset(state.sessionId, mode);
      // 阻止 beforeunload 的 autosave flush 把旧的 state.blanks 写回，
      // 否则后端刚清掉的草稿会被覆盖回去。
      host.__bkPushDraft = async () => {};
      window.location.reload();
    } catch (e) { alert('重置失败：' + (e.message || e)); }
  });

  // ── discard draft ─────────────────────────────────────────
  host.querySelector('.bk-op-discard')?.addEventListener('click', async () => {
    const okDiscard = await confirmModal({
      title: '确认放弃此次作答？',
      message: '已填写的草稿会被删除，操作不可撤销。',
      confirmLabel: '放弃作答',
    });
    if (!okDiscard) return;
    try {
      await API.opSessionDiscard(state.sessionId);
      window.location.hash = examMode ? examBackHash : '#/ops';
    } catch (e) { alert('放弃失败：' + e.message); }
  });

  // ── fullscreen toggle ─────────────────────────────────────
  host.querySelector('.bk-op-fullscreen').addEventListener('click', (ev) => {
    state.fullscreen = !state.fullscreen;
    host.classList.toggle('bk-op-fullscreen-on', state.fullscreen);
    ev.target.textContent = state.fullscreen ? '⮽ 退出全屏' : '⛶ 全屏';
  });
  // Esc 退出全屏
  const escHandler = (e) => {
    if (e.key === 'Escape' && state.fullscreen) {
      state.fullscreen = false;
      host.classList.remove('bk-op-fullscreen-on');
      const btn = host.querySelector('.bk-op-fullscreen');
      if (btn) btn.textContent = '⛶ 全屏';
    }
  };
  document.addEventListener('keydown', escHandler);
  window.addEventListener('hashchange',
    () => document.removeEventListener('keydown', escHandler), { once: true });

  // ── Panel modals ──────────────────────────────────────────
  const modalBd = host.querySelector('#bk-op-modal-bd');
  let activeModal = null;

  function openModal(pid) {
    if (activeModal) closeModal(activeModal);
    const panel = host.querySelector(`#bk-op-${pid}`);
    const btn = host.querySelector(`[data-panel="${pid}"]`);
    if (!panel) return;
    panel.classList.add('is-open');
    btn?.classList.add('is-active');
    modalBd.classList.add('is-open');
    activeModal = pid;
  }
  function closeModal(pid) {
    const panel = host.querySelector(`#bk-op-${pid}`);
    const btn = host.querySelector(`[data-panel="${pid}"]`);
    panel?.classList.remove('is-open');
    btn?.classList.remove('is-active');
    modalBd.classList.remove('is-open');
    activeModal = null;
  }

  host.querySelectorAll('[data-panel]').forEach(btn =>
    btn.addEventListener('click', () => {
      const pid = btn.dataset.panel;
      activeModal === pid ? closeModal(pid) : openModal(pid);
    })
  );
  host.querySelectorAll('[data-close-panel]').forEach(btn =>
    btn.addEventListener('click', () => closeModal(btn.dataset.closePanel))
  );
  modalBd.addEventListener('click', () => { if (activeModal) closeModal(activeModal); });

  const modalEscHandler = (e) => {
    if (e.key === 'Escape' && activeModal) closeModal(activeModal);
  };
  document.addEventListener('keydown', modalEscHandler);
  window.addEventListener('hashchange',
    () => document.removeEventListener('keydown', modalEscHandler), { once: true });

  // ── auto feedback 渲染（提交后）─────────────────────────────
  function renderAutoFeedback() {
    const bar = host.querySelector('#bk-op-autobar');
    if (!state.submitted) { bar.style.display = 'none'; return; }
    const results = state.blankResults || {};
    let ok = 0, bad = 0;
    Object.entries(results).forEach(([k, v]) => {
      (v ? ok++ : bad++);
      // 找到对应 cell 和它的 blankIndex 下标
      for (const el of cellEls) {
        if (el.$setBlankResult) el.$setBlankResult(Number(k), v);
      }
    });
    const as = state.autoScore;
    bar.innerHTML = `
      <span>自动判分：</span>
      <span class="score ok">✅ ${ok}</span>
      <span class="score bad">❌ ${bad}</span>
      ${as ? `<span class="small">得分 <b>${as.earned}</b> / ${as.total} 分</span>` : ''}
    `;
    bar.style.display = 'flex';
    // 锁定已提交后的输入（兼容模板内联输入框与 legacy 整段 textarea 两种形态）
    cellEls.forEach((el) => {
      el.querySelectorAll('textarea.bk-jcell-blank, textarea.bk-jcell-blank-input')
        .forEach((t) => t.setAttribute('readonly', ''));
    });
  }
  if (state.submitted) renderAutoFeedback();

  const runAllBtn = host.querySelector('.bk-op-runall');
  const interruptBtn = host.querySelector('.bk-op-interrupt');
  function setRunAllState(mode) {
    if (!runAllBtn) return;
    runAllBtn.classList.toggle('is-running', mode === 'running');
    runAllBtn.setAttribute('aria-busy', mode === 'running' ? 'true' : 'false');
    runAllBtn.textContent = mode === 'running' ? '⏳ 运行中…' : '▶▶ 全部运行';
    if (mode === 'ready') runAllBtn.removeAttribute('disabled');
    else runAllBtn.setAttribute('disabled', '');
  }

  // ── WS ───────────────────────────────────────────────────
  const ws = openOpWS(state.sessionId, {
    ready: () => {
      state.kernelReady = true;
      host.querySelector('.bk-op-kstatus').innerHTML =
        `<span class="bk-jcell-status is-idle"></span>Kernel ● Ready`;
      setRunAllState('ready');
    },
    stream: (m) => cellByid(m.cell_id)?.$appendStream(m.text, m.stream === 'stderr'),
    display: (m) => cellByid(m.cell_id)?.$appendDisplay(m.mime, m.data),
    execute_result: (m) => cellByid(m.cell_id)?.$appendDisplay(m.mime, m.data),
    error: (m) => {
      if (!m.cell_id) {
        state.kernelError = m.evalue || m.ename || 'Kernel 初始化失败';
        host.querySelector('.bk-op-kstatus').innerHTML =
          `<span class="bk-jcell-status is-error"></span>${escapeHtml(state.kernelError)}`;
        return;
      }
      cellByid(m.cell_id)?.$appendError(m);
      cellByid(m.cell_id)?.$setStatus('error');
    },
    done: (m) => {
      const el = cellByid(m.cell_id);
      if (el) el.$setStatus(m.status === 'error' ? 'error' : 'idle');
    },
    batch_done: () => {
      state.busy = false;
      setRunAllState('ready');
      interruptBtn?.setAttribute('disabled', '');
    },
    interrupted: () => {
      state.busy = false;
      setRunAllState('ready');
      interruptBtn?.setAttribute('disabled', '');
    },
    close: () => {
      state.busy = false;
      host.querySelector('.bk-op-kstatus').innerHTML =
        `<span class="bk-jcell-status is-error"></span>${escapeHtml(state.kernelError || 'Kernel 已断开')}`;
      setRunAllState('disabled');
      interruptBtn?.setAttribute('disabled', '');
    },
  });

  window.addEventListener('hashchange', () => ws.close(), { once: true });

  host.querySelector('.bk-op-runall').addEventListener('click', () => runUpTo(cells.length - 1));
  host.querySelector('.bk-op-interrupt').addEventListener('click', () => ws.interrupt());

  function runUpTo(lastIdx) {
    if (!state.kernelReady || state.busy) return;
    state.busy = true;
    setRunAllState('running');
    interruptBtn?.removeAttribute('disabled');
    const payload = cellEls.slice(0, lastIdx + 1).map((el) => {
      el.$clearOutput();
      el.$setStatus('busy');
      return { id: el.dataset.cellId, code: el.$composedCode() };
    });
    try { ws.execute(payload); }
    catch (e) {
      state.busy = false;
      alert('无法发送：' + e.message);
      setRunAllState('ready');
      interruptBtn?.setAttribute('disabled', '');
    }
  }

  function cellByid(cid) { return cellEls.find((e) => e.dataset.cellId === cid); }

  host.__bkState = state;
  host.__bkPushDraft = async () => {
    if (state.submitted) return;
    try {
      await API.opSessionSaveDraft(state.sessionId, {
        blanks_draft: state.blanks,
        ...(examMode ? {} : { rubric_checks: state.rubricChecks }),
      });
    } catch (e) { console.warn('draft save failed', e); }
  };

installAutoSave(host, 5000);
}

function renderExamContextBar(label, examSessionId, examIndex, title) {
  return `
    <div class="bk-card bk-op-exam-context">
      <div>
        <div class="label">${escapeHtml(label)}${examSessionId ? ` · 第 ${escapeHtml(examSessionId)} 场` : ''}</div>
        <h2>${examIndex ? `第 ${examIndex} 题 · ` : ''}${escapeHtml(title)}</h2>
      </div>
      <button class="bk-btn" data-exam-back>返回考试题单</button>
    </div>
  `;
}
