from __future__ import annotations
"""REST /api/ops-exams —— 实操模拟考试（官方蓝本：6 题 / 120 分钟 / 100 分）。

蓝本（对应「操作技能考核方案」4-04-05-05 三级）：
  1. 业务分析      抽一：业务流程设计 ／ 业务模块效果优化 （30 分钟 · 25 分）
  2. 智能训练      必考：数据处理规范制定（15 分） + 算法测试（20 分）
  3. 智能系统设计  必考：智能系统监控和优化（15 分） + 人机交互流程设计（20 分）
  4. 培训与指导    抽一：培训 ／ 指导 （10 分钟 · 5 分）

对应 operations.json 的分类：
  业务分析     → 业务数据处理 / 模块效果优化
  智能训练     → 数据清洗标注 / 模型开发测试
  智能系统设计 → 数据分析优化 / 交互流程设计
  培训与指导   → 培训大纲编写 / 采集处理指导

复用 op_sessions 的作答流程：考试开始时按蓝本抽出 6 道题，用户在考试路由内
作答 + 提交；考试交卷时聚合这 6 道的系统自动分。
"""
import json
import os
import random
import sqlite3
import traceback
from datetime import datetime, timedelta
from pathlib import Path

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException
from pydantic import BaseModel

from app.ai_grading import grade_doc_answer_with_ai, grading_model, grading_reasoning_effort
from app.edition import AIGradingDisabled
from app.auth import get_current_user
from app.db import get_db
from app.ops_unlock import require_ops_unlocked
from app.op_sessions import (
    _load_op,
    _score_operation_auto,
)

router = APIRouter(prefix="/api/ops-exams", tags=["ops_exams"])

# ── Config ──────────────────────────────────────────────────────────
OPS_EXAM_DURATION_MINUTES = int(os.environ.get("TRAINER_OPS_EXAM_MINUTES", "120"))
OPS_EXAM_MAX_SCORE = 100

# 考核蓝本：每个 area 按 selection 规则从其 subunits 里抽题
#   pick_one: 从 subunits 里随机挑选一个，再从该 subunit 的题库里抽 1 道
#   required: subunits 全部抽题，每个抽 1 道
OPS_EXAM_BLUEPRINT = [
    {
        "area": "业务分析",
        "selection": "pick_one",
        "minutes": 30,
        "subunits": [
            {"name": "业务流程设计",     "category": "业务数据处理", "points": 25},
            {"name": "业务模块效果优化", "category": "模块效果优化", "points": 25},
        ],
    },
    {
        "area": "智能训练",
        "selection": "required",
        "minutes": 40,
        "subunits": [
            {"name": "数据处理规范制定", "category": "数据清洗标注", "points": 15},
            {"name": "算法测试",         "category": "模型开发测试", "points": 20},
        ],
    },
    {
        "area": "智能系统设计",
        "selection": "required",
        "minutes": 40,
        "subunits": [
            {"name": "智能系统监控和优化", "category": "数据分析优化", "points": 15},
            {"name": "人机交互流程设计",   "category": "交互流程设计", "points": 20},
        ],
    },
    {
        "area": "培训与指导",
        "selection": "pick_one",
        "minutes": 10,
        "subunits": [
            {"name": "培训", "category": "培训大纲编写", "points": 5},
            {"name": "指导", "category": "采集处理指导", "points": 5},
        ],
    },
]


BASE_DIR = Path(__file__).parent.parent
OPERATIONS_PATH = Path(
    os.environ.get("TRAINER_OPERATIONS_PATH", str(BASE_DIR / "data" / "operations.json"))
)


def _parse_sqlite_datetime(value: str | None) -> datetime | None:
    if not value:
        return None
    try:
        return datetime.strptime(value, "%Y-%m-%d %H:%M:%S")
    except (TypeError, ValueError):
        return None


def _delete_expired_unsubmitted_sessions(conn, user_id: int) -> None:
    """Clear timed-out drafts so they do not block the single-active-session index."""
    now = datetime.now()
    rows = conn.execute(
        """
        SELECT id, end_time FROM ops_exam_sessions
        WHERE user_id=? AND submitted_at IS NULL
        """,
        (user_id,),
    ).fetchall()
    expired_ids = []
    for row in rows:
        deadline = _parse_sqlite_datetime(row["end_time"])
        if deadline is not None and deadline <= now:
            expired_ids.append(row["id"])
    if expired_ids:
        placeholders = ",".join("?" for _ in expired_ids)
        conn.execute(
            f"DELETE FROM ops_exam_sessions WHERE id IN ({placeholders})",
            expired_ids,
        )


def _load_all_ops() -> list:
    with open(OPERATIONS_PATH, "r", encoding="utf-8") as f:
        return json.load(f)


def _pick_ops_by_blueprint() -> tuple[list[int], list[float]]:
    """按考核方案蓝本抽取 6 道题。

    - area.selection == 'pick_one'：随机选一个 subunit，从其 category 抽 1 道
    - area.selection == 'required'：每个 subunit 各抽 1 道
    - 同一 category 里优先抽 code 类型（可自动评分），不足时回退到全部

    返回 (op_ids, slot_points)：两者一一对应，slot_points 来自蓝本里 subunit.points，
    使整场考试满分恒为 OPS_EXAM_MAX_SCORE（100），不受具体题目自身 blank 加总影响。
    """
    ops = _load_all_ops()
    by_cat: dict[str, list] = {}
    for o in ops:
        by_cat.setdefault(o.get("category", ""), []).append(o)

    chosen: list[int] = []
    slot_points: list[float] = []
    for area in OPS_EXAM_BLUEPRINT:
        subunits = area["subunits"]
        if area["selection"] == "pick_one":
            picks = [random.choice(subunits)]
        else:
            picks = list(subunits)
        for sub in picks:
            pool = by_cat.get(sub["category"], [])
            if not pool:
                raise HTTPException(
                    500,
                    f"题库缺少分类『{sub['category']}』，无法按考核方案组卷",
                )
            code_pool = [o for o in pool if o.get("type") == "code"]
            use_pool = code_pool or pool
            chosen.append(random.choice(use_pool)["id"])
            slot_points.append(float(sub.get("points") or 0))
    return chosen, slot_points


def _slot_points_from_row(row) -> list[float] | None:
    if "slot_points_json" not in row.keys():
        return None
    raw = row["slot_points_json"]
    if not raw:
        return None
    try:
        data = json.loads(raw)
    except Exception:
        return None
    if not isinstance(data, list):
        return None
    return [float(x) for x in data]


def _session_row_to_payload(row, *, include_ops_meta: bool = True) -> dict:
    op_ids = json.loads(row["operation_ids"]) if row["operation_ids"] else []
    slot_points = _slot_points_from_row(row)
    payload = {
        "session_id": row["id"],
        "operation_ids": op_ids,
        "slot_points": slot_points,
        "start_time": row["start_time"],
        "end_time": row["end_time"],
        "submitted_at": row["submitted_at"],
        "earned_score": row["earned_score"],
        "total_score": row["total_score"],
        "grading_status": row["grading_status"] if "grading_status" in row.keys() else "none",
        "grading_started_at": row["grading_started_at"] if "grading_started_at" in row.keys() else None,
        "grading_completed_at": row["grading_completed_at"] if "grading_completed_at" in row.keys() else None,
        "grading_error": row["grading_error"] if "grading_error" in row.keys() else None,
    }
    if include_ops_meta:
        metas = []
        for idx, op_id in enumerate(op_ids):
            slot_pt = slot_points[idx] if slot_points and idx < len(slot_points) else None
            op = _load_op(op_id)
            if op is None:
                metas.append({"id": op_id, "title": f"#{op_id} (题目缺失)", "category": "", "total_score": slot_pt or 0, "slot_points": slot_pt})
                continue
            metas.append({
                "id": op_id,
                "title": op.get("title"),
                "category": op.get("category"),
                "total_score": slot_pt if slot_pt is not None else op.get("total_score"),
                "slot_points": slot_pt,
                "time_limit": op.get("time_limit"),
                "type": op.get("type"),
                "blank_count": op.get("blank_count", 0),
            })
        payload["operations"] = metas
    return payload


def _op_max_score(op: dict | None) -> float:
    if not op:
        return 0.0
    if op.get("type") == "doc":
        return sum(float(r.get("points") or 0) for r in op.get("rubric") or [])
    return sum(
        float(seg.get("points") or 0)
        for seg in op.get("code_segments") or []
        if seg.get("type") == "blank"
    )


def _latest_submitted_op_session(conn, user_id: int, op_id: int, exam_start: str):
    return conn.execute(
        """
        SELECT * FROM op_sessions
        WHERE user_id=? AND operation_id=?
          AND submitted_at IS NOT NULL
          AND started_at >= ?
        ORDER BY submitted_at DESC
        LIMIT 1
        """,
        (user_id, op_id, exam_start),
    ).fetchone()


def _scale_to_slot(earned: float, total: float, slot: float | None) -> tuple[float, float]:
    """把 (earned, total) 等比缩放到蓝本槽位分 slot；slot 为空时不缩放。"""
    if slot is None or slot <= 0:
        return earned, total
    if total <= 0:
        return 0.0, float(slot)
    ratio = earned / total
    return round(ratio * slot, 2), float(slot)


def _aggregate_scores(user_id: int, op_ids: list, exam_start: str,
                      exam_session_id: int | None = None,
                      slot_points: list | None = None) -> tuple[float, float, dict]:
    """Sum each op's auto_score from the most recent submitted op_session within exam window.

    slot_points: 与 op_ids 平行的蓝本槽位分（25/20/15/5 等）。提供时每题等比缩放到槽位分，
    使整卷满分恒为 100。未提供（旧 session）时维持历史行为，按题目自身 blank/rubric 求和。

    Returns (earned, total, per_op_detail).
    """
    earned_total = 0.0
    total_total = 0.0
    per_op = {}
    slots = list(slot_points) if slot_points else [None] * len(op_ids)
    if len(slots) < len(op_ids):
        slots += [None] * (len(op_ids) - len(slots))
    with get_db() as conn:
        for op_id, slot in zip(op_ids, slots):
            op = _load_op(op_id)
            max_score = _op_max_score(op)
            grade = None
            if exam_session_id is not None:
                grade = conn.execute(
                    """
                    SELECT * FROM ops_exam_grades
                    WHERE exam_session_id=? AND operation_id=?
                    """,
                    (exam_session_id, op_id),
                ).fetchone()
            if grade:
                raw_earned = float(grade["score"] or 0)
                raw_total = float(grade["max_score"] or max_score)
                earned, total = _scale_to_slot(raw_earned, raw_total, slot)
                per_op[str(op_id)] = {
                    "earned": earned,
                    "total": total,
                    "submitted": grade["op_session_id"] is not None,
                    "op_session_id": grade["op_session_id"],
                    "grade_status": grade["status"],
                    "ai_feedback": json.loads(grade["ai_feedback_json"]) if grade["ai_feedback_json"] else None,
                    "rubric_scores": json.loads(grade["rubric_scores_json"]) if grade["rubric_scores_json"] else None,
                    "error": grade["error"],
                }
                earned_total += earned
                total_total += total
                continue

            row = _latest_submitted_op_session(conn, user_id, op_id, exam_start)
            if not row or not op:
                slot_total = float(slot) if slot is not None else max_score
                per_op[str(op_id)] = {"earned": 0.0, "total": slot_total, "submitted": False}
                total_total += slot_total
                continue
            draft = json.loads(row["blanks_draft"]) if row["blanks_draft"] else {}
            _results, ascore = _score_operation_auto(op, draft)
            ascore = ascore or {"earned": 0, "total": 0}
            earned, total = _scale_to_slot(float(ascore["earned"]), float(ascore["total"]), slot)
            per_op[str(op_id)] = {
                "earned": earned,
                "total": total,
                "submitted": True,
                "op_session_id": row["id"],
                "self_score": row["self_score"],
            }
            earned_total += earned
            total_total += total
    return earned_total, total_total, per_op


def _upsert_grade(conn, *, exam_session_id: int, operation_id: int, op_session_id,
                  status: str, score: float, max_score: float,
                  rubric_scores=None, feedback=None, raw_output: str = "",
                  model: str = "", reasoning_effort: str = "", error: str = "") -> None:
    conn.execute(
        """
        INSERT INTO ops_exam_grades (
            exam_session_id, operation_id, op_session_id, status, score, max_score,
            rubric_scores_json, ai_feedback_json, raw_output, model, reasoning_effort,
            error, updated_at
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now','localtime'))
        ON CONFLICT(exam_session_id, operation_id) DO UPDATE SET
            op_session_id=excluded.op_session_id,
            status=excluded.status,
            score=excluded.score,
            max_score=excluded.max_score,
            rubric_scores_json=excluded.rubric_scores_json,
            ai_feedback_json=excluded.ai_feedback_json,
            raw_output=excluded.raw_output,
            model=excluded.model,
            reasoning_effort=excluded.reasoning_effort,
            error=excluded.error,
            updated_at=datetime('now','localtime')
        """,
        (
            exam_session_id,
            operation_id,
            op_session_id,
            status,
            score,
            max_score,
            json.dumps(rubric_scores, ensure_ascii=False) if rubric_scores is not None else None,
            json.dumps(feedback, ensure_ascii=False) if feedback is not None else None,
            raw_output[-20000:] if raw_output else "",
            model,
            reasoning_effort,
            error[-2000:] if error else "",
        ),
    )


def grade_exam_background(session_id: int) -> None:
    with get_db() as conn:
        row = conn.execute(
            "SELECT * FROM ops_exam_sessions WHERE id=?", (session_id,)
        ).fetchone()
        if not row:
            return
        user_id = row["user_id"]
        op_ids = json.loads(row["operation_ids"]) if row["operation_ids"] else []
        exam_start = row["start_time"]

    has_error = False
    for op_id in op_ids:
        op = _load_op(op_id)
        max_score = _op_max_score(op)
        try:
            with get_db() as conn:
                op_row = _latest_submitted_op_session(conn, user_id, op_id, exam_start)
            if not op or not op_row:
                with get_db() as conn:
                    _upsert_grade(
                        conn,
                        exam_session_id=session_id,
                        operation_id=op_id,
                        op_session_id=None,
                        status="missing",
                        score=0.0,
                        max_score=max_score,
                        error="未提交本题",
                    )
                continue

            answers = json.loads(op_row["blanks_draft"]) if op_row["blanks_draft"] else {}
            if op.get("type") == "doc":
                try:
                    result = grade_doc_answer_with_ai(
                        exam_session_id=session_id,
                        operation=op,
                        answers=answers,
                    )
                except AIGradingDisabled:
                    with get_db() as conn:
                        _upsert_grade(
                            conn,
                            exam_session_id=session_id,
                            operation_id=op_id,
                            op_session_id=op_row["id"],
                            status="manual",
                            score=0.0,
                            max_score=max_score,
                            rubric_scores=[],
                            feedback={
                                "summary": "本版本未启用 AI 自动判卷，请对照参考答案自行核对。",
                                "confidence": "n/a",
                            },
                            model="disabled",
                            reasoning_effort="none",
                        )
                    continue
                with get_db() as conn:
                    _upsert_grade(
                        conn,
                        exam_session_id=session_id,
                        operation_id=op_id,
                        op_session_id=op_row["id"],
                        status="graded",
                        score=result.score,
                        max_score=result.max_score,
                        rubric_scores=result.rubric_scores,
                        feedback=result.feedback,
                        raw_output=result.raw_output,
                        model=result.model,
                        reasoning_effort=result.reasoning_effort,
                    )
            else:
                _results, ascore = _score_operation_auto(op, answers)
                with get_db() as conn:
                    _upsert_grade(
                        conn,
                        exam_session_id=session_id,
                        operation_id=op_id,
                        op_session_id=op_row["id"],
                        status="graded",
                        score=float(ascore["earned"]) if ascore else 0.0,
                        max_score=float(ascore["total"]) if ascore else max_score,
                        rubric_scores=_results,
                        feedback={"summary": "代码题按填空参考答案自动评分。"},
                        model="local-auto",
                        reasoning_effort="none",
                    )
        except Exception as exc:
            has_error = True
            with get_db() as conn:
                _upsert_grade(
                    conn,
                    exam_session_id=session_id,
                    operation_id=op_id,
                    op_session_id=None,
                    status="failed",
                    score=0.0,
                    max_score=max_score,
                    model=grading_model(),
                    reasoning_effort=grading_reasoning_effort(),
                    error=f"{exc}\n{traceback.format_exc()[-1500:]}",
                )

    with get_db() as conn:
        final = conn.execute(
            "SELECT * FROM ops_exam_sessions WHERE id=?", (session_id,)
        ).fetchone()
        if not final:
            return
        op_ids = json.loads(final["operation_ids"]) if final["operation_ids"] else []
        earned, total, _per_op = _aggregate_scores(
            user_id, op_ids, final["start_time"], session_id,
            slot_points=_slot_points_from_row(final),
        )
        conn.execute(
            """
            UPDATE ops_exam_sessions
            SET grading_status=?,
                grading_completed_at=datetime('now','localtime'),
                grading_error=?,
                earned_score=?,
                total_score=?
            WHERE id=?
            """,
            (
                "failed" if has_error else "graded",
                "部分题目 AI 判卷失败，请稍后重试或联系管理员" if has_error else None,
                earned,
                total,
                session_id,
            ),
        )


# ── API ─────────────────────────────────────────────────────────────

@router.get("/blueprint")
def get_blueprint():
    """返回官方考核方案（供前端渲染结构表）。"""
    total_points = sum(
        max(s["points"] for s in a["subunits"]) if a["selection"] == "pick_one"
        else sum(s["points"] for s in a["subunits"])
        for a in OPS_EXAM_BLUEPRINT
    )
    total_questions = sum(
        1 if a["selection"] == "pick_one" else len(a["subunits"])
        for a in OPS_EXAM_BLUEPRINT
    )
    return {
        "areas": OPS_EXAM_BLUEPRINT,
        "duration_minutes": OPS_EXAM_DURATION_MINUTES,
        "max_score": OPS_EXAM_MAX_SCORE,
        "total_questions": total_questions,
        "total_points": total_points,
    }


class StartReq(BaseModel):
    pass  # no body; config-driven


@router.post("/start")
def start_exam(_: StartReq = StartReq(), user=Depends(get_current_user)):
    """Create a new ops exam session (or return existing active one with 409)."""
    require_ops_unlocked(user)
    with get_db() as conn:
        _delete_expired_unsubmitted_sessions(conn, user["id"])
        active = conn.execute(
            """
            SELECT * FROM ops_exam_sessions
            WHERE user_id=? AND submitted_at IS NULL
              AND (end_time IS NULL OR end_time > datetime('now','localtime'))
            ORDER BY start_time DESC LIMIT 1
            """,
            (user["id"],),
        ).fetchone()
        if active:
            raise HTTPException(
                409,
                detail={
                    "message": "已有进行中的实操模拟",
                    "session_id": active["id"],
                },
            )

        op_ids, slot_points = _pick_ops_by_blueprint()
        end_dt = datetime.now() + timedelta(minutes=OPS_EXAM_DURATION_MINUTES)
        end_str = end_dt.strftime("%Y-%m-%d %H:%M:%S")
        try:
            cur = conn.execute(
                """
                INSERT INTO ops_exam_sessions (user_id, operation_ids, slot_points_json, end_time)
                VALUES (?, ?, ?, ?)
                """,
                (user["id"], json.dumps(op_ids), json.dumps(slot_points), end_str),
            )
            sid = cur.lastrowid
        except sqlite3.IntegrityError:
            # Race: another request already created one
            _delete_expired_unsubmitted_sessions(conn, user["id"])
            retry = conn.execute(
                """
                SELECT id FROM ops_exam_sessions
                WHERE user_id=? AND submitted_at IS NULL
                  AND (end_time IS NULL OR end_time > datetime('now','localtime'))
                """,
                (user["id"],),
            ).fetchone()
            if retry:
                raise HTTPException(
                    409,
                    detail={"message": "已有进行中的实操模拟", "session_id": retry["id"]},
                )
            raise HTTPException(500, "ops_exam 创建失败")
        row = conn.execute(
            "SELECT * FROM ops_exam_sessions WHERE id=?", (sid,)
        ).fetchone()

    return _session_row_to_payload(row)


@router.get("/active")
def get_active(user=Depends(get_current_user)):
    """Return active ops exam session or {} if none."""
    require_ops_unlocked(user)
    with get_db() as conn:
        _delete_expired_unsubmitted_sessions(conn, user["id"])
        row = conn.execute(
            """
            SELECT * FROM ops_exam_sessions
            WHERE user_id=? AND submitted_at IS NULL
              AND (end_time IS NULL OR end_time > datetime('now','localtime'))
            ORDER BY start_time DESC LIMIT 1
            """,
            (user["id"],),
        ).fetchone()
    if not row:
        return {}
    payload = _session_row_to_payload(row)
    op_ids = payload.get("operation_ids") or []
    if op_ids:
        _earned, _total, per_op = _aggregate_scores(
            user["id"], op_ids, row["start_time"], row["id"],
            slot_points=_slot_points_from_row(row),
        )
        payload["per_op"] = per_op
    return payload


@router.get("/{session_id}")
def get_session(session_id: int, user=Depends(get_current_user)):
    require_ops_unlocked(user)
    with get_db() as conn:
        row = conn.execute(
            "SELECT * FROM ops_exam_sessions WHERE id=?", (session_id,)
        ).fetchone()
    if not row:
        raise HTTPException(404, "实操考试会话不存在")
    if row["user_id"] != user["id"]:
        raise HTTPException(403, "无权访问该会话")
    payload = _session_row_to_payload(row)
    op_ids = payload["operation_ids"]
    earned, total, per_op = _aggregate_scores(
        user["id"], op_ids, row["start_time"], session_id,
        slot_points=_slot_points_from_row(row),
    )
    payload["earned_score_live"] = earned
    payload["total_score_live"] = total
    payload["per_op"] = per_op
    return payload


@router.post("/{session_id}/submit")
def submit_exam(session_id: int, background_tasks: BackgroundTasks,
                user=Depends(get_current_user)):
    """Lock the exam and start background grading."""
    require_ops_unlocked(user)
    with get_db() as conn:
        row = conn.execute(
            "SELECT * FROM ops_exam_sessions WHERE id=?", (session_id,)
        ).fetchone()
        if not row:
            raise HTTPException(404, "实操考试会话不存在")
        if row["user_id"] != user["id"]:
            raise HTTPException(403, "无权访问该会话")
        if row["submitted_at"]:
            raise HTTPException(400, "已经交卷")

        op_ids = json.loads(row["operation_ids"]) if row["operation_ids"] else []
        slot_points = _slot_points_from_row(row)
        # Provide immediate full-score denominator while AI grading runs.
        if slot_points and len(slot_points) == len(op_ids):
            total = float(sum(slot_points))
        else:
            total = sum(_op_max_score(_load_op(op_id)) for op_id in op_ids)
        conn.execute(
            """
            UPDATE ops_exam_sessions
            SET submitted_at=datetime('now','localtime'),
                grading_status='running',
                grading_started_at=datetime('now','localtime'),
                grading_completed_at=NULL,
                grading_error=NULL,
                earned_score=0,
                total_score=?
            WHERE id=?
            """,
            (total, session_id),
        )
        row2 = conn.execute(
            "SELECT * FROM ops_exam_sessions WHERE id=?", (session_id,)
        ).fetchone()

    background_tasks.add_task(grade_exam_background, session_id)
    payload = _session_row_to_payload(row2)
    payload["per_op"] = {}
    payload["earned_score_live"] = 0
    payload["total_score_live"] = total
    return payload


@router.get("")
def list_exams(user=Depends(get_current_user)):
    """Return history of user's ops exams (newest first)."""
    require_ops_unlocked(user)
    with get_db() as conn:
        rows = conn.execute(
            """
            SELECT * FROM ops_exam_sessions
            WHERE user_id=?
            ORDER BY start_time DESC
            LIMIT 50
            """,
            (user["id"],),
        ).fetchall()
    return [_session_row_to_payload(r, include_ops_meta=False) for r in rows]
