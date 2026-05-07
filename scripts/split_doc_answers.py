#!/usr/bin/env python3
"""把 doc 类操作题的 answer_sections 整段答案切成 per-rubric。

切完之后前端 operations-doc.js 的"按 rubric id 切分"分支会自动接管，
每个评分项卡片下方各自显示自己的参考答案，不再展示整段大卡。

三类切分策略：
- A 类（rubric desc 含节标记如 1.2.1-1）：按节标记切；多个 M 共用一段
- B 类（id 21-25，无节标记，靠子标题手动定 anchor）
- C 类（仅一个 M1 兜底）：整段 → M1
"""
from __future__ import annotations

import json
import re
import sys
from pathlib import Path

OPS_PATH = Path(__file__).resolve().parents[1] / 'data' / 'operations.json'

TYPE_B_ANCHORS = {
    21: ['用户使用习惯', '功能使用频率', '响应时间分析', '优化方向及解决方案'],
    22: ['用户使用习惯', '智能场景使用频率', '响应时间分析', '优化方向及解决方案'],
    23: ['用户活动模式', '健康指标关注度', '数据同步性能', '优化方向及解决方案'],
    24: ['用户活动周期', '健康指标偏好度', '系统响应与准确性', '优化方向及解决方案'],
    25: ['用户环境偏好', '系统响应时间', '能源消耗分析', '优化方向及解决方案'],
}

MARK_RE = re.compile(r'\d+\.\d+\.\d+\s*[\-–]\s*\d+')


def _norm(s: str) -> str:
    return s.replace(' ', '').replace('–', '-')


def _section_text(section: dict) -> str:
    return section.get('content') or section.get('text') or ''


def _answer_blob(d: dict) -> str:
    """Return a stable source blob whether data is raw or already per-rubric."""
    seen: set[str] = set()
    parts: list[str] = []
    for section in d.get('answer_sections') or []:
        text = _section_text(section).strip()
        if text and text not in seen:
            seen.add(text)
            parts.append(text)
    return '\n\n'.join(parts)


def _classify(d: dict) -> str:
    if d['id'] in TYPE_B_ANCHORS:
        return 'B'
    if d.get('rubric') and MARK_RE.search(d['rubric'][0].get('desc', '')):
        return 'A'
    return 'C'


def _split_a(d: dict) -> list[dict]:
    blob = _answer_blob(d)
    matches = list(MARK_RE.finditer(blob))
    if not matches:
        existing = [
            {'id': s.get('id'), 'type': 'text', 'text': _section_text(s).strip()}
            for s in d.get('answer_sections') or []
            if s.get('id') and _section_text(s).strip()
        ]
        rubric_ids = [r['id'] for r in d.get('rubric') or []]
        if [s['id'] for s in existing] == rubric_ids:
            return existing
    raw: dict[str, list[str]] = {}
    for i, m in enumerate(matches):
        mk = _norm(m.group(0))
        end = matches[i + 1].start() if i + 1 < len(matches) else len(blob)
        raw.setdefault(mk, []).append(blob[m.start():end].strip())
    pieces: dict[str, str] = {k: '\n\n'.join(v) for k, v in raw.items()}
    if 6 <= d['id'] <= 10:
        return _split_effect_optimization(d, pieces)
    out = []
    for r in d['rubric']:
        m = MARK_RE.search(r['desc'])
        text = pieces.get(_norm(m.group(0)), '') if m else ''
        out.append({'id': r['id'], 'type': 'text', 'text': text})
    return out


def _split_b(d: dict) -> list[dict]:
    blob = _answer_blob(d)
    cut = blob.find('请勿修改答题卷')
    body = blob[cut:] if cut >= 0 else blob
    anchors = TYPE_B_ANCHORS[d['id']]
    positions, last = [], 0
    for a in anchors:
        idx = body.find(a, last)
        if idx < 0:
            raise ValueError(f'#{d["id"]} anchor {a!r} not found after pos {last}')
        positions.append((a, idx))
        last = idx + len(a)
    out = []
    for i, r in enumerate(d['rubric']):
        _, start = positions[i]
        end = positions[i + 1][1] if i + 1 < len(positions) else len(body)
        out.append({'id': r['id'], 'type': 'text', 'text': body[start:end].strip()})
    return out


def _split_c(d: dict) -> list[dict]:
    blob = _answer_blob(d)
    return [{'id': d['rubric'][0]['id'], 'type': 'text', 'text': blob.strip()}]


def _clean_lines(text: str) -> list[str]:
    return [line.strip() for line in text.splitlines() if line.strip()]


def _strip_bullet(line: str) -> str:
    return re.sub(r'^[•\-\*]\s*', '', line.strip())


def _is_problem_heading(line: str) -> bool:
    s = _strip_bullet(line)
    return bool(
        re.match(r'^问题[一二三四五六七八九十\d]+[:：]', s)
        or re.match(r'^\d+[.、]\s*[^:：]{2,40}[:：]\s*$', s)
    )


def _is_label_line(line: str) -> bool:
    s = _strip_bullet(line).replace(' ', '')
    return bool(re.match(r'^(原因|解释|影响使用体验|影响|技术原因|流程原因)[:：]', s))


def _split_problem_blocks(text: str) -> list[tuple[str, list[str]]]:
    blocks: list[tuple[str, list[str]]] = []
    current_title = ''
    current_lines: list[str] = []
    for line in _clean_lines(text):
        if MARK_RE.fullmatch(line):
            continue
        if _is_problem_heading(line):
            if current_title:
                blocks.append((current_title, current_lines))
            current_title = _strip_bullet(line)
            current_lines = []
        elif current_title:
            current_lines.append(line)
    if current_title:
        blocks.append((current_title, current_lines))
    return blocks


def _problem_titles(text: str) -> str:
    titles = [title for title, _ in _split_problem_blocks(text)]
    return '\n'.join(titles).strip()


def _problem_details(text: str, labels: set[str] | None = None) -> str:
    out: list[str] = []
    for title, lines in _split_problem_blocks(text):
        captured: list[str] = []
        keep = labels is None
        for line in lines:
            label = re.sub(r'[:：].*$', '', _strip_bullet(line)).replace(' ', '')
            if _is_label_line(line):
                keep = labels is None or label in labels
            if keep:
                captured.append(line)
        if captured:
            out.append('\n'.join([title, *captured]))
    return '\n\n'.join(out).strip()


def _split_expected(text: str) -> tuple[str, str]:
    m = re.search(r'(?m)^\s*(?:[一二三四五六七八九十]+、)?(?:三、)?(?:二、)?(?:预期效果|期望的优化效果)\s*$', text)
    if not m:
        return text.strip(), ''
    return text[:m.start()].strip(), text[m.start():].strip()


def _step_headings(text: str) -> str:
    body, _ = _split_expected(text)
    headings: list[str] = []
    for line in _clean_lines(body):
        s = _strip_bullet(line)
        if MARK_RE.fullmatch(s) or s in {'实施步骤', '一、实施步骤', '优化方案：'}:
            continue
        if re.match(r'^\d+[.、]?\s+[^。；;:：]{2,36}$', s):
            headings.append(s)
    return '\n'.join(headings).strip()


def _step_details(text: str) -> str:
    body, _ = _split_expected(text)
    lines = [
        line for line in _clean_lines(body)
        if not MARK_RE.fullmatch(line)
        and line not in {'实施步骤', '一、实施步骤', '优化方案：'}
    ]
    return '\n'.join(lines).strip()


def _expected_effects(text: str) -> str:
    _, expected = _split_expected(text)
    return expected.strip()


def _team_and_expected(text: str) -> str:
    body, expected = _split_expected(text)
    m = re.search(r'(?m)^\s*\d+[.、]?\s*团队协调\s*$', body)
    if not m:
        return expected.strip()
    return '\n\n'.join(part for part in [body[m.start():].strip(), expected.strip()] if part)


def _split_effect_optimization(d: dict, pieces: dict[str, str]) -> list[dict]:
    """Further split 1.2.x effect-optimization answers by scoring point.

    These questions share the same source section across multiple rubric items
    (for example "problem list" and "problem explanation"). Showing the whole
    shared section under each item made several answers look duplicated.
    """
    out = []
    for r in d['rubric']:
        desc = r.get('desc', '')
        m = MARK_RE.search(desc)
        source = pieces.get(_norm(m.group(0)), '') if m else ''
        text = source
        if source and m:
            mark = _norm(m.group(0))
            if mark.endswith('-1'):
                if '导致问题' in desc or '技术或流程原因' in desc:
                    text = _problem_details(source, {'技术原因', '流程原因', '原因'})
                elif '影响' in desc and '问题' not in desc:
                    text = _problem_details(source, {'影响', '影响使用体验'})
                elif '问题' in desc and '解释' not in desc and '说明为什么' not in desc:
                    text = _problem_titles(source)
                else:
                    text = _problem_details(source)
            elif mark.endswith('-2'):
                if '团队资源协调' in desc:
                    text = _team_and_expected(source)
                elif '期望' in desc or '预期' in desc:
                    text = _expected_effects(source)
                elif '详细' in desc or '关键实施步骤' in desc:
                    text = _step_details(source)
                else:
                    text = _step_headings(source)
        out.append({'id': r['id'], 'type': 'text', 'text': text.strip()})
    return out


def main(argv: list[str]) -> int:
    dry_run = '--dry-run' in argv
    ops = json.loads(OPS_PATH.read_text(encoding='utf-8'))
    docs = [o for o in ops if o.get('type') == 'doc']
    print(f'doc 总数: {len(docs)}')

    summary = {'A': 0, 'B': 0, 'C': 0, 'fail': 0}
    for d in docs:
        cls = _classify(d)
        try:
            if cls == 'A':
                secs = _split_a(d)
            elif cls == 'B':
                secs = _split_b(d)
            else:
                secs = _split_c(d)
        except Exception as e:
            print(f'  ✗ #{d["id"]} [{cls}] {e}')
            summary['fail'] += 1
            continue
        d['answer_sections'] = secs
        summary[cls] += 1
        print(f'  ✓ #{d["id"]:>2} [{cls}] -> {len(secs)} sections, '
              f'lens={[len(s["text"]) for s in secs]}')

    print(f'\n汇总: A={summary["A"]} B={summary["B"]} C={summary["C"]} '
          f'fail={summary["fail"]}')
    if summary['fail']:
        print('有失败项，未写回。', file=sys.stderr)
        return 1

    if dry_run:
        print('(dry-run，未写回)')
        return 0

    OPS_PATH.write_text(json.dumps(ops, ensure_ascii=False, indent=2), encoding='utf-8')
    print(f'已写回 {OPS_PATH}')
    return 0


if __name__ == '__main__':
    sys.exit(main(sys.argv[1:]))
