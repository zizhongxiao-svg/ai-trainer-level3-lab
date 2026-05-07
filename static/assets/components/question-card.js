// 通用题目卡片渲染。modes:
//   - 'exam': 答题模式（点击切换 selected）
//   - 'review': 复盘模式（高亮正确/错误，展示解析）
// 不依赖 Vue；返回 HTMLElement。事件 'bk-cell-change' 在 selected 变化时派发。
export function renderQuestionCard(q, options = {}) {
  const mode = options.mode || 'exam';
  const selected = new Set(options.selected || []);
  const idx = options.index;          // 1-based 题号
  const total = options.total;

  const wrap = document.createElement('div');
  wrap.className = 'bk-card';
  wrap.dataset.qid = q.id;

  const typeLabel = { judge: '判断题', single: '单选题', multi: '多选题' }[q.type] || q.type;
  const isMulti = q.type === 'multi';

  const correctSet = new Set(q.correct_answer || q.answer || []);
  const userSet = new Set(q.user_answer || []);

  const optionsHtml = q.options.map(opt => {
    const label = String(opt.label);
    const isPicked = (mode === 'exam' ? selected.has(label) : userSet.has(label));
    const isCorrect = correctSet.has(label);
    let cls = 'bk-opt';
    let badge = '';
    if (mode === 'review') {
      if (isCorrect) { cls += ' is-correct'; badge = '✓'; }
      if (isPicked && !isCorrect) { cls += ' is-wrong'; badge = '✗'; }
      if (isPicked && isCorrect) { badge = '✓ 我'; }
    } else if (isPicked) {
      cls += ' is-picked';
    }
    return `
      <div class="${cls}" data-label="${escAttr(label)}">
        <span class="bk-opt-mark">${escHtml(label)}</span>
        <span class="bk-opt-text">${escHtml(opt.text)}</span>
        ${badge ? `<span class="bk-opt-badge">${badge}</span>` : ''}
      </div>`;
  }).join('');

  const reviewExtra = (mode === 'review') ? `
    <div class="bk-review-summary">
      <span class="${q.is_correct ? 'bk-tag-ok' : 'bk-tag-err'}">
        ${q.is_correct ? '答对' : '答错'} · 得 ${q.points_awarded ?? 0} / ${q.max_points ?? 0} 分
      </span>
      <span class="small" style="margin-left:8px;color:var(--ink-2)">
        正确答案：${[...correctSet].sort().join(' ') || '—'}
      </span>
    </div>
  ` : '';

  wrap.innerHTML = `
    <div class="bk-q-head">
      <span class="bk-q-pill">${idx ? `第 ${idx} 题` : ''}${total ? ` / ${total}` : ''}</span>
      <span class="bk-q-pill bk-q-pill-soft">${typeLabel}${isMulti ? ' · 多选' : ''}</span>
      ${q.category ? `<span class="bk-q-pill bk-q-pill-soft">${escHtml(q.category)}</span>` : ''}
    </div>
    <div class="bk-q-text">${escHtml(q.text)}</div>
    <div class="bk-q-opts">${optionsHtml}</div>
    ${reviewExtra}
  `;

  if (mode === 'exam') {
    wrap.querySelectorAll('.bk-opt').forEach(node => {
      node.addEventListener('click', () => {
        const lab = node.dataset.label;
        if (isMulti) {
          if (selected.has(lab)) selected.delete(lab); else selected.add(lab);
        } else {
          selected.clear(); selected.add(lab);
        }
        // Rerender opt states
        wrap.querySelectorAll('.bk-opt').forEach(n => {
          n.classList.toggle('is-picked', selected.has(n.dataset.label));
        });
        wrap.dispatchEvent(new CustomEvent('bk-cell-change', {
          bubbles: true,
          detail: { qid: q.id, selected: [...selected].sort() },
        }));
      });
    });
  }

  return wrap;
}

function escHtml(s) {
  return String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;')
    .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
function escAttr(s) { return escHtml(s); }
