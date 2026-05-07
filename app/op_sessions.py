from __future__ import annotations
"""REST /api/operations/sessions —— 操作题会话 CRUD。"""
import ast
import builtins
import json
import keyword
import re
import sqlite3
import textwrap
from difflib import SequenceMatcher
from datetime import datetime
from pathlib import Path
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, Field

from app.auth import get_current_user
from app.db import get_db
from app.ai_grading import grade_doc_answer_with_ai
from app.edition import AIGradingDisabled
from app.ops_unlock import require_ops_unlocked

router = APIRouter(prefix="/api/operations/sessions", tags=["operations"])


# ── code / answer normalization ──────────────────────────────────
# PDF 抽取到的给定代码常含中文全角标点 + 每行 11 空格的伪缩进，
# 直接喂给 kernel 会 IndentationError / SyntaxError；这里做兜底清洗。

_CH_PUNCT = {
    "\u201C": '"', "\u201D": '"',  # “ ”
    "\u2018": "'", "\u2019": "'",  # ‘ ’
    "\uFF1A": ":", "\uFF0C": ",",  # ： ，
    "\uFF08": "(", "\uFF09": ")",  # （ ）
    "\uFF1B": ";", "\uFF01": "!",  # ； ！
    "\uFF1F": "?",                 # ？
}
_CH_PUNCT_TABLE = str.maketrans(_CH_PUNCT)
_BLANK_MARK_RE = re.compile(r"_{5,}")


def _normalize_given_code(code: str) -> str:
    """清洗 given 代码：中文标点 → ASCII，并启发式去除 PDF 产物的伪缩进。

    若整段代码没有 `:` 结尾的行（没有 if/for/def 等块结构），则逐行左端 lstrip；
    否则退回 textwrap.dedent，保守处理。"""
    if not code:
        return code
    code = code.translate(_CH_PUNCT_TABLE)
    lines = code.split("\n")
    has_block = any(ln.rstrip().endswith(":") for ln in lines)
    if not has_block:
        lines = [ln.lstrip() for ln in lines]
        return "\n".join(lines)
    return textwrap.dedent(code)


def _normalize_answer_for_match(s: str) -> str:
    """把用户填空值 / 参考答案做宽松归一化：去全部空白、中文标点→ASCII、
    双引号统一为单引号。"""
    if s is None:
        return ""
    s = str(s).translate(_CH_PUNCT_TABLE)
    s = re.sub(r"\s+", "", s)
    s = s.replace('"', "'")
    return s


def _derive_template_inputs(template: str, assembled: str) -> list[str] | None:
    """Extract per-input answer fragments from an inline blank template.

    The frontend uses the same greedy rule to split saved drafts. Here we only
    need lengths, so hidden exam answers can still render useful blank sizes
    without exposing the answer text.
    """
    if not template:
        return None
    parts = _BLANK_MARK_RE.split(template)
    blank_count = len(parts) - 1
    if blank_count <= 0:
        return []
    assembled = assembled or ""
    out: list[str] = []
    cursor = 0
    if parts[0]:
        if not assembled.startswith(parts[0]):
            return None
        cursor = len(parts[0])
    for idx in range(blank_count):
        next_part = parts[idx + 1]
        if not next_part:
            out.append(assembled[cursor:])
            cursor = len(assembled)
            continue
        found = assembled.find(next_part, cursor)
        if found < 0:
            return None
        out.append(assembled[cursor:found])
        cursor = found + len(next_part)
    return out


def _blank_input_widths(template: str, answer: str) -> list[int]:
    """Return suggested character widths for each inline blank."""
    marker_widths = [len(m.group(0)) for m in _BLANK_MARK_RE.finditer(template or "")]
    answer_parts = _derive_template_inputs(template or "", answer or "") or []
    widths: list[int] = []
    for idx, marker_width in enumerate(marker_widths):
        answer_width = len(answer_parts[idx]) if idx < len(answer_parts) else 0
        widths.append(max(6, marker_width, answer_width))
    return widths


_AST_NAME_KEEP = {
    "pd", "pandas", "np", "numpy", "plt", "sns", "sklearn",
    "train_test_split", "StandardScaler", "MinMaxScaler", "LabelEncoder",
    "LogisticRegression", "RandomForestRegressor", "DecisionTreeRegressor",
    "LinearRegression", "Pipeline", "SMOTE", "XGBRegressor",
    "mean_squared_error", "mean_absolute_error", "r2_score", "accuracy_score",
    "classification_report", "confusion_matrix",
    "pickle", "joblib", "os", "cv2", "Image", "ort", "onnxruntime",
    "scipy", "xgb",
} | set(dir(builtins))


class _CanonicalNameAst(ast.NodeTransformer):
    """把本地变量名映射成稳定占位符；库名、函数名、属性名和字符串常量不改。"""

    def __init__(self, renamable_names: set[str]) -> None:
        self._renamable_names = renamable_names
        self._names: dict[str, str] = {}

    def visit_Name(self, node: ast.Name) -> ast.AST:
        if (
            node.id not in self._renamable_names
            or node.id in _AST_NAME_KEEP
            or keyword.iskeyword(node.id)
        ):
            return node
        if node.id not in self._names:
            self._names[node.id] = f"v{len(self._names) + 1}"
        return ast.copy_location(ast.Name(id=self._names[node.id], ctx=node.ctx), node)


def _collect_target_names(tree: ast.AST) -> set[str]:
    names: set[str] = set()

    def add_target(target: ast.AST) -> None:
        if isinstance(target, ast.Name):
            names.add(target.id)
        elif isinstance(target, (ast.Tuple, ast.List)):
            for elt in target.elts:
                add_target(elt)
        elif isinstance(target, (ast.Subscript, ast.Attribute)):
            base = target.value
            while isinstance(base, (ast.Subscript, ast.Attribute)):
                base = base.value
            if isinstance(base, ast.Name):
                names.add(base.id)

    for node in ast.walk(tree):
        if isinstance(node, (ast.Assign, ast.AnnAssign, ast.AugAssign)):
            targets = getattr(node, "targets", None) or [node.target]
            for target in targets:
                add_target(target)
        elif isinstance(node, (ast.For, ast.AsyncFor)):
            add_target(node.target)
        elif isinstance(node, ast.comprehension):
            add_target(node.target)
        elif isinstance(node, (ast.With, ast.AsyncWith)):
            for item in node.items:
                if item.optional_vars:
                    add_target(item.optional_vars)
        elif isinstance(node, ast.ExceptHandler) and node.name:
            names.add(node.name)
        elif isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef, ast.Lambda)):
            args = node.args
            for arg in [*args.posonlyargs, *args.args, *args.kwonlyargs]:
                names.add(arg.arg)
            if args.vararg:
                names.add(args.vararg.arg)
            if args.kwarg:
                names.add(args.kwarg.arg)

    return names


def _canonical_ast_dump(code: str) -> str | None:
    if code is None:
        return None
    cleaned = textwrap.dedent(str(code).translate(_CH_PUNCT_TABLE)).strip()
    if not cleaned:
        return None
    try:
        tree = ast.parse(cleaned)
    except SyntaxError:
        return None
    tree = _CanonicalNameAst(_collect_target_names(tree)).visit(tree)
    ast.fix_missing_locations(tree)
    return ast.dump(tree, include_attributes=False)


def _answers_equivalent(user_val: str, ref_val: str) -> bool:
    """代码填空等价判断：归一化精确匹配优先，完整 Python 片段再尝试 AST 等价。"""
    if not str(user_val or "").strip() or not str(ref_val or "").strip():
        return False
    if _normalize_answer_for_match(user_val) == _normalize_answer_for_match(ref_val):
        return True

    user_ast = _canonical_ast_dump(user_val)
    ref_ast = _canonical_ast_dump(ref_val)
    return bool(user_ast and ref_ast and user_ast == ref_ast)


def _sanitize_code_segments(segments: list) -> list:
    """返回清洗过的 code_segments 副本（给前端）。不改原数据。"""
    out = []
    for s in segments or []:
        s2 = dict(s)
        if s2.get("type") == "given":
            s2["code"] = _normalize_given_code(s2.get("code", ""))
        elif s2.get("type") == "blank" and "answer" in s2:
            # answer 也顺手清洗标点，方便前端"查看参考答案"显示
            s2["answer"] = (s2.get("answer") or "").translate(_CH_PUNCT_TABLE)
            s2["input_widths"] = _blank_input_widths(
                s2.get("template", ""),
                s2.get("answer", ""),
            )
        out.append(s2)
    return out


def _compute_blank_results(op: dict, blanks_draft: dict) -> dict:
    """比对用户填空 vs 参考答案，返回 {blank_index(str): bool}。
    归一化后字符串相等 → True。仅在会话已提交时使用。"""
    results: dict[str, bool] = {}
    if not op:
        return results
    segs = op.get("code_segments") or []
    idx = 0
    for s in segs:
        if s.get("type") != "blank":
            continue
        user_val = (blanks_draft or {}).get(str(idx), "")
        ref_val = s.get("answer", "")
        if ref_val:
            results[str(idx)] = _answers_equivalent(user_val, ref_val)
        idx += 1
    return results


def _auto_score_from_results(op: dict, results: dict) -> dict:
    """根据 blank_results + 每个 blank 的 points，计算自动小计。"""
    segs = (op or {}).get("code_segments") or []
    earned = 0.0
    total = 0.0
    idx = 0
    for s in segs:
        if s.get("type") != "blank":
            continue
        pts = float(s.get("points") or 0)
        total += pts
        if results.get(str(idx)):
            earned += pts
        idx += 1
    return {"earned": earned, "total": total}


def _normalize_doc_text(s: str) -> str:
    if s is None:
        return ""
    s = str(s).translate(_CH_PUNCT_TABLE).lower()
    return re.sub(r"[^\w\u4e00-\u9fff]+", "", s)


def _bigrams(s: str) -> set[str]:
    if len(s) < 2:
        return {s} if s else set()
    return {s[i:i + 2] for i in range(len(s) - 1)}


def _doc_answer_score_ratio(user_text: str, ref_text: str) -> float:
    """文档题考试自动评分启发式。

    自由文本没有可执行判题器时，用参考答案覆盖度 + 文本相似度给系统分；
    普通实训仍保留自评，这里只用于实操考试场景。
    """
    user = _normalize_doc_text(user_text)
    ref = _normalize_doc_text(ref_text)
    if not user or not ref or len(user) < 6:
        return 0.0
    if user in ref or ref in user:
        return 1.0

    user_grams = _bigrams(user)
    ref_grams = _bigrams(ref)
    if not user_grams or not ref_grams:
        return 0.0
    overlap = len(user_grams & ref_grams)
    precision = overlap / len(user_grams)
    recall = overlap / len(ref_grams)
    seq_ratio = SequenceMatcher(None, user, ref).ratio()
    ratio = max(seq_ratio, precision * 0.7 + recall * 0.3)
    return ratio if ratio >= 0.25 else 0.0


def _auto_score_doc_answers(op: dict, answers: dict) -> tuple[dict, dict]:
    rubric = (op or {}).get("rubric") or []
    refs = {
        str(s.get("id")): (s.get("text") or s.get("content") or "")
        for s in ((op or {}).get("answer_sections") or [])
        if s.get("id")
    }
    details: dict[str, dict] = {}
    earned = 0.0
    total = 0.0
    for item in rubric:
        rid = str(item.get("id") or "")
        points = float(item.get("points") or 0)
        total += points
        ratio = _doc_answer_score_ratio((answers or {}).get(rid, ""), refs.get(rid, ""))
        item_earned = round(points * ratio, 1)
        earned += item_earned
        details[rid] = {"earned": item_earned, "total": points, "ratio": round(ratio, 3)}
    return details, {"earned": round(earned, 1), "total": total}


def _score_operation_auto(op: dict, answers: dict) -> tuple[dict, dict]:
    """Return (per_item_results, auto_score) for code/doc operation answers."""
    if (op or {}).get("type") == "doc":
        return _auto_score_doc_answers(op, answers or {})
    results = _compute_blank_results(op, answers or {})
    return results, _auto_score_from_results(op, results)


class CreateReq(BaseModel):
    operation_id: int


class DraftReq(BaseModel):
    blanks_draft: Optional[dict] = None
    rubric_checks: Optional[dict] = None


class SubmitReq(BaseModel):
    # 代码题忽略；自动按 blank 对错算分。文档题可选；缺省时按 rubric_checks 命中分计。
    self_score: Optional[float] = Field(None, ge=0)
    rubric_checks: Optional[dict] = None
    blanks_draft: Optional[dict] = None


def _load_op(operation_id: int) -> Optional[dict]:
    """从 operations.json 里找一道题（沿用 server._load_operations 缓存）。"""
    from app.server import _load_operations
    for q in _load_operations():
        if q["id"] == operation_id:
            return q
    return None


def _user_in_active_exam_for(conn, user_id: int, op_id: int) -> bool:
    """该用户是否有进行中（未提交且未超时）的实操模拟考试，且 op_id 属于该考试抽到的 6 道题。
    用于 get_session 时决定是否屏蔽参考答案 —— 考中禁止偷看。"""
    row = conn.execute(
        """
        SELECT operation_ids FROM ops_exam_sessions
        WHERE user_id=? AND submitted_at IS NULL
          AND (end_time IS NULL OR end_time > datetime('now','localtime'))
        ORDER BY start_time DESC LIMIT 1
        """,
        (user_id,),
    ).fetchone()
    if not row:
        return False
    try:
        ids = json.loads(row["operation_ids"]) or []
    except Exception:
        return False
    return op_id in ids


def _op_meta(op: dict, hide_answers: bool = False) -> dict:
    """给前端的操作题头信息（剥掉 answer 等敏感字段，保留题面）。
    hide_answers=True 时进一步移除 blank.answer / answer_sections —— 实操模拟考试进行中。"""
    code_segments = _sanitize_code_segments(op.get("code_segments") or [])
    answer_sections = list(op.get("answer_sections") or [])
    if hide_answers:
        for s in code_segments:
            if s.get("type") == "blank" and "answer" in s:
                s["answer"] = ""
                s["input_widths"] = []
        answer_sections = []
        solution_guide = None
    else:
        solution_guide = op.get("solution_guide")
        try:
            sol_md = Path(__file__).parent.parent / "data" / "questions" / str(op["id"]) / "solution.md"
            if sol_md.is_file():
                solution_guide = sol_md.read_text(encoding="utf-8")
        except OSError:
            pass
    return {
        "id": op["id"],
        "title": op["title"],
        "category": op["category"],
        "type": op["type"],
        "time_limit": op.get("time_limit"),
        "total_score": op.get("total_score"),
        "scenario": op.get("scenario"),
        "tasks": op.get("tasks"),
        "rubric": op.get("rubric", []),
        "answer_sections": answer_sections,
        "code_segments": code_segments,
        "blank_count": op.get("blank_count", 0),
        "solution_guide": solution_guide,
    }


def _row_to_dict(row) -> dict:
    d = dict(row)
    d["blanks_draft"] = json.loads(d["blanks_draft"]) if d.get("blanks_draft") else {}
    d["rubric_checks"] = json.loads(d["rubric_checks"]) if d.get("rubric_checks") else {}
    d["submitted"] = d["submitted_at"] is not None
    return d


@router.post("")
def create_session(req: CreateReq, user=Depends(get_current_user)):
    require_ops_unlocked(user)
    op = _load_op(req.operation_id)
    if not op:
        raise HTTPException(404, "操作题不存在")

    with get_db() as conn:
        def _find_active():
            return conn.execute("""
                SELECT * FROM op_sessions
                WHERE user_id=? AND operation_id=? AND submitted_at IS NULL
                LIMIT 1
            """, (user["id"], req.operation_id)).fetchone()

        existing = _find_active()
        if existing:
            conn.execute("UPDATE op_sessions SET last_active_at=datetime('now','localtime') WHERE id=?",
                         (existing["id"],))
            row = existing
        else:
            try:
                cur = conn.execute("""
                    INSERT INTO op_sessions (user_id, operation_id, blanks_draft, rubric_checks)
                    VALUES (?, ?, '{}', '{}')
                """, (user["id"], req.operation_id))
                sid = cur.lastrowid
                row = conn.execute("SELECT * FROM op_sessions WHERE id=?", (sid,)).fetchone()
            except sqlite3.IntegrityError:
                row = _find_active()
                if not row:
                    raise HTTPException(500, "op_sessions 并发创建失败（UNIQUE 命中但回查为空）")

    d = _row_to_dict(row)
    return {
        "session_id": d["id"],
        "draft": d["blanks_draft"],
        "rubric_checks": d["rubric_checks"],
        "submitted": d["submitted"],
    }


@router.delete("/{session_id}")
def discard_session(session_id: int, user=Depends(get_current_user)):
    """放弃当前操作题作答 —— 直接删除 session 行（含草稿、kernel_id）。

    适用于「我不想做这道题了」的场景；submit 之后也允许删除（等同清空该题记录）。
    """
    require_ops_unlocked(user)
    with get_db() as conn:
        row = conn.execute(
            "SELECT user_id FROM op_sessions WHERE id=?", (session_id,)
        ).fetchone()
        if not row:
            raise HTTPException(404, "session 不存在")
        if row["user_id"] != user["id"]:
            raise HTTPException(403, "无权操作他人 session")
        conn.execute("DELETE FROM op_sessions WHERE id=?", (session_id,))
    return {"deleted": 1}


@router.post("/{session_id}/reset")
def reset_session(
    session_id: int,
    mode: str = Query("auto", regex="^(auto|keep|clear)$"),
    user=Depends(get_current_user),
):
    """重置当前题目作答状态。

    mode:
      - auto（默认 / 旧行为）：已提交→撤销提交保留作答；未提交→清空作答。
      - keep：仅清掉提交 + 判分状态，作答（blanks_draft / rubric_checks）保留。
      - clear：清空作答 + 提交 + 判分状态，回到全新作答状态。

    考试模式下不允许撤销已提交的作答（避免搅乱判分），其它情形均允许。
    若该 (user, op) 还残留其它未提交 session，先删除以避免命中 uq_op_sessions_active。
    """
    require_ops_unlocked(user)
    with get_db() as conn:
        row = conn.execute(
            "SELECT user_id, operation_id, submitted_at FROM op_sessions WHERE id=?",
            (session_id,),
        ).fetchone()
        if not row:
            raise HTTPException(404, "session 不存在")
        if row["user_id"] != user["id"]:
            raise HTTPException(403, "无权操作他人 session")
        in_exam = _user_in_active_exam_for(conn, user["id"], row["operation_id"])
        was_submitted = bool(row["submitted_at"])

        # mode=auto 按旧行为：已提交→keep，未提交→clear
        effective = mode
        if effective == "auto":
            effective = "keep" if was_submitted else "clear"

        if was_submitted and in_exam:
            # 考试模式下任何形式的"撤销提交"都不允许
            raise HTTPException(403, "考试模式不允许撤销已提交的作答")

        if was_submitted:
            # 撤销提交时可能有残留的未提交 sibling，先删除避免唯一索引冲突
            conn.execute(
                """DELETE FROM op_sessions
                   WHERE user_id=? AND operation_id=?
                     AND submitted_at IS NULL AND id<>?""",
                (user["id"], row["operation_id"], session_id),
            )

        if effective == "keep":
            conn.execute(
                """UPDATE op_sessions SET
                       submitted_at=NULL,
                       self_score=NULL,
                       ai_status=NULL,
                       ai_rubric_scores_json=NULL,
                       ai_feedback_json=NULL,
                       ai_raw_output=NULL,
                       ai_model=NULL,
                       ai_reasoning_effort=NULL,
                       ai_error=NULL,
                       ai_graded_at=NULL,
                       last_active_at=datetime('now','localtime')
                   WHERE id=?""",
                (session_id,),
            )
        else:  # effective == "clear"
            conn.execute(
                """UPDATE op_sessions SET
                       submitted_at=NULL,
                       self_score=NULL,
                       ai_status=NULL,
                       ai_rubric_scores_json=NULL,
                       ai_feedback_json=NULL,
                       ai_raw_output=NULL,
                       ai_model=NULL,
                       ai_reasoning_effort=NULL,
                       ai_error=NULL,
                       ai_graded_at=NULL,
                       blanks_draft='{}',
                       rubric_checks='{}',
                       last_active_at=datetime('now','localtime')
                   WHERE id=?""",
                (session_id,),
            )
    return {"ok": True, "mode": effective}


@router.get("/active")
def list_active_drafts(user=Depends(get_current_user)):
    """当前用户所有未提交的操作题草稿（用于在操作列表上标注「进行中」）。"""
    require_ops_unlocked(user)
    with get_db() as conn:
        rows = conn.execute("""
            SELECT id, operation_id, last_active_at
            FROM op_sessions
            WHERE user_id=? AND submitted_at IS NULL
            ORDER BY last_active_at DESC
        """, (user["id"],)).fetchall()
    return {"drafts": [dict(r) for r in rows]}


@router.get("/{session_id}")
def get_session(session_id: int, user=Depends(get_current_user)):
    require_ops_unlocked(user)
    with get_db() as conn:
        row = conn.execute("SELECT * FROM op_sessions WHERE id=?", (session_id,)).fetchone()
        if not row:
            raise HTTPException(404, "会话不存在")
        if row["user_id"] != user["id"]:
            raise HTTPException(403, "无权访问该会话")
        in_exam = _user_in_active_exam_for(conn, user["id"], row["operation_id"])

    op = _load_op(row["operation_id"])
    if not op:
        raise HTTPException(404, "关联操作题已失效")

    d = _row_to_dict(row)
    blank_results = (
        _compute_blank_results(op, d["blanks_draft"]) if d["submitted"] else {}
    )
    ai_grading = None
    if d.get("ai_status"):
        try:
            rubric_scores = json.loads(d.get("ai_rubric_scores_json") or "[]")
        except Exception:
            rubric_scores = []
        try:
            feedback = json.loads(d.get("ai_feedback_json") or "{}")
        except Exception:
            feedback = {}
        ai_grading = {
            "status": d["ai_status"],
            "score": d["self_score"],
            "rubric_scores": rubric_scores,
            "feedback": feedback,
            "model": d.get("ai_model"),
            "reasoning_effort": d.get("ai_reasoning_effort"),
            "graded_at": d.get("ai_graded_at"),
            "error": d.get("ai_error"),
        }
    return {
        "session_id": d["id"],
        "operation": _op_meta(op, hide_answers=in_exam),
        "in_exam": in_exam,
        "blanks_draft": d["blanks_draft"],
        "rubric_checks": d["rubric_checks"],
        "started_at": d["started_at"],
        "last_active_at": d["last_active_at"],
        "submitted_at": d["submitted_at"],
        "submitted": d["submitted"],
        "self_score": d["self_score"],
        "blank_results": blank_results,
        "auto_score": _auto_score_from_results(op, blank_results) if d["submitted"] else None,
        "ai_grading": ai_grading,
    }


@router.put("/{session_id}/draft")
def save_draft(session_id: int, req: DraftReq, user=Depends(get_current_user)):
    require_ops_unlocked(user)
    with get_db() as conn:
        row = conn.execute("SELECT user_id, submitted_at FROM op_sessions WHERE id=?",
                           (session_id,)).fetchone()
        if not row:
            raise HTTPException(404, "会话不存在")
        if row["user_id"] != user["id"]:
            raise HTTPException(403, "无权访问该会话")
        if row["submitted_at"]:
            raise HTTPException(400, "会话已提交，不能再改草稿")

        sets, vals = ["last_active_at=datetime('now','localtime')"], []
        if req.blanks_draft is not None:
            sets.append("blanks_draft=?")
            vals.append(json.dumps(req.blanks_draft, ensure_ascii=False))
        if req.rubric_checks is not None:
            sets.append("rubric_checks=?")
            vals.append(json.dumps(req.rubric_checks, ensure_ascii=False))
        vals.append(session_id)
        conn.execute(f"UPDATE op_sessions SET {', '.join(sets)} WHERE id=?", vals)

    return {"ok": True, "saved_at": datetime.now().isoformat()}


@router.post("/{session_id}/submit")
def submit_session(session_id: int, req: SubmitReq, user=Depends(get_current_user)):
    require_ops_unlocked(user)
    with get_db() as conn:
        row = conn.execute(
            "SELECT user_id, operation_id, submitted_at FROM op_sessions WHERE id=?",
            (session_id,)).fetchone()
        if not row:
            raise HTTPException(404, "会话不存在")
        if row["user_id"] != user["id"]:
            raise HTTPException(403, "无权访问该会话")
        if row["submitted_at"]:
            raise HTTPException(400, "会话已提交")
        in_ops_exam = _user_in_active_exam_for(conn, user["id"], row["operation_id"])

    op = _load_op(row["operation_id"])
    if not op:
        raise HTTPException(404, "关联操作题已失效")
    total_score = float(op.get("total_score", 10))

    # ── 单题提交自动判分：代码题即时评分；考试文档题交卷后由 AI 统一判卷。──
    final_blanks = req.blanks_draft
    if final_blanks is None:
        with get_db() as conn:
            raw = conn.execute(
                "SELECT blanks_draft FROM op_sessions WHERE id=?", (session_id,)
            ).fetchone()
        final_blanks = json.loads(raw["blanks_draft"]) if raw and raw["blanks_draft"] else {}
    item_results, auto_score = _score_operation_auto(op, final_blanks)

    op_type = op.get("type")
    ai_grading_payload: dict | None = None
    if op_type == "doc" and in_ops_exam:
        final_score = 0.0
        auto_score = {"earned": 0.0, "total": total_score, "pending_ai": True}
        item_results = {}
    elif op_type == "code":
        # 代码题：完全按 auto_score 落库，self_score 字段忽略客户端传值。
        final_score = float(auto_score["earned"]) if auto_score else 0.0
    else:
        # 文档题（实训模式）：copilot AI 同步判卷，不再要求自评分。
        try:
            result = grade_doc_answer_with_ai(
                exam_session_id=session_id,
                operation=op,
                answers=final_blanks or {},
            )
        except AIGradingDisabled:
            final_score = 0.0
            ai_grading_payload = {
                "status": "disabled",
                "score": 0.0,
                "max_score": total_score,
                "rubric_scores": [],
                "feedback": {
                    "summary": "本版本未启用 AI 自动判卷，请对照下方参考答案与评分细则自行核对得分。",
                    "confidence": "n/a",
                },
                "model": "disabled",
                "reasoning_effort": "none",
                "raw_output": "",
            }
            auto_score = {"earned": 0.0, "total": total_score, "ai_disabled": True}
        except Exception as exc:
            raise HTTPException(502, f"AI 判卷失败：{exc}")
        else:
            final_score = float(result.score)
            ai_grading_payload = {
                "status": "graded",
                "score": result.score,
                "max_score": result.max_score,
                "rubric_scores": result.rubric_scores,
                "feedback": result.feedback,
                "model": result.model,
                "reasoning_effort": result.reasoning_effort,
                "raw_output": result.raw_output,
            }
            auto_score = {"earned": result.score, "total": result.max_score, "ai_graded": True}

    sets: list[str] = [
        "submitted_at=datetime('now','localtime')",
        "last_active_at=datetime('now','localtime')",
        "self_score=?",
    ]
    vals: list = [final_score]
    if req.rubric_checks is not None:
        sets.append("rubric_checks=?")
        vals.append(json.dumps(req.rubric_checks, ensure_ascii=False))
    if req.blanks_draft is not None:
        sets.append("blanks_draft=?")
        vals.append(json.dumps(req.blanks_draft, ensure_ascii=False))
    if ai_grading_payload is not None:
        sets.extend([
            "ai_status=?",
            "ai_rubric_scores_json=?",
            "ai_feedback_json=?",
            "ai_raw_output=?",
            "ai_model=?",
            "ai_reasoning_effort=?",
            "ai_error=NULL",
            "ai_graded_at=datetime('now','localtime')",
        ])
        vals.extend([
            ai_grading_payload["status"],
            json.dumps(ai_grading_payload["rubric_scores"], ensure_ascii=False),
            json.dumps(ai_grading_payload["feedback"], ensure_ascii=False),
            ai_grading_payload["raw_output"],
            ai_grading_payload["model"],
            ai_grading_payload["reasoning_effort"],
        ])
    vals.append(session_id)
    with get_db() as conn:
        conn.execute(f"UPDATE op_sessions SET {', '.join(sets)} WHERE id=?", vals)

    return {
        "ok": True,
        "submitted_at": datetime.now().isoformat(),
        "self_score": final_score,
        "blank_results": item_results,
        "auto_score": auto_score,
        "ai_grading": (
            {k: v for k, v in ai_grading_payload.items() if k != "raw_output"}
            if ai_grading_payload else None
        ),
    }
