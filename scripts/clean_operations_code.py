#!/usr/bin/env python3
"""Clean up code_segments in data/operations.json.

Fixes PDF-extraction artifacts that make code unrunnable:
- Smart/fullwidth quotes (“ ” ‘ ’ ＂ ＇) → straight ASCII quotes in code
- Continuation-line leading-space artifacts from two-column PDF layout
  (e.g. "import pandas as pd\\n           import numpy as np")

The indentation heuristic is intentionally conservative:
  If the first line is NOT a Python block-opener (does not end with ':'),
  then every following non-empty line should share the first line's indent.
  We dedent continuation lines by (min_cont_indent - first_indent).
  For block openers we leave indentation alone to preserve body indent.
"""
from __future__ import annotations

import ast
import json
import re
import sys
from pathlib import Path

ROOT = Path(__file__).parent.parent
OPS_PATH = ROOT / "data" / "operations.json"

_SMART_QUOTES = {
    "\u201c": '"', "\u201d": '"',   # “ ”
    "\u2018": "'", "\u2019": "'",   # ‘ ’
    "\uff02": '"', "\uff07": "'",   # ＂ ＇
    "\u301d": '"', "\u301e": '"',   # 〝 〞
}


def _fix_quotes(text: str) -> str:
    for bad, good in _SMART_QUOTES.items():
        text = text.replace(bad, good)
    return text


def _dedent_continuations(text: str) -> str:
    """Remove PDF column-offset artifact from continuation lines.

    Only applies when the first non-empty line is not a block-opener,
    i.e. all lines should be at the same indent level.
    """
    lines = text.split("\n")
    # Find first non-empty line
    first_i = next((i for i, l in enumerate(lines) if l.strip()), None)
    if first_i is None:
        return text
    first = lines[first_i]
    first_indent = len(first) - len(first.lstrip(" \t"))

    if first.rstrip().endswith(":"):
        return text  # leave block bodies alone

    cont_indents = [
        len(l) - len(l.lstrip(" \t"))
        for l in lines[first_i + 1:]
        if l.strip()
    ]
    if not cont_indents:
        return text
    cont_min = min(cont_indents)
    offset = cont_min - first_indent
    if offset <= 0:
        return text

    new_lines = list(lines[: first_i + 1])
    for l in lines[first_i + 1:]:
        if l.strip():
            lead = len(l) - len(l.lstrip(" \t"))
            drop = min(offset, lead)
            new_lines.append(l[drop:])
        else:
            new_lines.append(l)
    return "\n".join(new_lines)


_PY_KEYWORDS = (
    "import ", "from ", "print", "def ", "class ", "if ", "for ", "while ",
    "with ", "return", "try", "except", "else", "elif ", "raise ", "assert ",
    "yield", "pass", "break", "continue", "lambda", "global ", "nonlocal ",
)


def _looks_like_code(line: str) -> bool:
    s = line.strip()
    if not s:
        return True  # blank lines kept as structural
    # Notebook "In [ ] :" / "Out [ ] :" markers are always output
    if re.match(r"^(In|Out)\s*\[.*\]\s*:?$", s):
        return False
    # Common pandas/console output prefixes
    if re.match(
        r"^(Columns|Name|dtype|Length|Freq|Index|Data columns|RangeIndex|"
        r"Empty DataFrame|\[\d+ rows x)\b",
        s,
    ):
        return False
    # Orphan line-continuation backslash with no other content
    if s == "\\":
        return False
    if s.startswith("#"):
        return True
    if s.startswith(_PY_KEYWORDS):
        return True
    # Contains python-code punctuation
    if any(ch in s for ch in "=()[]{}"):
        return True
    # Continuation-like (ends with backslash, comma, or operator)
    if s.endswith(("\\", ",", "+", "-", "*", "/", "&", "|")):
        return True
    return False


def _strip_trailing_output(text: str) -> str:
    """Drop trailing PDF execution-output lines that are not valid Python."""
    lines = text.split("\n")
    # Walk backward to find the last code-like, non-blank line
    last_code = -1
    for i, l in enumerate(lines):
        if l.strip() and _looks_like_code(l):
            last_code = i
    if last_code < 0:
        return text
    return "\n".join(lines[: last_code + 1])


def _drop_leading_output(text: str) -> str:
    """Drop leading non-code output lines (e.g. 'In [ ] :' markers)."""
    lines = text.split("\n")
    first_code = None
    for i, l in enumerate(lines):
        if not l.strip():
            continue
        if _looks_like_code(l):
            first_code = i
            break
    if first_code is None:
        return text
    return "\n".join(lines[first_code:])


def clean_code_field(text: str) -> str:
    if not text:
        return text
    text = _fix_quotes(text)
    text = _drop_leading_output(text)
    text = _strip_trailing_output(text)
    text = _dedent_continuations(text)
    return text.rstrip() + ("\n" if text.endswith("\n") else "")


# ── Token-level respace (PDF char-separation fix for answer fields) ─────────

_STR_PATTERN = re.compile(
    r"""
    ( '''.*?'''              # triple single
    | \"\"\".*?\"\"\"          # triple double
    | '(?:\\.|[^'\\])*'      # single-quoted
    | "(?:\\.|[^"\\])*"      # double-quoted
    | \#[^\n]*                # comments
    )
    """,
    re.DOTALL | re.VERBOSE,
)


def _respace_outside_strings(text: str) -> str:
    """Collapse PDF-introduced spaces around Python punctuation.

    Only touches segments OUTSIDE string literals and comments.
    Idempotent: running twice produces the same output.
    """
    parts = _STR_PATTERN.split(text)
    for i, seg in enumerate(parts):
        # Even indices = outside strings/comments; odd = literals to preserve
        if i % 2 == 1:
            continue
        # Drop spaces immediately before .()[],:
        seg = re.sub(r"[ \t]+([.(),\[\]:])", r"\1", seg)
        # Drop spaces immediately after ([. (keep `, ` normalized separately)
        seg = re.sub(r"([(\[.])[ \t]+", r"\1", seg)
        # Normalize `,` → `, ` (strip then one space back)
        seg = re.sub(r",[ \t]*", ", ", seg)
        # But not at end of line — strip trailing ", "
        seg = re.sub(r",\s*\n", ",\n", seg)
        # Collapse multi-space
        seg = re.sub(r"[ \t]{2,}", " ", seg)
        parts[i] = seg
    return "".join(parts)


def _try_parse(src: str) -> bool:
    try:
        ast.parse(src)
        return True
    except (SyntaxError, ValueError, IndentationError):
        return False


def _join_broken_identifiers(src: str) -> str:
    """Heuristic: PDF sometimes mangles `_` inside identifiers into a space.

    Detect on left-hand side of assignment: `ident ident =` → `ident_ident =`.
    """
    return re.sub(
        r"\b([A-Za-z_][A-Za-z0-9_]*)\s+([A-Za-z_][A-Za-z0-9_]*)\s*=(?!=)",
        r"\1_\2 =",
        src,
    )


def repair_answer_code(src: str) -> tuple[str, bool]:
    """Produce a cleaner, still-parseable form of the answer snippet.

    Strategy:
      1. Respace around punctuation (collapses PDF char-separation).
      2. If respaced version parses, prefer it (pretty).
      3. If respace broke parsing but the original parsed, keep original.
      4. If neither parses, try broken-identifier join; else flag unparseable.
    """
    if not src or not src.strip():
        return src, True
    orig_ok = _try_parse(src)
    t1 = _respace_outside_strings(src)
    if _try_parse(t1):
        return t1, True
    if orig_ok:
        # respacing broke it — keep original to avoid corruption
        return src, True
    t2 = _join_broken_identifiers(t1)
    if _try_parse(t2):
        return t2, True
    # Still not parseable; return best-effort respaced text + flag
    return t1, False


# ── Narrative text cleanup (scenario / tasks / solution_guide) ──────────────
# PDF extractions leave: bullet-font glyphs in private-use area (\uf06c \uf0d8),
# fullwidth space (\u3000), doubled spaces after punctuation, and mid-sentence
# paragraph breaks (line wraps the PDF emitted as \n\n).

_PUA_BULLETS = {
    "\uf06c": "•",   # Wingdings small-square → bullet
    "\uf0d8": "▸",   # Wingdings arrow       → triangle bullet
    "\uf0fc": "•",
    "\uf0a7": "▪",
    "\uf075": "◆",
    "\uf09f": "◇",
}


_CJK = r"[\u3400-\u9FFF\uFF00-\uFFEF]"


def _normalize_whitespace(text: str) -> str:
    # Fullwidth space → regular space
    text = text.replace("\u3000", " ")
    # Drop zero-width joiners / BOMs that sometimes leak through
    text = text.replace("\u200b", "").replace("\ufeff", "")
    # Strip space before CJK punctuation ("， " → "，")
    text = re.sub(r"[ \t]+([，。；：、？！）】」』”’])", r"\1", text)
    # Strip space after CJK punctuation ("， " inserted by PDF between CJK chars)
    text = re.sub(r"([，。；：、？！（【「『“‘])[ \t]+", r"\1", text)
    # Strip single spaces wedged between two CJK characters
    text = re.sub(rf"({_CJK})[ \t]+({_CJK})", r"\1\2", text)
    text = re.sub(rf"({_CJK})[ \t]+({_CJK})", r"\1\2", text)  # re-run once
    # Collapse runs of regular spaces
    text = re.sub(r"[ \t]{2,}", " ", text)
    return text


def _replace_pua_bullets(text: str) -> str:
    for bad, good in _PUA_BULLETS.items():
        text = text.replace(bad, good)
    # Any remaining private-use-area glyph → drop
    return re.sub(r"[\uE000-\uF8FF]", "", text)


_CJK_END_PUNCT = "。！？；：、，）】」』"


def _merge_mid_sentence_breaks(text: str) -> str:
    """Collapse paragraph-internal `\n\n` that the PDF inserted at column wraps.

    Heuristic: if a paragraph does NOT end with terminal punctuation and the
    next paragraph does NOT start with a list-bullet or numeric marker,
    merge them with a single space.
    """
    paras = text.split("\n\n")
    out: list[str] = []
    buf = ""
    bullet_start = re.compile(r"^\s*(?:[•▸▪◆◇\-\*]|[（(]?\d+[)）.]|[①-⑳])")
    for p in paras:
        stripped = p.strip()
        if not stripped:
            if buf:
                out.append(buf)
                buf = ""
            out.append("")
            continue
        if not buf:
            buf = p
            continue
        last_char = buf.rstrip()[-1:] if buf.rstrip() else ""
        starts_list = bool(bullet_start.match(p))
        if last_char and last_char not in _CJK_END_PUNCT and not starts_list:
            # merge as a soft wrap; no joining space when both sides are CJK
            left = buf.rstrip()
            joiner = ""
            if re.match(_CJK, last_char) and re.match(_CJK, stripped[:1]):
                joiner = ""
            else:
                joiner = " "
            buf = left + joiner + stripped
        else:
            out.append(buf)
            buf = p
    if buf:
        out.append(buf)
    return "\n\n".join(out)


def clean_narrative(text: str) -> str:
    """Clean a human-readable field (scenario / task text / guide step).

    Unlike clean_code_field, this preserves CJK smart quotes — they belong in
    Chinese prose. Only private-use-area bullets + whitespace oddities are
    stripped.
    """
    if not text:
        return text
    text = _replace_pua_bullets(text)
    text = _normalize_whitespace(text)
    text = _merge_mid_sentence_breaks(text)
    # Final touch: trim trailing whitespace on each line
    text = "\n".join(line.rstrip() for line in text.split("\n"))
    return text.strip()


def _is_all_output(text: str) -> bool:
    """True if cleaned text has no code-like lines at all."""
    if not text or not text.strip():
        return True
    for l in text.split("\n"):
        if l.strip() and _looks_like_code(l) and not l.strip().startswith("#"):
            return False
    # Only blank lines or bare comments → not useful as given code
    return True


def _is_parseable(text: str) -> bool:
    """True if text is syntactically valid Python (empty counts as valid)."""
    if not text or not text.strip():
        return True
    try:
        ast.parse(text)
        return True
    except SyntaxError:
        return False


def _clean_narrative_field(obj: dict, key: str) -> int:
    orig = obj.get(key)
    if not isinstance(orig, str) or not orig:
        return 0
    cleaned = clean_narrative(orig)
    if cleaned != orig:
        obj[key] = cleaned
        return 1
    return 0


def main() -> int:
    ops = json.loads(OPS_PATH.read_text(encoding="utf-8"))
    changed = 0
    dropped = 0
    text_changed = 0
    ans_repaired = 0
    ans_unparseable = 0
    for op in ops:
        # 1) Code segments
        segs = op.get("code_segments") or []
        new_segs = []
        for seg in segs:
            for field in ("code", "answer"):
                orig = seg.get(field)
                if not orig:
                    continue
                cleaned = clean_code_field(orig)
                if cleaned != orig:
                    seg[field] = cleaned
                    changed += 1
            if seg.get("type") == "given":
                code = seg.get("code") or ""
                if _is_all_output(code) or not _is_parseable(code):
                    dropped += 1
                    continue
            # Token-respace for answer snippets that PDF extraction broke
            if seg.get("type") == "blank" and seg.get("answer"):
                orig_ans = seg["answer"]
                repaired, ok = repair_answer_code(orig_ans)
                if repaired != orig_ans:
                    seg["answer"] = repaired
                    ans_repaired += 1
                if not ok:
                    seg["answer_parseable"] = False
                    ans_unparseable += 1
                else:
                    seg.pop("answer_parseable", None)
            new_segs.append(seg)
        op["code_segments"] = new_segs

        # Also clean `answer_sections` content (rendered in solution view)
        for sec in op.get("answer_sections") or []:
            if sec.get("type") == "code" and sec.get("content"):
                orig = sec["content"]
                repaired, _ = repair_answer_code(orig)
                if repaired != orig:
                    sec["content"] = repaired
                    ans_repaired += 1

        # 2) Narrative fields
        text_changed += _clean_narrative_field(op, "scenario")
        text_changed += _clean_narrative_field(op, "title")
        for task in op.get("tasks") or []:
            text_changed += _clean_narrative_field(task, "text")
        for r in op.get("rubric") or []:
            text_changed += _clean_narrative_field(r, "desc")
        guide = op.get("solution_guide") or {}
        if isinstance(guide, dict):
            text_changed += _clean_narrative_field(guide, "overview")
            for step in guide.get("steps") or []:
                text_changed += _clean_narrative_field(step, "title")
                text_changed += _clean_narrative_field(step, "description")
                tips = step.get("tips") or []
                for i, tip in enumerate(tips):
                    if isinstance(tip, str):
                        new_tip = clean_narrative(tip)
                        if new_tip != tip:
                            tips[i] = new_tip
                            text_changed += 1
    OPS_PATH.write_text(
        json.dumps(ops, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )
    print(
        f"Cleaned {changed} code segment fields, "
        f"dropped {dropped} all-output given segments, "
        f"cleaned {text_changed} narrative fields, "
        f"repaired {ans_repaired} answer snippets "
        f"({ans_unparseable} remain unparseable), "
        f"across {len(ops)} operations."
    )
    return 0


if __name__ == "__main__":
    sys.exit(main())
