import { API, BASE } from '../api.js?v=20260424-5';

const KIND_LABEL = {
  data: '数据',
  code: '代码',
  model: '模型',
  image: '图片',
  text: '文本',
  doc: '文档',
  file: '文件',
};

const KIND_ICON = {
  data: '▦',
  code: '{}',
  model: '◎',
  image: '▣',
  text: '¶',
  doc: '□',
  file: '◇',
};

export function renderSolutionGuide(guide) {
  if (!guide) return '';
  if (typeof guide === 'string') {
    return `<p class="bk-op-prose">${escapeHtml(guide)}</p>`;
  }
  const steps = Array.isArray(guide.steps) ? guide.steps : [];
  return `
    <div class="bk-guide">
      ${guide.overview ? `<p class="bk-guide-overview">${escapeHtml(guide.overview)}</p>` : ''}
      ${steps.length ? `<ol class="bk-guide-steps">
        ${steps.map((s) => `
          <li>
            <div class="bk-guide-step-title">${escapeHtml(s.title || '步骤')}</div>
            ${s.description ? `<p>${escapeHtml(s.description)}</p>` : ''}
            ${Array.isArray(s.tips) && s.tips.length ? `
              <ul class="bk-guide-tips">
                ${s.tips.map((t) => `<li>${escapeHtml(t)}</li>`).join('')}
              </ul>` : ''}
          </li>
        `).join('')}
      </ol>` : ''}
    </div>
  `;
}

// "解题"按钮（顶部 ctrl-strip 内的图标按钮）。无 guide 时返回空字符串。
export function renderSolutionGuideButton(guide) {
  if (!guide) return '';
  return `
    <button class="bk-op-panel-btn bk-op-strip-solution" data-solution-trigger title="查看本题解题思路">
      <span class="bk-op-panel-btn-icon">📖</span>
      <span class="bk-op-panel-btn-label">解题</span>
    </button>
  `;
}

let _markedLoading = null;
function withBase(path) {
  return `${BASE}${path}`;
}

function ensureMarked() {
  if (window.marked) return Promise.resolve(window.marked);
  if (_markedLoading) return _markedLoading;
  _markedLoading = new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = withBase('/static/assets/vendor/marked.min.js?v=12.0.2');
    s.onload = () => resolve(window.marked);
    s.onerror = () => reject(new Error('解题思路渲染器加载失败'));
    document.head.appendChild(s);
  });
  return _markedLoading;
}

// 把 Markdown 中相对路径的 ![](./xxx.png) 重写到 /api/operations/{id}/files/...
function rewriteRelativeImages(html, opId) {
  return html.replace(/<img\s+([^>]*?)src="(?!https?:|\/|data:)([^"]+)"/g, (_m, attrs, src) => {
    const cleaned = src.replace(/^\.\//, '').replace(/^\//, '');
    return `<img ${attrs}src="${withBase(`/api/operations/${opId}/files/${encodeURI(cleaned)}`)}"`;
  });
}

// 绑定"题目讲解"按钮：点击弹出居中 modal 渲染 Markdown
export function bindSolutionGuideButton(host, opId, guide) {
  if (!guide) return;
  const trigger = host.querySelector('[data-solution-trigger]');
  if (!trigger) return;

  const isStr = typeof guide === 'string';

  trigger.addEventListener('click', async () => {
    const mask = document.createElement('div');
    mask.className = 'bk-solution-modal-mask';
    mask.innerHTML = `
      <div class="bk-solution-modal" role="dialog" aria-modal="true">
        <div class="bk-solution-modal-hd">
          <span>📖 题目讲解 · #${opId}</span>
          <button type="button" class="bk-solution-modal-close" aria-label="关闭">✕</button>
        </div>
        <div class="bk-solution-modal-bd"><p class="small">加载中…</p></div>
      </div>`;
    function close() {
      mask.removeEventListener('click', onMask);
      document.removeEventListener('keydown', onKey);
      mask.remove();
    }
    function onMask(e) { if (e.target === mask) close(); }
    function onKey(e) { if (e.key === 'Escape') close(); }
    mask.addEventListener('click', onMask);
    document.addEventListener('keydown', onKey);
    mask.querySelector('.bk-solution-modal-close').addEventListener('click', close);
    document.body.appendChild(mask);

    const bd = mask.querySelector('.bk-solution-modal-bd');
    try {
      if (isStr) {
        const marked = await ensureMarked();
        const raw = marked.parse(guide);
        bd.innerHTML = `<div class="bk-solution-md">${rewriteRelativeImages(raw, opId)}</div>`;
      } else {
        bd.innerHTML = renderSolutionGuide(guide);
      }
    } catch (e) {
      bd.innerHTML = `<div class="bk-op-empty is-error">${escapeHtml(e.message)}</div>`;
    }
  });
}

export function renderOperationTasks(tasks) {
  if (!tasks) return '';
  if (typeof tasks === 'string') {
    return `<p class="bk-op-prose">${escapeHtml(tasks)}</p>`;
  }
  if (Array.isArray(tasks)) {
    const items = tasks
      .map((task, i) => {
        const num = task?.num ?? i + 1;
        const text = task?.text ?? task?.description ?? task?.content ?? '';
        if (!String(text).trim()) return '';
        const numericNum = Number(num);
        const valueAttr = Number.isFinite(numericNum) ? ` value="${escapeHtml(String(numericNum))}"` : '';
        return `<li${valueAttr}>${escapeHtml(text)}</li>`;
      })
      .filter(Boolean)
      .join('');
    return items ? `<ol class="bk-op-task-list">${items}</ol>` : '';
  }
  return `<p class="bk-op-prose">${escapeHtml(tasks.text || tasks.description || '')}</p>`;
}

export function renderFilesPanelShell(title = '题目文件') {
  return `
    <div class="bk-card bk-op-files-card">
      <div class="bk-op-files-head">
        <div>
          <div class="label">${escapeHtml(title)}</div>
          <p class="small">本题 kernel 会从这些文件所在目录启动，可在代码中直接使用相对文件名。</p>
        </div>
        <button class="bk-btn bk-btn-ghost bk-btn-sm" data-files-refresh>刷新</button>
      </div>
      <div class="bk-op-files-list" data-files-list>
        <p class="small">加载文件…</p>
      </div>
    </div>
  `;
}

export function bindOperationFiles(host, operationId) {
  const list = host.querySelector('[data-files-list]');
  const refresh = host.querySelector('[data-files-refresh]');
  if (!list) return;

  async function load() {
    list.innerHTML = `<p class="small">加载文件…</p>`;
    try {
      const data = await API.operationFiles(operationId);
      const files = data.files || [];
      if (!files.length) {
        list.innerHTML = `<div class="bk-op-empty">暂无可查看素材文件。</div>`;
        return;
      }
      list.innerHTML = files.map(fileRowHtml).join('');
      list.querySelectorAll('[data-file-open]').forEach((btn) =>
        btn.addEventListener('click', () => openFile(operationId, btn.dataset.fileOpen, true)),
      );
      list.querySelectorAll('[data-file-download]').forEach((btn) =>
        btn.addEventListener('click', () => openFile(operationId, btn.dataset.fileDownload, false)),
      );
    } catch (e) {
      list.innerHTML = `<div class="bk-op-empty is-error">${escapeHtml(e.message)}</div>`;
    }
  }

  refresh?.addEventListener('click', load);
  load();
}

function fileRowHtml(f) {
  const kind = f.kind || 'file';
  const label = KIND_LABEL[kind] || '文件';
  const icon = KIND_ICON[kind] || '◇';
  return `
    <div class="bk-op-file-row">
      <div class="bk-op-file-icon">${escapeHtml(icon)}</div>
      <div class="bk-op-file-main">
        <div class="bk-op-file-name" title="${escapeHtml(f.path)}">${escapeHtml(f.path)}</div>
        <div class="bk-op-file-meta">${label} · ${formatBytes(f.size || 0)}</div>
      </div>
      <div class="bk-op-file-actions">
        ${f.viewable ? `<button class="bk-btn bk-btn-ghost bk-btn-xs" data-file-open="${escapeHtml(f.path)}">打开</button>` : ''}
        <button class="bk-btn bk-btn-ghost bk-btn-xs" data-file-download="${escapeHtml(f.path)}">下载</button>
      </div>
    </div>
  `;
}

async function openFile(operationId, path, view) {
  try {
    const blob = await API.operationFileBlob(operationId, path);
    const url = URL.createObjectURL(blob);
    if (view) {
      window.open(url, '_blank', 'noopener');
      setTimeout(() => URL.revokeObjectURL(url), 60000);
      return;
    }
    const a = document.createElement('a');
    a.href = url;
    a.download = path.split('/').pop() || 'file';
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  } catch (e) {
    alert(e.message);
  }
}

function formatBytes(n) {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

export function escapeHtml(s) {
  return String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;')
    .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

// qid (1..40) → "1.1.1" / "4.1.2" 形式的章节号
// 每 5 题为一个小节；前两段循环组成章/节：
//   1-5  → 1.1.x   6-10 → 1.2.x   11-15 → 2.1.x   16-20 → 2.2.x
//   21-25→ 3.1.x  26-30→ 3.2.x   31-35 → 4.1.x   36-40 → 4.2.x
export function opSectionNo(qid) {
  const n = Number(qid);
  if (!Number.isFinite(n) || n < 1) return '';
  const c = Math.floor((n - 1) / 5);   // 0..7
  const ch = Math.floor(c / 2) + 1;    // 1..4
  const sec = (c % 2) + 1;             // 1..2
  const sub = ((n - 1) % 5) + 1;       // 1..5
  return `${ch}.${sec}.${sub}`;
}

// 8 个分类对应的小节号（与 PDF 原书一致）
const _CATEGORY_NO = {
  '业务数据处理': '1.1',
  '模块效果优化': '1.2',
  '数据清洗标注': '2.1',
  '模型开发测试': '2.2',
  '数据分析优化': '3.1',
  '交互流程设计': '3.2',
  '培训大纲编写': '4.1',
  '采集处理指导': '4.2',
};

export function opCategoryNo(name) {
  return _CATEGORY_NO[name] || '';
}

// Two-mode reset confirm: returns 'keep' | 'clear' | null（取消）
// 提交完成后的结果弹窗（带得分/总分），需要用户点确认后关闭。
// usage: notifySubmitResult({ score: 18, total: 22, title:'AI 判分完成', detail:'查看下方逐项反馈' })
export function notifySubmitResult({ score = 0, total = 0, title = '提交完成', detail = '', tone = '' } = {}) {
  return new Promise((resolve) => {
    const pct = total > 0 ? score / total : 0;
    const autoTone = tone || (pct >= 0.85 ? 'ok' : pct >= 0.6 ? 'warn' : 'err');
    const fmt = (n) => Number.isInteger(Number(n)) ? String(n) : Number(n).toFixed(1);
    const mask = document.createElement('div');
    mask.className = 'bk-submit-overlay';
    mask.innerHTML = `
      <div class="bk-submit-result-card" role="dialog" aria-modal="true">
        <div class="bk-submit-result-title">${escapeHtml(title)}</div>
        ${total > 0 ? `<div class="bk-submit-result-score bk-submit-result-${autoTone}">
          <span class="bk-submit-result-num">${escapeHtml(fmt(score))}</span>
          <span class="bk-submit-result-sep">/</span>
          <span class="bk-submit-result-den">${escapeHtml(fmt(total))}</span>
          <span class="bk-submit-result-unit">分</span>
        </div>` : ''}
        ${detail ? `<div class="bk-submit-result-detail">${escapeHtml(detail)}</div>` : ''}
        <button class="bk-btn bk-btn-primary bk-submit-result-confirm">知道了</button>
      </div>`;
    function close() { mask.remove(); document.removeEventListener('keydown', onKey); resolve(); }
    function onKey(e) { if (e.key === 'Escape' || e.key === 'Enter') close(); }
    mask.querySelector('.bk-submit-result-confirm').addEventListener('click', close);
    mask.addEventListener('click', (e) => { if (e.target === mask) close(); });
    document.addEventListener('keydown', onKey);
    document.body.appendChild(mask);
    mask.querySelector('.bk-submit-result-confirm').focus();
  });
}

// 提交中遮罩：在 await 期间显示一个居中模态，避免用户误以为按钮卡住。
// usage:
//   await withSubmittingOverlay(() => API.xxx(), { title:'正在提交答案', detail:'判分中…' })
export async function withSubmittingOverlay(asyncFn, { title = '正在提交', detail = '请稍候，不要关闭页面…' } = {}) {
  const mask = document.createElement('div');
  mask.className = 'bk-submit-overlay';
  mask.innerHTML = `
    <div class="bk-submit-overlay-card" role="status" aria-live="polite">
      <div class="bk-submit-overlay-spinner" aria-hidden="true"></div>
      <div class="bk-submit-overlay-title">${escapeHtml(title)}</div>
      <div class="bk-submit-overlay-detail">${escapeHtml(detail)}</div>
    </div>`;
  document.body.appendChild(mask);
  try {
    return await asyncFn();
  } finally {
    mask.remove();
  }
}

export function pickResetMode({ submitted = false, keepHint = '', clearHint = '' } = {}) {
  return new Promise((resolve) => {
    const mask = document.createElement('div');
    mask.className = 'bk-reset-modal-mask';
    mask.innerHTML = `
      <div class="bk-reset-modal" role="dialog" aria-modal="true">
        <div class="bk-reset-modal-hd">${submitted ? '撤销提交并重置' : '重置当前作答'}</div>
        <div class="bk-reset-modal-bd">请选择重置方式：</div>
        <div class="bk-reset-modal-opts">
          <button class="bk-reset-opt" data-mode="keep">
            <div class="bk-reset-opt-title">① 保留答案，仅重置状态</div>
            <div class="bk-reset-opt-desc">${escapeHtml(keepHint || '清掉判分/提交状态，作答内容保留。')}</div>
          </button>
          <button class="bk-reset-opt bk-reset-opt-danger" data-mode="clear">
            <div class="bk-reset-opt-title">② 完全重置（清空答案）</div>
            <div class="bk-reset-opt-desc">${escapeHtml(clearHint || '清掉判分/提交状态 + 作答内容，无法撤销。')}</div>
          </button>
        </div>
        <div class="bk-reset-modal-ft">
          <button class="bk-btn bk-btn-ghost bk-btn-sm" data-mode="cancel">取消</button>
        </div>
      </div>`;
    function cleanup(v) {
      mask.removeEventListener('click', onMask);
      document.removeEventListener('keydown', onKey);
      mask.remove();
      resolve(v);
    }
    function onMask(e) { if (e.target === mask) cleanup(null); }
    function onKey(e) { if (e.key === 'Escape') cleanup(null); }
    mask.addEventListener('click', onMask);
    document.addEventListener('keydown', onKey);
    mask.querySelectorAll('[data-mode]').forEach(btn => {
      btn.addEventListener('click', () => {
        const m = btn.getAttribute('data-mode');
        cleanup(m === 'cancel' ? null : m);
      });
    });
    document.body.appendChild(mask);
  });
}
