// Jupyter-style cell — left-prompt layout matching real Jupyter Notebook.
//
// segments: [
//   { type:'given', code: 'import pandas as pd' },
//   { type:'blank', hint:'读取数据集', blankIndex: 0,
//     template: "data = ___('foo.csv')" },  // _____ markers are render points
// ]
//
// Each `blank` renders the template inline: text spans + <input> elements at
// every `_____` position. The user fills the inputs; the assembled string
// (template with substitutions) is what gets composed for kernel execution
// and what gets compared in grading.

const BLANK_RE = /_{5,}/g;

function splitTemplate(tpl) {
  // Returns { parts: [text, text, ...], blankCount } where blankCount =
  // parts.length - 1 (each gap between parts is a blank).
  if (!tpl) return { parts: [''], blankCount: 0 };
  const parts = tpl.split(BLANK_RE);
  return { parts, blankCount: parts.length - 1 };
}

function assembleTemplate(tpl, values) {
  const { parts } = splitTemplate(tpl);
  let out = '';
  for (let i = 0; i < parts.length; i++) {
    out += parts[i];
    if (i < parts.length - 1) out += values[i] || '';
  }
  return out;
}

// Reverse of assembleTemplate: given an assembled string and the template,
// extract the per-input substrings. Returns null if the assembled doesn't
// align (e.g., user-pasted free text). Greedy left-to-right.
function deriveInputs(tpl, assembled) {
  const { parts, blankCount } = splitTemplate(tpl);
  if (blankCount === 0) return [];
  if (!assembled) return new Array(blankCount).fill('');
  const out = [];
  let cursor = 0;
  if (parts[0]) {
    if (!assembled.startsWith(parts[0])) return null;
    cursor = parts[0].length;
  }
  for (let i = 0; i < blankCount; i++) {
    const next = parts[i + 1];
    if (!next) {
      out.push(assembled.substring(cursor));
      cursor = assembled.length;
    } else {
      const idx = assembled.indexOf(next, cursor);
      if (idx < 0) return null;
      out.push(assembled.substring(cursor, idx));
      cursor = idx + next.length;
    }
  }
  return out;
}

function markerWidths(tpl) {
  if (!tpl) return [];
  return Array.from(tpl.matchAll(BLANK_RE), (m) => m[0].length);
}

function normalizedWidthList(raw) {
  if (!Array.isArray(raw)) return [];
  return raw.map((v) => Number(v)).filter((v) => Number.isFinite(v) && v > 0);
}

function suggestedInputWidths(tpl, seg, initialValues) {
  const markers = markerWidths(tpl);
  const fromServer = normalizedWidthList(seg.input_widths || seg.inputWidths);
  const answerInputs = seg.answer ? deriveInputs(tpl, seg.answer) : null;
  return markers.map((markerWidth, i) => {
    const answerWidth = answerInputs && answerInputs[i] ? answerInputs[i].length : 0;
    const currentWidth = initialValues && initialValues[i] ? initialValues[i].length : 0;
    // Cap the initial footprint so very long answers do not make the cell
    // awkward; the hint still shows the full expected length.
    return Math.min(Math.max(6, markerWidth, fromServer[i] || 0, answerWidth, currentWidth), 64);
  });
}

function firstCodeLine(code = '') {
  return String(code).split('\n').find((line) => line.trim() && !line.trimStart().startsWith('#')) || '';
}

function segmentSourceText(seg) {
  if (!seg) return '';
  return seg.type === 'given' ? (seg.code || '') : (seg.template || seg.answer || '');
}

function endsWithContinuation(code = '') {
  return /[([,{&|+*/\\-]\s*$/.test(String(code).trimEnd());
}

function startsAsContinuation(code = '') {
  const line = firstCodeLine(code);
  if (!line) return false;
  const trimmed = line.trimStart();
  return /^[)\]}.,&|+*/]/.test(trimmed) || (line.length > trimmed.length && !trimmed.startsWith('#'));
}

function shouldJoinInlineSegments(prev, next) {
  return endsWithContinuation(segmentSourceText(prev)) || startsAsContinuation(segmentSourceText(next));
}

export function createCell(opts) {
  const { id, index, segments, initialBlanks = {}, onBlankInput, onRun } = opts;

  const wrap = document.createElement('div');
  wrap.className = 'bk-jcell';
  wrap.dataset.cellId = id;

  wrap.addEventListener('click', () => {
    document.querySelectorAll('.bk-jcell.is-selected').forEach(el => {
      if (el !== wrap) el.classList.remove('is-selected');
    });
    wrap.classList.add('is-selected');
  });

  // ── Left prompt column ──────────────────────────────────────────────
  const prompt = document.createElement('div');
  prompt.className = 'bk-jcell-prompt';
  const inLabel = document.createElement('div');
  inLabel.className = 'bk-jcell-in';
  inLabel.innerHTML = `In&nbsp;[<span class="bk-jcell-idx">${index}</span>]:`;
  const runBtn = document.createElement('button');
  runBtn.className = 'bk-jcell-run';
  runBtn.title = '运行到此';
  runBtn.textContent = '▶';
  runBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    onRun && onRun();
  });
  const statusDot = document.createElement('span');
  statusDot.className = 'bk-jcell-status';
  statusDot.title = '状态';
  prompt.appendChild(inLabel);
  prompt.appendChild(runBtn);
  prompt.appendChild(statusDot);
  wrap.appendChild(prompt);

  // ── Right content area ──────────────────────────────────────────────
  const main = document.createElement('div');
  main.className = 'bk-jcell-main';
  wrap.appendChild(main);

  const body = document.createElement('div');
  body.className = 'bk-jcell-body';
  main.appendChild(body);

  // Per-blank state: { template, inputs: [<input>...], wrapEl, hintEl }
  const blankState = {};

  function appendTemplateFragment(tplLine, seg, group, hint, { trimLeading = false } = {}) {
    const tpl = seg.template || '';
    const renderTpl = trimLeading ? tpl.trimStart() : tpl;
    // Initial values derived from any pre-existing assembled string in draft
    const initialAssembled = initialBlanks[seg.blankIndex] || '';
    const derived = deriveInputs(tpl, initialAssembled);
    const initialValues = derived || (
      // alignment failed -> put the whole thing in input 0 if there's exactly 1 input
      splitTemplate(tpl).blankCount === 1 ? [initialAssembled] : new Array(splitTemplate(tpl).blankCount).fill('')
    );

    const { parts, blankCount } = splitTemplate(renderTpl);
    const widthHints = suggestedInputWidths(tpl, seg, initialValues);
    const inputs = [];
    parts.forEach((part, i) => {
      if (part) {
        const span = document.createElement('span');
        span.className = 'bk-jcell-template-text';
        span.textContent = part;
        tplLine.appendChild(span);
      }
      if (i < parts.length - 1) {
        const inp = document.createElement('input');
        inp.type = 'text';
        inp.className = 'bk-jcell-blank-input';
        inp.spellcheck = false;
        inp.autocomplete = 'off';
        inp.autocapitalize = 'off';
        inp.value = initialValues[i] || '';
        inp.dataset.subIndex = String(i);
        inp.dataset.minChars = String(widthHints[i] || 0);
        inp.setAttribute('aria-label', seg.hint || '代码填空');
        inp.addEventListener('input', () => {
          autoGrowInput(inp);
          const vals = inputs.map(x => x.value);
          const assembled = assembleTemplate(tpl, vals);
          onBlankInput && onBlankInput(seg.blankIndex, assembled);
        });
        inp.addEventListener('keydown', (e) => {
          // Tab moves to next input within same blank, then to next blank's first input
          if (e.key === 'Tab' && !e.shiftKey && i < blankCount - 1) {
            e.preventDefault();
            inputs[i + 1].focus();
          } else if (e.key === 'Tab' && e.shiftKey && i > 0) {
            e.preventDefault();
            inputs[i - 1].focus();
          }
        });
        tplLine.appendChild(inp);
        inputs.push(inp);
      }
    });

    blankState[seg.blankIndex] = { template: tpl, inputs, group, hint };
    requestAnimationFrame(() => inputs.forEach(autoGrowInput));
  }

  function renderInlineRun() {
    const group = document.createElement('div');
    group.className = 'bk-jcell-blank-wrap is-inline';

    const hint = document.createElement('div');
    hint.className = 'bk-jcell-hint small';
    const hintMark = document.createElement('span');
    hintMark.className = 'bk-jcell-hint-mark';
    const hintText = document.createElement('span');
    hintText.className = 'bk-jcell-hint-text';
    const primaryHint = segments.find((s) => s.type === 'blank' && s.hint && s.hint !== '填空')?.hint
      || segments.find((s) => s.type === 'blank' && s.hint)?.hint
      || '填空';
    hintText.textContent = `# ${primaryHint}`;
    hint.appendChild(hintMark);
    hint.appendChild(hintText);
    group.appendChild(hint);

    const tplLine = document.createElement('div');
    tplLine.className = 'bk-jcell-template';
    group.appendChild(tplLine);

    segments.forEach((seg, idx) => {
      const prev = idx > 0 ? segments[idx - 1] : null;
      const joinPrevious = idx > 0 && shouldJoinInlineSegments(prev, seg);
      if (seg.type === 'given') {
        const span = document.createElement('span');
        span.className = 'bk-jcell-template-text';
        span.textContent = joinPrevious ? (seg.code || '').trimStart() : (seg.code || '');
        tplLine.appendChild(span);
      } else if (seg.type === 'blank') {
        appendTemplateFragment(tplLine, seg, group, hint, { trimLeading: joinPrevious });
      }
      if (idx < segments.length - 1) {
        const next = segments[idx + 1];
        if (!shouldJoinInlineSegments(seg, next)) {
          const newline = document.createElement('span');
          newline.className = 'bk-jcell-template-text';
          newline.textContent = '\n';
          tplLine.appendChild(newline);
        }
      }
    });

    body.appendChild(group);
  }

  const canRenderInlineRun =
    segments.filter((s) => s.type === 'blank').length > 1 &&
    segments.every((s) => s.type !== 'blank' || splitTemplate(s.template || '').blankCount > 0);

  if (canRenderInlineRun) {
    renderInlineRun();
  } else {
    segments.forEach((seg) => {
    if (seg.type === 'given') {
      const pre = document.createElement('pre');
      pre.className = 'bk-jcell-given';
      pre.textContent = seg.code || '';
      body.appendChild(pre);
    } else if (seg.type === 'blank') {
      const group = document.createElement('div');
      group.className = 'bk-jcell-blank-wrap is-inline';

      const hint = document.createElement('div');
      hint.className = 'bk-jcell-hint small';
      hint.innerHTML = `<span class="bk-jcell-hint-mark"></span><span class="bk-jcell-hint-text">${
        (seg.hint ? `# ${seg.hint}` : '# 填空').replace(/</g, '&lt;')
      }</span>`;
      group.appendChild(hint);

      const tpl = seg.template || '';
      // Initial values derived from any pre-existing assembled string in draft
      const initialAssembled = initialBlanks[seg.blankIndex] || '';
      const derived = deriveInputs(tpl, initialAssembled);
      const initialValues = derived || (
        // alignment failed → put the whole thing in input 0 if there's exactly 1 input
        splitTemplate(tpl).blankCount === 1 ? [initialAssembled] : new Array(splitTemplate(tpl).blankCount).fill('')
      );

      const tplLine = document.createElement('div');
      tplLine.className = 'bk-jcell-template';
      group.appendChild(tplLine);

      const { parts, blankCount } = splitTemplate(tpl);
      const widthHints = suggestedInputWidths(tpl, seg, initialValues);
      const inputs = [];
      parts.forEach((part, i) => {
        if (part) {
          const span = document.createElement('span');
          span.className = 'bk-jcell-template-text';
          span.textContent = part;
          tplLine.appendChild(span);
        }
        if (i < parts.length - 1) {
          const inp = document.createElement('input');
          inp.type = 'text';
          inp.className = 'bk-jcell-blank-input';
          inp.spellcheck = false;
          inp.autocomplete = 'off';
          inp.autocapitalize = 'off';
          inp.value = initialValues[i] || '';
          inp.dataset.subIndex = String(i);
          inp.dataset.minChars = String(widthHints[i] || 0);
          inp.setAttribute('aria-label', seg.hint || '代码填空');
          inp.addEventListener('input', () => {
            autoGrowInput(inp);
            const vals = inputs.map(x => x.value);
            const assembled = assembleTemplate(tpl, vals);
            onBlankInput && onBlankInput(seg.blankIndex, assembled);
          });
          inp.addEventListener('keydown', (e) => {
            // Tab moves to next input within same blank, then to next blank's first input
            if (e.key === 'Tab' && !e.shiftKey && i < blankCount - 1) {
              e.preventDefault();
              inputs[i + 1].focus();
            } else if (e.key === 'Tab' && e.shiftKey && i > 0) {
              e.preventDefault();
              inputs[i - 1].focus();
            }
          });
          tplLine.appendChild(inp);
          inputs.push(inp);
        }
      });

      // Fallback for legacy data without template: single textarea
      if (!tpl || blankCount === 0) {
        tplLine.remove();
        const ta = document.createElement('textarea');
        ta.className = 'bk-jcell-blank';
        ta.rows = 1;
        ta.spellcheck = false;
        ta.placeholder = seg.hint || '在此填空…';
        ta.value = initialAssembled;
        ta.addEventListener('input', () => {
          autoGrowTextarea(ta);
          onBlankInput && onBlankInput(seg.blankIndex, ta.value);
        });
        group.appendChild(ta);
        blankState[seg.blankIndex] = { template: '', inputs: [], textarea: ta, group, hint };
        requestAnimationFrame(() => autoGrowTextarea(ta));
      } else {
        blankState[seg.blankIndex] = { template: tpl, inputs, group, hint };
        requestAnimationFrame(() => inputs.forEach(autoGrowInput));
      }

      body.appendChild(group);
    }
  });
  }

  const out = document.createElement('div');
  out.className = 'bk-jcell-out';
  out.style.display = 'none';
  main.appendChild(out);

  // ── Public methods ──────────────────────────────────────────────────
  function blankAssembled(idx) {
    const st = blankState[idx];
    if (!st) return '';
    if (st.textarea) return st.textarea.value;
    return assembleTemplate(st.template, st.inputs.map(x => x.value));
  }

  wrap.$composedCode = () =>
    segments.map((s) =>
      s.type === 'given' ? s.code : blankAssembled(s.blankIndex),
    ).join('\n');

  wrap.$clearOutput = () => {
    out.innerHTML = '';
    out.style.display = 'none';
  };

  wrap.$appendStream = (text, isStderr) => {
    out.style.display = 'block';
    const line = document.createElement('pre');
    line.className = 'bk-jcell-stream' + (isStderr ? ' is-stderr' : '');
    line.textContent = text;
    out.appendChild(line);
    out.scrollTop = out.scrollHeight;
  };

  wrap.$appendDisplay = (mime, data) => {
    out.style.display = 'block';
    const d = document.createElement('div');
    d.className = 'bk-jcell-display';
    if (mime === 'image/png') {
      const img = document.createElement('img');
      img.src = 'data:image/png;base64,' + data;
      d.appendChild(img);
    } else if (mime === 'text/html') {
      d.innerHTML = data;
    } else {
      const pre = document.createElement('pre');
      pre.textContent = typeof data === 'string' ? data : JSON.stringify(data);
      d.appendChild(pre);
    }
    out.appendChild(d);
  };

  wrap.$appendError = ({ ename, evalue, traceback }) => {
    out.style.display = 'block';
    const pre = document.createElement('pre');
    pre.className = 'bk-jcell-err';
    const tb = Array.isArray(traceback) ? traceback.join('\n') : '';
    pre.textContent = `${ename}: ${evalue}\n${stripAnsi(tb)}`;
    out.appendChild(pre);
  };

  wrap.$setStatus = (s) => {
    statusDot.className = 'bk-jcell-status is-' + s;
  };

  wrap.$setIndex = (n) => {
    prompt.querySelector('.bk-jcell-idx').textContent = n;
  };

  // Accept assembled draft and re-distribute into per-input fields
  wrap.$setBlanks = (obj) => {
    Object.entries(obj || {}).forEach(([k, assembled]) => {
      const st = blankState[k];
      if (!st) return;
      if (st.textarea) {
        if (st.textarea.value !== assembled) {
          st.textarea.value = assembled;
          autoGrowTextarea(st.textarea);
        }
        return;
      }
      const derived = deriveInputs(st.template, assembled);
      if (!derived) return;
      derived.forEach((v, i) => {
        const inp = st.inputs[i];
        if (inp && inp.value !== v) {
          inp.value = v;
          autoGrowInput(inp);
        }
      });
    });
  };

  wrap.$setBlankResult = (blankIndex, ok) => {
    const st = blankState[blankIndex];
    if (!st) return;
    const targets = st.textarea ? [st.textarea] : st.inputs;
    targets.forEach(t => t.classList.remove('is-ok', 'is-bad'));
    const mark = st.hint?.querySelector('.bk-jcell-hint-mark');
    if (mark) mark.textContent = '';
    if (ok === true) {
      targets.forEach(t => t.classList.add('is-ok'));
      if (mark) mark.textContent = '✅ ';
    } else if (ok === false) {
      targets.forEach(t => t.classList.add('is-bad'));
      if (mark) mark.textContent = '❌ ';
    }
  };

  return wrap;
}

function autoGrowTextarea(el) {
  el.style.height = 'auto';
  el.style.height = el.scrollHeight + 'px';
}

// Single-line input grows horizontally with content. We measure with a
// hidden span that inherits the input's font.
let _measureSpan = null;
function autoGrowInput(el) {
  if (!_measureSpan) {
    _measureSpan = document.createElement('span');
    _measureSpan.style.cssText =
      'visibility:hidden;position:absolute;left:-9999px;top:-9999px;white-space:pre;';
    document.body.appendChild(_measureSpan);
  }
  const cs = window.getComputedStyle(el);
  _measureSpan.style.font = cs.font;
  _measureSpan.style.letterSpacing = cs.letterSpacing;
  _measureSpan.textContent = el.value || el.placeholder || ' ';
  const contentWidth = _measureSpan.offsetWidth + 12;
  const minChars = Number(el.dataset.minChars || 0);
  let minWidth = 40;
  if (Number.isFinite(minChars) && minChars > 0) {
    _measureSpan.textContent = 'M'.repeat(Math.ceil(minChars));
    minWidth = _measureSpan.offsetWidth + 12;
  }
  const w = Math.max(contentWidth, minWidth, 40);
  el.style.width = w + 'px';
}

function stripAnsi(s) {
  return String(s || '').replace(/\x1b\[[0-9;]*m/g, '');
}
