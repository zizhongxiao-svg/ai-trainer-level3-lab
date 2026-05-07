import { API } from '../api.js?v=20260503-docx-template-1';
import { installAutoSave } from './_draft-autosave.js';
import { bindOperationFiles, bindSolutionGuideButton, escapeHtml, notifySubmitResult, opSectionNo, pickResetMode, renderFilesPanelShell, renderOperationTasks, renderSolutionGuideButton, withSubmittingOverlay } from './_op-helpers.js?v=20260503-task-number-1';
import { handleOpsUnlockError } from './_ops-unlock.js?v=20260429-2';

export async function renderOperationsDoc(host, {
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
    if (op.type !== 'doc') { location.hash = examMode ? `#/exam-ops/op/${id}` : `#/ops/${id}`; return; }
  } catch (e) {
    if (handleOpsUnlockError(e, () => renderOperationsDoc(host, { id, examMode, examModeLabel, examSessionId, examIndex, examBackHash, sessionId }))) {
      host.innerHTML = `<div class="bk-card"><p class="small">操作题训练需要先解锁。</p></div>`;
      return;
    }
    host.innerHTML = `<div class="bk-card" style="color:var(--err)">${escapeHtml(e.message)}</div>`;
    return;
  }

  const state = {
    sessionId: session.session_id,
    answers: { ...(session.blanks_draft || {}) },
    rubricChecks: { ...(session.rubric_checks || {}) },
    submitted: session.submitted,
    selfScore: session.self_score,
    aiGrading: session.ai_grading || null,
    grading: false,
    showAnswer: false,
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
        <button class="bk-op-panel-btn" data-panel="files" title="数据集 / 文档素材">
          <span class="bk-op-panel-btn-icon">▦</span>
          <span class="bk-op-panel-btn-label">文件</span>
        </button>
        <button class="bk-op-panel-btn" data-panel="right" title="评分打勾 / 提交">
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
          <div class="bk-card"><div class="label">题目背景</div>
            <p class="bk-op-prose">${escapeHtml(op.scenario || '')}</p></div>
          <div class="bk-card"><div class="label">工作任务</div>
            ${renderOperationTasks(op.tasks)}</div>
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
        <div class="bk-card bk-op-toolbar" style="display:flex;align-items:center;gap:10px;padding:10px 14px;margin-bottom:12px">
          <span class="small">${examMode ? '实操考试作答' : '文档题'} · 共 ${op.rubric?.length || 0} 项</span>
          <span class="bk-op-toolbar-title">${opSectionNo(id) ? `<span class="bk-ops-no" style="margin-right:8px">${opSectionNo(id)}</span>` : ''}${escapeHtml(op.title || '文档题')}</span>
          ${examMode ? `<button class="bk-btn bk-btn-ghost bk-btn-sm bk-op-exam-back" style="margin-left:auto">返回考试</button>` : ''}
        </div>
        <div id="bk-doc-rubric"></div>
      </main>

      <aside class="bk-op-right" id="bk-op-right">
        <div class="bk-op-panel-hd">
          <span class="bk-op-panel-hd-title">评分 &amp; 提交</span>
          <button class="bk-op-panel-close" data-close-panel="right">✕</button>
        </div>
        <div class="bk-op-panel-content">
          ${examMode ? `
          <div class="bk-card">
            <div class="label">系统评分</div>
            <p class="small" style="line-height:1.6;color:var(--ink-2);margin:6px 0 0">
              考试模式不允许自评分。提交后系统按作答内容与参考要点自动计算本题得分。
            </p>
          </div>` : `
          <div class="bk-card">
            <div class="label">AI 判分</div>
            <p class="small" style="line-height:1.6;color:var(--ink-2);margin:6px 0 0">
              点击"提交"后由 Copilot AI 同步判卷，依据各 rubric 评分项打分（约 5–30 秒）。
            </p>
          </div>`}
          ${!session.in_exam ? `
          <div style="margin-top:12px">
            <button class="bk-btn bk-btn-ghost bk-btn-sm bk-op-toggle-answer" style="width:100%">查看参考答案</button>
          </div>` : `
          <p class="small" style="margin-top:12px;color:var(--ink-3)">📝 模拟考试进行中 · 参考答案已锁定</p>`}
          <div class="bk-card" style="margin-top:12px">
            <div class="label">提交</div>
            <p class="small" style="margin:6px 0 8px">${examMode ? '提交后由系统评分，不能再修改。' : '提交后由 AI 自动判分，不能再修改。'}</p>
            <div class="bk-op-submit-actions ${state.submitted ? 'is-single' : ''}">
              ${state.submitted ? '' : `
              <button class="bk-btn bk-btn-ghost bk-btn-sm bk-op-discard"
                      title="删除这道题的草稿，${examMode ? '回到实操考试' : '回到操作列表'}">放弃此次作答</button>`}
              <button class="bk-btn bk-btn-primary bk-op-submit"
                      ${state.submitted ? 'disabled' : ''}>
                ${state.submitted ? '已提交' : (examMode ? '提交本题' : '提交并 AI 判分')}
              </button>
            </div>
            <p class="small bk-op-submit-hint" style="margin-top:8px">${state.submitted
              ? (examMode
                ? '本题已提交，交卷后 AI 判分'
                : (state.aiGrading
                  ? `AI 已判分：<b>${state.selfScore ?? state.aiGrading.score}</b> / ${op.total_score ?? state.aiGrading.max_score ?? 0} 分`
                  : `已得 <b>${state.selfScore ?? 0}</b> / ${op.total_score ?? 0} 分`))
              : ''}</p>
            <div id="bk-doc-ai-panel" style="margin-top:12px"></div>
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

  let docxTemplate = null;
  try {
    const tpl = await API.operationDocxTemplate(Number(id));
    if (tpl?.available && tpl.blank_count > 0) docxTemplate = tpl;
  } catch {
    docxTemplate = null;
  }

  // 兼容两种参考答案数据格式：
  //   1) 按 rubric id 切分（M1/M2…）→ 每个 rubric 卡下方各自显示
  //   2) 整段 {type:'text', content:'...'} → 中栏顶部一张大卡显示
  const rubricIds = new Set((op.rubric || []).map((r) => r.id));
  const blobSecs = (op.answer_sections || []).filter((s) => !s.id || !rubricIds.has(s.id));
  const blobText = blobSecs
    .map((s) => s.text || s.content || '')
    .filter(Boolean)
    .join('\n\n');

  // 中栏：每个 rubric 一个 textarea（+ 整段 fallback 卡）
  const mid = host.querySelector('#bk-doc-rubric');
  const blobHtml = blobText
    ? `<div class="bk-card bk-doc-blob" style="display:${state.showAnswer ? 'block' : 'none'};margin-bottom:12px">
         <div class="label" style="margin-bottom:8px">参考答案（整卷）</div>
         <pre class="bk-jcell-reference" style="white-space:pre-wrap;max-height:none">${escapeHtml(blobText)}</pre>
       </div>`
    : '';
  const answerBoxRefs = buildAnswerBoxRefMap(op);
  const primaryRubricId = (op.rubric || [])[0]?.id || 'M1';
  if (docxTemplate) syncDocxTemplateAnswer(docxTemplate, state, primaryRubricId);
  mid.innerHTML = blobHtml + (docxTemplate
    ? renderDocxTemplateCard(docxTemplate, op, state, primaryRubricId)
    : (op.rubric || []).map((r) => {
    const refAnswer = (op.answer_sections || []).find((a) => a.id === r.id)?.text || '';
    const boxRef = answerBoxRefs.get(r.id) || '';
    return `
      <div class="bk-card bk-doc-item" style="margin-bottom:12px">
        <div class="bk-doc-item-head">
          <div>
            <div class="bk-doc-answer-ref">${boxRef ? `作答框题号：${escapeHtml(boxRef)}` : `评分项：${escapeHtml(r.id)}`}</div>
            <div>${escapeHtml(r.desc || r.id)}</div>
          </div>
          <span class="bk-doc-rubric-id">${escapeHtml(r.id)} · ${r.points} 分</span>
        </div>
        <textarea class="bk-doc-answer" data-rid="${escapeHtml(r.id)}" rows="4"
                  placeholder="在此作答…" ${state.submitted ? 'disabled' : ''}>${escapeHtml(state.answers[r.id] || '')}</textarea>
        ${refAnswer ? `<pre class="bk-jcell-reference bk-doc-ref" style="display:${state.showAnswer ? 'block' : 'none'}"
             data-rid-ref="${escapeHtml(r.id)}">${escapeHtml(refAnswer)}</pre>` : ''}
      </div>
    `;
  }).join(''));

  mid.querySelectorAll('.bk-doc-answer').forEach((ta) =>
    ta.addEventListener('input', () => {
      state.answers[ta.dataset.rid] = ta.value;
      host.dispatchEvent(new CustomEvent('bk-draft-dirty'));
    }),
  );
  mid.querySelectorAll('.bk-docx-blank').forEach((input) =>
    input.addEventListener('input', () => {
      state.answers[input.dataset.answerKey] = input.value;
      syncDocxTemplateAnswer(docxTemplate, state, primaryRubricId);
      host.dispatchEvent(new CustomEvent('bk-draft-dirty'));
    }),
  );

  // 右栏：rubric 打勾
  const checks = host.querySelector('#bk-rubric-checks');
  if (checks) {
    checks.innerHTML = (op.rubric || []).map((r) => `
      <li class="bk-rubric-item">
        <label>
          <input type="checkbox" data-rid="${escapeHtml(r.id)}" ${state.rubricChecks[r.id] ? 'checked' : ''} ${state.submitted ? 'disabled' : ''}>
          <span><b>${escapeHtml(answerBoxRefs.get(r.id) || r.id)}</b> · ${escapeHtml(r.id)} · ${r.points} 分</span>
        </label>
      </li>
    `).join('');
    checks.querySelectorAll('input[data-rid]').forEach((ck) =>
      ck.addEventListener('change', () => {
        state.rubricChecks[ck.dataset.rid] = ck.checked;
        host.dispatchEvent(new CustomEvent('bk-draft-dirty'));
      }),
    );
  }

  // 参考答案开关
  const syncAnswerLabels = () => {
    const txt = state.showAnswer ? '隐藏参考答案' : '查看参考答案';
    const sTxt = state.showAnswer ? '隐藏' : '答案';
    const orig = host.querySelector('.bk-op-toggle-answer');
    if (orig) orig.textContent = txt;
    const stripLbl = host.querySelector('.bk-op-strip-answer .bk-op-panel-btn-label');
    if (stripLbl) stripLbl.textContent = sTxt;
  };
  const toggleAnswer = () => {
    state.showAnswer = !state.showAnswer;
    mid.querySelectorAll('.bk-doc-ref, .bk-doc-blob, .bk-docx-ref, .bk-docx-ref-inline').forEach((el) => {
      el.style.display = el.classList.contains('bk-docx-ref-inline')
        ? (state.showAnswer ? 'inline-flex' : 'none')
        : (state.showAnswer ? 'block' : 'none');
    });
    syncAnswerLabels();
  };
  host.querySelector('.bk-op-toggle-answer')?.addEventListener('click', toggleAnswer);
  host.querySelector('.bk-op-strip-answer')?.addEventListener('click', toggleAnswer);

  // 提交（中栏 + strip 快捷）
  const setSubmitting = (on) => {
    state.grading = on;
    const submitBtn = host.querySelector('.bk-op-submit');
    const stripBtn = host.querySelector('.bk-op-strip-submit');
    if (submitBtn) {
      if (on) {
        submitBtn.setAttribute('disabled', '');
        submitBtn.textContent = examMode ? '提交中…' : 'AI 判分中…';
      }
    }
    if (stripBtn) {
      if (on) stripBtn.setAttribute('disabled', '');
      const lbl = stripBtn.querySelector('.bk-op-panel-btn-label');
      if (lbl && on) lbl.textContent = '判分中';
    }
  };

  const renderAIGrading = (ai) => {
    const panel = host.querySelector('#bk-doc-ai-panel');
    if (!panel) return;
    if (!ai) { panel.innerHTML = ''; return; }
    if (ai.status === 'failed') {
      panel.innerHTML = `<div class="bk-card" style="background:#fff5f5;border-color:#fecaca;color:#b42318">
        <div class="label">AI 判分失败</div>
        <p class="small" style="margin:6px 0 0">${escapeHtml(ai.error || '请稍后重试')}</p></div>`;
      return;
    }
    const items = (ai.rubric_scores || []).map((r) => {
      const matched = (r.matched_points || []).map(escapeHtml).join('、');
      const missing = (r.missing_points || []).map(escapeHtml).join('、');
      return `<li class="bk-doc-ai-item">
        <div><b>${escapeHtml(String(r.id || ''))}</b> · ${r.score ?? 0}/${r.max_score ?? 0} 分</div>
        ${r.comment ? `<p class="small" style="margin:4px 0 0">${escapeHtml(r.comment)}</p>` : ''}
        ${matched ? `<p class="small" style="margin:4px 0 0;color:#15803d">✔ 命中：${matched}</p>` : ''}
        ${missing ? `<p class="small" style="margin:4px 0 0;color:#b45309">○ 缺失：${missing}</p>` : ''}
      </li>`;
    }).join('');
    const summary = ai.feedback?.summary || '';
    const conf = ai.feedback?.confidence || '';
    const modelLine = [ai.model, ai.reasoning_effort].filter(Boolean).join(' · ');
    panel.innerHTML = `
      <div class="bk-card">
        <div class="label">AI 判分明细</div>
        ${summary ? `<p class="small" style="margin:6px 0 8px;line-height:1.6">${escapeHtml(summary)}</p>` : ''}
        <ul class="bk-doc-ai-list" style="margin:0;padding:0;list-style:none">${items}</ul>
        <p class="small" style="margin:8px 0 0;color:var(--ink-3)">
          模型：${escapeHtml(modelLine || '—')}${conf ? ` · 置信度 ${escapeHtml(conf)}` : ''}
        </p>
      </div>`;
  };

  if (state.submitted && state.aiGrading) renderAIGrading(state.aiGrading);

  host.querySelector('.bk-op-submit').addEventListener('click', async () => {
    if (state.submitted || state.grading) return;
    setSubmitting(true);
    try {
      const resp = await withSubmittingOverlay(
        () => API.opSessionSubmit(state.sessionId, {
          blanks_draft: state.answers,
          ...(examMode ? {} : { rubric_checks: state.rubricChecks }),
        }),
        examMode
          ? { title: '正在提交答案', detail: '提交完成后将进入交卷统一 AI 判分。' }
          : { title: 'AI 判分中', detail: '正在调用 AI 阅卷模型，约需 10-30 秒，请勿关闭页面…' }
      );
      state.submitted = true;
      state.selfScore = resp.self_score ?? null;
      state.aiGrading = resp.ai_grading || null;
      const submitBtn = host.querySelector('.bk-op-submit');
      submitBtn.textContent = '已提交';
      submitBtn.setAttribute('disabled', '');
      const stripBtn = host.querySelector('.bk-op-strip-submit');
      if (stripBtn) {
        stripBtn.setAttribute('disabled', '');
        const lbl = stripBtn.querySelector('.bk-op-panel-btn-label');
        if (lbl) lbl.textContent = '已交';
      }
      const discardBtn = host.querySelector('.bk-op-discard');
      if (discardBtn) discardBtn.remove();
      host.querySelector('.bk-op-submit-actions')?.classList.add('is-single');
      const totalScoreVal = (op.total_score ?? state.aiGrading?.max_score ?? 0);
      const earnedVal = state.selfScore ?? state.aiGrading?.score ?? 0;
      const hint = host.querySelector('.bk-op-submit-hint');
      if (hint) hint.innerHTML = examMode
        ? '本题已提交，交卷后 AI 判分'
        : (state.aiGrading
          ? `AI 已判分：<b>${earnedVal}</b> / ${totalScoreVal} 分`
          : `已得 <b>${earnedVal}</b> / ${totalScoreVal} 分`);
      renderAIGrading(state.aiGrading);
      if (!examMode) {
        await notifySubmitResult({
          score: earnedVal,
          total: totalScoreVal,
          title: 'AI 判分完成',
          detail: '右侧 AI 反馈面板已展开，可逐项查看得分依据。',
        });
      } else {
        await notifySubmitResult({
          score: 0, total: 0,
          title: '本题已提交',
          detail: '考试模式下当前不显示分数，交卷后将统一进行 AI 判分。',
          tone: 'warn',
        });
      }
    } catch (e) {
      alert(e.message || 'AI 判分失败，请重试');
      setSubmitting(false);
      const submitBtn = host.querySelector('.bk-op-submit');
      if (submitBtn) {
        submitBtn.removeAttribute('disabled');
        submitBtn.textContent = examMode ? '提交本题' : '提交并 AI 判分';
      }
      const stripBtn = host.querySelector('.bk-op-strip-submit');
      if (stripBtn) {
        stripBtn.removeAttribute('disabled');
        const lbl = stripBtn.querySelector('.bk-op-panel-btn-label');
        if (lbl) lbl.textContent = '提交';
      }
    }
  });

  host.querySelector('.bk-op-strip-submit')?.addEventListener('click', () => {
    if (state.submitted || state.grading) return;
    host.querySelector('.bk-op-submit')?.click();
  });

  // 重置：弹出两种模式让用户选 —— 1) 保留答案仅清状态；2) 完全清空
  host.querySelector('.bk-op-strip-reset')?.addEventListener('click', async () => {
    if (state.grading) return;
    if (examMode && state.submitted) {
      alert('考试模式不允许撤销已提交的作答');
      return;
    }
    const mode = await pickResetMode({
      submitted: state.submitted,
      keepHint: '清掉判分结果，回到草稿状态，rubric 自评内容保留。',
      clearHint: '清掉判分结果 + rubric 自评内容，回到全新作答状态。',
    });
    if (!mode) return;
    try {
      await API.opSessionReset(state.sessionId, mode);
      window.location.reload();
    } catch (e) { alert('重置失败：' + (e.message || e)); }
  });

  // 放弃此次作答
  host.querySelector('.bk-op-discard')?.addEventListener('click', async () => {
    if (!confirm('确认放弃此次作答？\n\n已填写的草稿会被删除，操作不可撤销。')) return;
    try {
      await API.opSessionDiscard(state.sessionId);
      window.location.hash = examMode ? examBackHash : '#/ops';
    } catch (e) { alert('放弃失败：' + e.message); }
  });

  // Panel modals
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
    host.querySelector(`#bk-op-${pid}`)?.classList.remove('is-open');
    host.querySelector(`[data-panel="${pid}"]`)?.classList.remove('is-active');
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

  host.__bkState = state;
  host.__bkPushDraft = async () => {
    if (state.submitted) return;
    try {
      await API.opSessionSaveDraft(state.sessionId, {
        blanks_draft: state.answers,
        ...(examMode ? {} : { rubric_checks: state.rubricChecks }),
      });
    } catch (e) { console.warn('draft save failed', e); }
  };

installAutoSave(host, 5000);
}

function renderDocxTemplateCard(template, op, state, rubricId) {
  const rubric = (op.rubric || []).find((r) => r.id === rubricId) || (op.rubric || [])[0] || {};
  const refAnswer = (op.answer_sections || []).find((a) => a.id === rubricId)?.text || '';
  const blankRefs = extractDocxBlankAnswers(template, refAnswer);
  const paragraphs = (template.paragraphs || []).map((p) => `
    <p class="bk-docx-template-p">${(p.segments || []).map((seg) => {
      if (seg.type !== 'blank') return escapeHtml(seg.text || '');
      const key = docxBlankKey(rubricId, seg.id);
      const width = Number(seg.width || 16);
      const maxWidth = seg.kind === 'learning_goal' ? 54 : 28;
      return `<input class="bk-docx-blank" data-answer-key="${escapeHtml(key)}"
        aria-label="文档填空 ${escapeHtml(seg.id)}" size="${Math.max(8, Math.min(width, maxWidth))}"
        value="${escapeHtml(state.answers[key] || '')}" ${state.submitted ? 'disabled' : ''}>
        ${blankRefs[seg.id] ? `<span class="bk-docx-ref-inline" style="display:${state.showAnswer ? 'inline-flex' : 'none'}">${escapeHtml(blankRefs[seg.id])}</span>` : ''}`;
    }).join('')}</p>
  `).join('');
  return `
    <div class="bk-card bk-doc-item bk-docx-template-card" style="margin-bottom:12px">
      <div class="bk-doc-item-head">
        <div>
          <div class="bk-doc-answer-ref">素材文档填空 · ${escapeHtml(template.file || '')}</div>
          <div>${escapeHtml(rubric.desc || rubric.id || '补全文档内容')}</div>
        </div>
        <span class="bk-doc-rubric-id">${escapeHtml(rubric.id || rubricId)} · ${rubric.points || 0} 分</span>
      </div>
      <div class="bk-docx-template">${paragraphs}</div>
    </div>
  `;
}

function extractDocxBlankAnswers(template, refAnswer) {
  const refs = {};
  if (!template || !refAnswer) return refs;
  const ref = normalizeForSearch(refAnswer);
  let cursor = 0;
  for (const paragraph of template.paragraphs || []) {
    const segments = paragraph.segments || [];
    for (let i = 0; i < segments.length; i += 1) {
      const seg = segments[i];
      if (seg.type !== 'blank') continue;
      if (seg.kind === 'learning_goal') {
        const range = findLearningGoalAnswerRange(ref, seg.context || '', cursor);
        if (range) {
          const { start, end } = range;
          const raw = ref.original.slice(ref.map[start] ?? 0, ref.map[Math.max(end - 1, start)] + 1);
          const cleaned = cleanDocxRefAnswer(raw, '学习目标：');
          if (cleaned) {
            refs[seg.id] = cleaned;
            cursor = end;
          }
        }
        continue;
      }
      const before = nearestText(segments, i, -1);
      const after = nearestText(segments, i, 1);
      const prefix = anchorTail(before);
      const suffix = anchorHead(after);
      const range = findDocxAnswerRange(ref, prefix, suffix, cursor);
      if (!range) continue;
      const { start, end } = range;
      const raw = ref.original.slice(ref.map[start] ?? 0, ref.map[Math.max(end - 1, start)] + 1);
      const cleaned = cleanDocxRefAnswer(raw, before);
      if (cleaned) {
        refs[seg.id] = cleaned;
        cursor = end;
      }
    }
  }
  return refs;
}

function findLearningGoalAnswerRange(ref, sectionTitle, cursor) {
  const title = normalizeForSearch(sectionTitle).text;
  if (!title) return null;
  const titlePos = ref.text.indexOf(title, cursor);
  if (titlePos < 0) return null;
  const goalMarks = ['学习目标：', '学习目标:'].map((s) => normalizeForSearch(s).text);
  let markPos = -1;
  let markLen = 0;
  for (const mark of goalMarks) {
    const pos = ref.text.indexOf(mark, titlePos + title.length);
    if (pos >= 0 && (markPos < 0 || pos < markPos)) {
      markPos = pos;
      markLen = mark.length;
    }
  }
  if (markPos < 0) return null;
  const start = markPos + markLen;
  const contentMarks = ['内容：', '内容:'].map((s) => normalizeForSearch(s).text);
  let end = -1;
  for (const mark of contentMarks) {
    const pos = ref.text.indexOf(mark, start);
    if (pos >= 0 && (end < 0 || pos < end)) end = pos;
  }
  if (end < 0 || end <= start) return null;
  return { start, end };
}

function normalizeForSearch(text) {
  const original = String(text || '');
  const chars = [];
  const map = [];
  for (let i = 0; i < original.length; i += 1) {
    const ch = original[i];
    if (/\s/.test(ch)) continue;
    chars.push(ch);
    map.push(i);
  }
  return { original, text: chars.join(''), map };
}

function nearestText(segments, index, step) {
  let out = '';
  for (let i = index + step; i >= 0 && i < segments.length; i += step) {
    if (segments[i].type !== 'text') break;
    out = step < 0 ? `${segments[i].text || ''}${out}` : `${out}${segments[i].text || ''}`;
    if (out.replace(/\s/g, '').length >= 24) break;
  }
  return out;
}

function anchorTail(text) {
  const clean = String(text || '').replace(/\s/g, '');
  return clean.slice(Math.max(0, clean.length - 18));
}

function anchorHead(text) {
  return String(text || '').replace(/\s/g, '').slice(0, 18);
}

function findDocxAnswerRange(ref, prefix, suffix, cursor) {
  if (prefix && prefix.length >= 3) {
    const prefixPos = ref.text.indexOf(prefix, cursor);
    if (prefixPos < 0) return null;
    const start = prefixPos + prefix.length;
    const end = suffix ? ref.text.indexOf(suffix, start) : ref.text.length;
    return end < 0 ? null : { start, end };
  }
  if (suffix) {
    const end = ref.text.indexOf(suffix, cursor);
    if (end < 0) return null;
    if (!prefix) return { start: cursor, end };
    const prefixPos = ref.text.lastIndexOf(prefix, end);
    if (prefixPos < cursor) return null;
    return { start: prefixPos + prefix.length, end };
  }
  if (!prefix) return null;
  const pos = ref.text.indexOf(prefix, cursor);
  return pos < 0 ? null : { start: pos + prefix.length, end: ref.text.length };
}

function cleanDocxRefAnswer(raw, before = '') {
  let text = String(raw || '');
  if (text.includes('_') || text.includes('＿')) {
    const lines = text.split(/\n+/).filter((line) =>
      /[_＿]/.test(line) && line.replace(/[_＿\s]/g, '').trim(),
    );
    if (lines.length) text = lines.join(' ');
  }
  const beforeText = String(before || '').replace(/\s/g, '');
  let cleaned = text
    .replace(/[_＿]+/g, '')
    .replace(/[]/g, '')
    .replace(/\s+/g, ' ')
    .replace(/^[：:，,。.；;\s]+|[：:，,。.；;\s]+$/g, '')
    .trim();
  if (beforeText && cleaned.replace(/\s/g, '').startsWith(beforeText)) {
    cleaned = cleaned.slice(cleaned.indexOf(cleaned.trim()[0]) + String(before || '').trim().length).trim();
  }
  return cleaned;
}

function syncDocxTemplateAnswer(template, state, rubricId) {
  if (!template) return;
  const blanks = [];
  const completed = (template.paragraphs || []).map((p) =>
    (p.segments || []).map((seg) => {
      if (seg.type !== 'blank') return seg.text || '';
      const value = state.answers[docxBlankKey(rubricId, seg.id)] || '';
      blanks.push(`${seg.id}：${value}`);
      return value || '____';
    }).join(''),
  ).join('\n');
  state.answers[rubricId] = `素材文档填空\n${blanks.join('\n')}\n\n完成后的文档\n${completed}`;
}

function docxBlankKey(rubricId, blankId) {
  return `${rubricId}__${blankId}`;
}

function buildAnswerBoxRefMap(op) {
  const tasks = (op.tasks || [])
    .map((task) => ({
      ref: extractAnswerBoxRef(task?.text || task?.description || task?.content || ''),
      text: task?.text || task?.description || task?.content || '',
    }))
    .filter((task) => task.ref);
  const map = new Map();
  if (!tasks.length) return map;

  for (const rubric of (op.rubric || [])) {
    const desc = rubric.desc || '';
    const direct = tasks.find((task) => desc.includes(task.ref));
    if (direct) {
      map.set(rubric.id, direct.ref);
      continue;
    }

    let best = null;
    let bestScore = 0;
    for (const task of tasks) {
      const score = textOverlapScore(desc, task.text);
      if (score > bestScore) {
        bestScore = score;
        best = task;
      }
    }
    if (best && bestScore > 0) map.set(rubric.id, best.ref);
  }
  return map;
}

function extractAnswerBoxRef(text) {
  const match = String(text || '').match(/对应作答框题号[：:]\s*([^）)\s]+)/);
  return match ? match[1].trim() : '';
}

function textOverlapScore(a, b) {
  const aTokens = meaningfulBigrams(a);
  const bTokens = meaningfulBigrams(b);
  let score = 0;
  for (const token of aTokens) {
    if (bTokens.has(token)) score += 1;
  }
  return score;
}

function meaningfulBigrams(text) {
  const clean = String(text || '')
    .replace(/（对应作答框题号[：:][^）)]+[）)]/g, '')
    .replace(/[A-Za-z0-9_.-]+/g, '')
    .replace(/[，。；：、（）()“”"'\s]/g, '');
  const tokens = new Set();
  for (let i = 0; i < clean.length - 1; i += 1) {
    const token = clean.slice(i, i + 2);
    if (!COMMON_BIGRAMS.has(token)) tokens.add(token);
  }
  return tokens;
}

const COMMON_BIGRAMS = new Set([
  '回答', '每个', '每列', '本项', '最高', '总共', '正确', '得分', '分本',
]);

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
