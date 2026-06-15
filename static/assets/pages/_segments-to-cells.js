// Split operations.json's flat code_segments into notebook cells.
//
// Preferred path: when every segment carries an integer `cell` (added by
// scripts/add_cell_groups.py from the source .ipynb), group strictly by it so
// each task's output renders under its own cell — matching real Jupyter / the
// reference PDF.
//
// Fallback path (data without `cell`): the legacy heuristic — one cell per
// blank, joining continuation lines. Kept for backward compatibility.

function firstCodeLine(code = '') {
  return String(code).split('\n').find((line) => line.trim() && !line.trimStart().startsWith('#')) || '';
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

function segmentSource(s) {
  return s?.type === 'given' ? (s.code || '') : (s?.template || s?.answer || '');
}

function pushCellSegment(buffer, segment, blankIdxRef) {
  if (segment.type === 'given') {
    buffer.push({ type: 'given', code: segment.code || '' });
    return blankIdxRef.value;
  }
  buffer.push({
    type: 'blank',
    hint: segment.hint,
    template: segment.template || '',
    answer: segment.answer || '',
    input_widths: segment.input_widths || [],
    points: segment.points,
    blankIndex: blankIdxRef.value++,
  });
  return blankIdxRef.value;
}

// Group by the explicit `cell` field. blankIndex stays sequential in segment
// order so the grading/draft contract (blankIndex -> answer) is unchanged.
function groupByCellField(segments) {
  const cells = [];
  const blankIdxRef = { value: 0 };
  let curCell = null;
  let buffer = null;
  for (const s of segments) {
    if (s.cell !== curCell) {
      if (buffer) cells.push({ segments: buffer });
      curCell = s.cell;
      buffer = [];
    }
    pushCellSegment(buffer, s, blankIdxRef);
  }
  if (buffer) cells.push({ segments: buffer });
  return cells;
}

export function segmentsToCells(segments) {
  const segs = segments || [];
  const explicitCells = segs
    .filter((s) => Number.isInteger(s.cell))
    .map((s) => s.cell);
  const distinctExplicitCells = new Set(explicitCells);

  // Use source notebook cells when they actually provide structure. Some
  // source notebooks contain the whole exercise in one code cell; for those,
  // falling back to the legacy blank-based split keeps the UI usable.
  if (segs.length && explicitCells.length === segs.length && distinctExplicitCells.size > 1) {
    return groupByCellField(segs);
  }

  // ── Legacy heuristic ──────────────────────────────────────────────
  const cells = [];
  let buffer = [];
  let blankIdx = 0;
  const blankIdxRef = { value: 0 };
  for (let i = 0; i < segs.length; i++) {
    const s = segs[i];
    if (s.type === 'given') {
      buffer.push({ type: 'given', code: s.code || '' });
    } else if (s.type === 'blank') {
      blankIdxRef.value = blankIdx;
      pushCellSegment(buffer, s, blankIdxRef);
      blankIdx = blankIdxRef.value;
      let continuationOpen = endsWithContinuation(segmentSource(s));
      while (i + 1 < segs.length) {
        const next = segs[i + 1];
        const nextSource = segmentSource(next);
        if (!continuationOpen && !startsAsContinuation(nextSource)) break;
        i++;
        pushCellSegment(buffer, next, blankIdxRef);
        blankIdx = blankIdxRef.value;
        continuationOpen = endsWithContinuation(nextSource);
      }
      cells.push({ segments: buffer });
      buffer = [];
    }
  }
  if (buffer.length) cells.push({ segments: buffer });
  return cells;
}
