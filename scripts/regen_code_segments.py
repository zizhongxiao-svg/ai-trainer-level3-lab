#!/usr/bin/env python3
"""Regenerate code_segments for all `code` operations from their source .ipynb.

Rule: the .ipynb (with `_____` blank markers and `# 提示 X分` comments) is
canonical. operations.json blanks/given are rebuilt to match exactly. Existing
answers are reused by hint match; unmatched answers are reported.

Run:
  python3 scripts/regen_code_segments.py            # dry-run, prints diff
  python3 scripts/regen_code_segments.py --write    # write data/operations.json
"""
from __future__ import annotations

import json
import re
import sys
from pathlib import Path

ROOT = Path(__file__).parent.parent
OPS_PATH = ROOT / "data" / "operations.json"
QDIR = ROOT / "data" / "questions"

BLANK_PAT = re.compile(r"_{3,}")
COMMENT_HINT_PAT = re.compile(r"^#\s*(.+?)\s*$")
POINTS_PAT = re.compile(r"(\d+)\s*分")


def _norm_hint(s: str) -> str:
    """Normalize hint for fuzzy match: drop punctuation/spaces/CJK punct, lower."""
    if not s:
        return ""
    s = re.sub(r"[\s,，。.;；:：'\"\(\)（）]+", "", s)
    s = s.lower()
    return s


def _strip_points_marker(comment_text: str) -> tuple[str, int | None]:
    """Pull off a trailing 'X分' from a hint comment.

    '模型加载  2分' -> ('模型加载', 2)
    'X 分'-only line -> ('', X)
    """
    m = POINTS_PAT.search(comment_text)
    points = int(m.group(1)) if m else None
    cleaned = POINTS_PAT.sub("", comment_text).strip()
    cleaned = cleaned.rstrip("，,").strip()
    return cleaned, points


def _find_ipynb(qid: int) -> Path | None:
    qd = QDIR / str(qid)
    if not qd.is_dir():
        return None
    nbs = sorted(qd.glob("*.ipynb"))
    return nbs[0] if nbs else None


def _ipynb_code(path: Path) -> str:
    nb = json.loads(path.read_text(encoding="utf-8"))
    chunks = []
    for c in nb.get("cells", []):
        if c.get("cell_type") == "code":
            chunks.append("".join(c.get("source", [])))
    return "\n\n".join(chunks)


def _extract_segments(code: str, fallback_points: int = 2) -> list[dict]:
    """Walk lines; group consecutive `____`-lines into one blank.

    The comment line immediately above a blank-group becomes its hint
    (and is dropped from the preceding given segment).
    """
    lines = code.split("\n")
    segs: list[dict] = []
    given_buf: list[str] = []

    def flush_given_keep_comment_above_blank() -> tuple[list[str], str | None, int | None]:
        """Pop a trailing comment line from given_buf (skipping trailing blanks)
        and return (remaining_given_lines, hint, points)."""
        copy = list(given_buf)
        # Drop trailing all-blank lines, remember them so we can re-add structure
        trailing_blanks: list[str] = []
        while copy and copy[-1].strip() == "":
            trailing_blanks.append(copy.pop())
        hint = None
        points = None
        if copy and copy[-1].lstrip().startswith("#") and not BLANK_PAT.search(copy[-1]):
            comment_line = copy.pop().strip().lstrip("#").strip()
            cleaned, pts = _strip_points_marker(comment_line)
            hint = cleaned
            points = pts
        # Re-append trailing blanks (in original order) so the given output
        # ends with a blank line as in the source — keeps spacing consistent.
        copy.extend(reversed(trailing_blanks))
        return copy, hint, points

    i = 0
    while i < len(lines):
        if BLANK_PAT.search(lines[i]):
            kept_given, hint, points = flush_given_keep_comment_above_blank()
            if any(s.strip() for s in kept_given):
                segs.append({"type": "given", "code": "\n".join(kept_given).rstrip()})
            given_buf = []

            # Collect contiguous blank-bearing lines into one logical blank
            blank_block = [lines[i]]
            j = i + 1
            while j < len(lines) and BLANK_PAT.search(lines[j]):
                blank_block.append(lines[j])
                j += 1
            segs.append({
                "type": "blank",
                "hint": hint or "填空",
                "points": points if points is not None else fallback_points,
                "_template": "\n".join(blank_block),
            })
            i = j
            continue
        given_buf.append(lines[i])
        i += 1

    if any(s.strip() for s in given_buf):
        segs.append({"type": "given", "code": "\n".join(given_buf).rstrip()})

    return segs


def _reshape_answer(old_answer: str, new_template: str) -> str:
    """Adapt a recovered answer to fit the new .ipynb template's shape.

    1. Truncate to the same number of non-empty lines as the template.
       (old answer for `加载类别标签` had 2 lines: with-open + body, but the
        new template has only the with-open as a blank — truncate to 1.)
    2. Reapply the template's leading indent on the first line (and
       proportionally on subsequent lines) so composed code stays
       syntactically valid inside loops / `if` blocks.
    """
    if not old_answer or not new_template:
        return old_answer

    template_lines = new_template.split("\n")
    nonempty_template = [l for l in template_lines if l.strip()]
    if not nonempty_template:
        return old_answer

    template_indent = len(nonempty_template[0]) - len(nonempty_template[0].lstrip(" "))
    target_line_count = len(nonempty_template)

    old_lines = [l for l in old_answer.split("\n") if l.strip()]
    if not old_lines:
        return old_answer

    # Truncate to template's logical line count
    old_lines = old_lines[:target_line_count]

    # Re-indent: strip existing leading whitespace; prefix with template_indent
    indent = " " * template_indent
    out_lines = [indent + l.lstrip() for l in old_lines]
    return "\n".join(out_lines)


def _build_answer_index(old_segments: list[dict]) -> dict[str, str]:
    """hint(normalized) -> answer (from old operations.json)."""
    idx: dict[str, str] = {}
    for s in old_segments or []:
        if s.get("type") == "blank" and s.get("answer"):
            key = _norm_hint(s.get("hint", ""))
            if key and key not in idx:
                idx[key] = s["answer"]
    return idx


def regenerate_one(op: dict) -> tuple[list[dict], list[str], dict]:
    """Return (new_segments, warnings, stats)."""
    qid = op["id"]
    nb_path = _find_ipynb(qid)
    if not nb_path:
        return [], [f"q{qid}: no .ipynb found, skipping"], {}
    code = _ipynb_code(nb_path)

    new_segs = _extract_segments(code)
    if not new_segs:
        return [], [f"q{qid}: extraction yielded zero segments"], {}

    # ── Pass 1: hint match ──────────────────────────────────────────────
    old_blanks = [s for s in (op.get("code_segments") or []) if s.get("type") == "blank"]
    old_by_hint: dict[str, list[int]] = {}
    for i, s in enumerate(old_blanks):
        key = _norm_hint(s.get("hint", ""))
        if key:
            old_by_hint.setdefault(key, []).append(i)
    used_old: set[int] = set()
    warnings: list[str] = []
    matched = 0

    new_blanks = [(i, s) for i, s in enumerate(new_segs) if s["type"] == "blank"]
    matched_status = [False] * len(new_blanks)

    # ── Pass 0: explicit overrides win ─────────────────────────────────
    try:
        from scripts.manual_blank_answers import MANUAL_ANSWERS  # type: ignore
    except ImportError:
        from manual_blank_answers import MANUAL_ANSWERS  # type: ignore
    for ni, (_, s) in enumerate(new_blanks):
        ans = MANUAL_ANSWERS.get((qid, ni))
        if ans is not None:
            s["answer"] = ans
            matched_status[ni] = True
            matched += 1

    for ni, (_, s) in enumerate(new_blanks):
        if matched_status[ni]:
            continue
        key = _norm_hint(s["hint"])
        if key and key in old_by_hint:
            for oi in old_by_hint[key]:
                if oi not in used_old:
                    s["answer"] = _reshape_answer(
                        old_blanks[oi].get("answer", ""), s.get("_template", "")
                    )
                    used_old.add(oi)
                    matched += 1
                    matched_status[ni] = True
                    break

    # ── Pass 2: LHS-aware fallback for still-unmatched ─────────────────
    # Only pair a new blank with an old blank when the assignment LHS (or first
    # identifier) matches. This avoids gluing unrelated semantics together.
    def _first_lhs(text: str) -> str:
        if not text:
            return ""
        first_line = text.split("\n", 1)[0]
        m = re.match(r"\s*([A-Za-z_][\w\.,\s]*?)\s*[=\(]", first_line)
        if m:
            # Drop spaces inside multi-target like "X_train, X_test"
            return re.sub(r"\s+", "", m.group(1))
        # Statement-style: take the leading identifier
        m = re.match(r"\s*([A-Za-z_][\w\.]*)", first_line)
        return m.group(1) if m else ""

    def _template_lhs(template: str) -> str:
        # First non-blank-marker text in the template — usually `varname = ___`
        for line in template.split("\n"):
            if line.strip():
                # Replace ____ with a placeholder so regex still picks LHS
                cleaned = BLANK_PAT.sub("X", line)
                return _first_lhs(cleaned)
        return ""

    unmatched_new = [ni for ni, ok in enumerate(matched_status) if not ok]
    unmatched_old = {oi for oi in range(len(old_blanks)) if oi not in used_old}
    pos_paired = 0
    for ni in unmatched_new:
        s = new_blanks[ni][1]
        tpl_lhs = _template_lhs(s.get("_template", ""))
        if not tpl_lhs:
            continue
        # Find any unused old blank with matching answer-LHS
        for oi in list(unmatched_old):
            old_lhs = _first_lhs(old_blanks[oi].get("answer", ""))
            if old_lhs and old_lhs == tpl_lhs:
                s["answer"] = _reshape_answer(
                    old_blanks[oi].get("answer", ""), s.get("_template", "")
                )
                unmatched_old.discard(oi)
                used_old.add(oi)
                matched += 1
                matched_status[ni] = True
                pos_paired += 1
                warnings.append(
                    f"q{qid}: LHS-paired ({tpl_lhs!r}) new blank #{ni} "
                    f"(hint={s['hint']!r}) with old blank #{oi} "
                    f"(hint={old_blanks[oi].get('hint','')!r})"
                )
                break

    unmatched = sum(1 for ok in matched_status if not ok)
    for ni, ok in enumerate(matched_status):
        if not ok:
            s = new_blanks[ni][1]
            warnings.append(
                f"q{qid}: NO ANSWER for blank hint={s['hint']!r}; template={s.get('_template','')[:60]!r}"
            )
            s["answer"] = ""

    # Promote private _template to public `template` so frontend can render
    # inline blanks (text + <input> alternating on the same line).
    for s in new_segs:
        if s["type"] == "blank":
            tpl = s.pop("_template", "")
            if tpl:
                s["template"] = tpl

    # Surface old answers that no longer have a slot (those were over-blanked)
    leftover = [oi for oi in range(len(old_blanks)) if oi not in used_old]
    if leftover:
        leftover_hints = [old_blanks[oi].get("hint", "") for oi in leftover]
        warnings.append(f"q{qid}: dropped (now-given) blanks: {leftover_hints}")

    blank_count = sum(1 for s in new_segs if s["type"] == "blank")
    total_score = sum(int(s.get("points") or 0) for s in new_segs if s["type"] == "blank")

    stats = {
        "qid": qid,
        "old_blanks": sum(1 for s in (op.get("code_segments") or []) if s.get("type") == "blank"),
        "new_blanks": blank_count,
        "matched": matched,
        "unmatched": unmatched,
        "old_total": op.get("total_score"),
        "new_total": total_score,
    }
    return new_segs, warnings, stats


def main() -> int:
    write = "--write" in sys.argv
    only = None
    if "--only" in sys.argv:
        only = sys.argv[sys.argv.index("--only") + 1]
        only = set(int(x) for x in only.split(","))

    ops = json.loads(OPS_PATH.read_text(encoding="utf-8"))
    all_warnings: list[str] = []
    all_stats: list[dict] = []
    changed = 0

    for op in ops:
        if op.get("type") != "code":
            continue
        if only is not None and op["id"] not in only:
            continue
        new_segs, warns, stats = regenerate_one(op)
        all_warnings.extend(warns)
        if stats:
            all_stats.append(stats)
        if not new_segs:
            continue
        op["code_segments"] = new_segs
        op["blank_count"] = stats["new_blanks"]
        # Total: keep aligned with sum of blank points (most faithful).
        op["total_score"] = stats["new_total"]
        changed += 1

    print(f"\n{'qid':>4} | {'old_b':>5} -> {'new_b':>5} | {'old_t':>5} -> {'new_t':>5} | {'matched':>7}/{'umatched':>8}")
    print("-" * 70)
    for s in all_stats:
        print(f"{s['qid']:>4} | {s['old_blanks']:>5} -> {s['new_blanks']:>5} | "
              f"{(s['old_total'] or 0):>5} -> {s['new_total']:>5} | {s['matched']:>7}/{s['unmatched']:>8}")
    if all_warnings:
        print("\nWARNINGS:")
        for w in all_warnings:
            print(f"  - {w}")

    if write:
        if any(s["unmatched"] for s in all_stats):
            print("\n⚠ unmatched blanks present — refuse to write. Add hints or use a manual map.")
            return 2
        OPS_PATH.write_text(json.dumps(ops, ensure_ascii=False, indent=2), encoding="utf-8")
        print(f"\n✅ Wrote {OPS_PATH} (changed {changed} ops).")
    else:
        print(f"\nDry-run only. Pass --write to apply.")

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
