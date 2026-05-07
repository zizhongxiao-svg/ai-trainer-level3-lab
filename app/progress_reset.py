from __future__ import annotations
"""学习进度重置接口 —— 用户级，按类别细粒度。

- 理论题：单 kp 或全部
- 操作题：单 op 或全部（拒绝有进行中草稿）
- 模拟考试：理论 / 实操历史（拒绝有进行中考试）
"""
from datetime import datetime, timedelta
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query

from app.auth import get_current_user
from app.db import get_db

router = APIRouter(prefix="/api/me/progress", tags=["progress-reset"])

THEORY_EXAM_DURATION_MINUTES = 90
THEORY_EXAM_SUBMIT_GRACE_SECONDS = 10


def _parse_sqlite_datetime(value: str | None) -> datetime | None:
    if not value:
        return None
    try:
        return datetime.strptime(value, "%Y-%m-%d %H:%M:%S")
    except (TypeError, ValueError):
        return None


def _local_utc_offset() -> timedelta:
    delta = datetime.now() - datetime.utcnow()
    minutes = round(delta.total_seconds() / 60)
    return timedelta(minutes=minutes)


def _effective_theory_session_start(row) -> datetime | None:
    started = _parse_sqlite_datetime(row["start_time"])
    if started is None:
        return None

    last_seen = None
    if "last_seen_at" in row.keys():
        last_seen = _parse_sqlite_datetime(row["last_seen_at"])
    if last_seen is not None:
        if abs((last_seen - started).total_seconds()) >= 6 * 3600:
            return started + _local_utc_offset()
        return started

    now_local = datetime.now()
    now_utc = datetime.utcnow()
    if abs((now_utc - started).total_seconds()) + 3600 < abs((now_local - started).total_seconds()):
        return started + _local_utc_offset()
    return started


def _has_active_theory_exam(conn, user_id: int) -> bool:
    cutoff = datetime.now() - timedelta(
        minutes=THEORY_EXAM_DURATION_MINUTES,
        seconds=THEORY_EXAM_SUBMIT_GRACE_SECONDS,
    )
    rows = conn.execute(
        """
        SELECT start_time, last_seen_at FROM exam_sessions
        WHERE user_id=? AND end_time IS NULL
        """,
        (user_id,),
    ).fetchall()
    for row in rows:
        started = _effective_theory_session_start(row)
        if started and started > cutoff:
            return True
    return False


def _has_active_ops_exam(conn, user_id: int) -> bool:
    now = datetime.now()
    rows = conn.execute(
        """
        SELECT end_time FROM ops_exam_sessions
        WHERE user_id=? AND submitted_at IS NULL
        """,
        (user_id,),
    ).fetchall()
    for row in rows:
        deadline = _parse_sqlite_datetime(row["end_time"])
        if deadline is None or deadline > now:
            return True
    return False


# ── 理论题 ─────────────────────────────────────────────────────────────────
@router.delete("/theory")
def reset_theory(
    kp_id: Optional[int] = Query(None, ge=1),
    section_id: Optional[int] = Query(None, ge=1),
    user: dict = Depends(get_current_user),
):
    if kp_id is not None and section_id is not None:
        raise HTTPException(422, "kp_id 与 section_id 不可同时指定")
    uid = user["id"]
    with get_db() as conn:
        if kp_id is not None:
            kp = conn.execute(
                "SELECT id FROM knowledge_points WHERE id=?", (kp_id,)
            ).fetchone()
            if not kp:
                raise HTTPException(404, "知识点不存在")
            cur = conn.execute(
                """
                DELETE FROM user_answers
                WHERE user_id=? AND question_id IN (
                    SELECT question_id FROM question_kp_map WHERE kp_id=?
                )
                """,
                (uid, kp_id),
            )
        elif section_id is not None:
            sec = conn.execute(
                "SELECT id FROM curriculum_sections WHERE id=?", (section_id,)
            ).fetchone()
            if not sec:
                raise HTTPException(404, "章节不存在")
            cur = conn.execute(
                """
                DELETE FROM user_answers
                WHERE user_id=? AND question_id IN (
                    SELECT m.question_id FROM question_kp_map m
                    JOIN knowledge_points kp ON kp.id = m.kp_id
                    WHERE kp.section_id=?
                )
                """,
                (uid, section_id),
            )
        else:
            cur = conn.execute(
                "DELETE FROM user_answers WHERE user_id=?", (uid,)
            )
        return {"deleted": cur.rowcount}


# ── 操作题 ─────────────────────────────────────────────────────────────────
@router.delete("/operations")
def reset_operations(
    op_id: Optional[int] = Query(None, ge=1),
    user: dict = Depends(get_current_user),
):
    """清空当前用户的操作题记录（含未提交草稿）。

    历史版本曾在有进行中 session 时返回 409，但实际上没有「放弃」入口，
    用户陷入死锁。此处直接删除，让重置等同「全部清空」。
    """
    uid = user["id"]
    with get_db() as conn:
        # ops_exam_grades.op_session_id 是不带 CASCADE 的外键，
        # 历史考试 grade 仍在引用 op_session 时直接 DELETE 会触发 IntegrityError。
        # 先把这些反向引用置空（exam grade 的分数与 rubric 数据保留）。
        if op_id is not None:
            conn.execute(
                """
                UPDATE ops_exam_grades SET op_session_id = NULL
                WHERE op_session_id IN (
                    SELECT id FROM op_sessions WHERE user_id=? AND operation_id=?
                )
                """,
                (uid, op_id),
            )
            cur = conn.execute(
                "DELETE FROM op_sessions WHERE user_id=? AND operation_id=?",
                (uid, op_id),
            )
        else:
            conn.execute(
                """
                UPDATE ops_exam_grades SET op_session_id = NULL
                WHERE op_session_id IN (SELECT id FROM op_sessions WHERE user_id=?)
                """,
                (uid,),
            )
            cur = conn.execute(
                "DELETE FROM op_sessions WHERE user_id=?", (uid,)
            )
        return {"deleted": cur.rowcount}


# ── 理论模拟考试历史 ───────────────────────────────────────────────────────
@router.delete("/exams/theory")
def reset_exams_theory(user: dict = Depends(get_current_user)):
    uid = user["id"]
    with get_db() as conn:
        if _has_active_theory_exam(conn, uid):
            raise HTTPException(409, "有进行中的理论考试，请先交卷后再重置")

        conn.execute(
            """
            DELETE FROM exam_answers
            WHERE session_id IN (SELECT id FROM exam_sessions WHERE user_id=?)
            """,
            (uid,),
        )
        cur = conn.execute("DELETE FROM exam_sessions WHERE user_id=?", (uid,))
        return {"deleted": cur.rowcount}


# ── 实操模拟考试历史 ───────────────────────────────────────────────────────
@router.delete("/exams/operations")
def reset_exams_operations(user: dict = Depends(get_current_user)):
    uid = user["id"]
    with get_db() as conn:
        if _has_active_ops_exam(conn, uid):
            raise HTTPException(409, "有进行中的实操考试，请先交卷后再重置")
        conn.execute(
            """
            DELETE FROM ops_exam_grades
            WHERE exam_session_id IN (SELECT id FROM ops_exam_sessions WHERE user_id=?)
            """,
            (uid,),
        )
        cur = conn.execute("DELETE FROM ops_exam_sessions WHERE user_id=?", (uid,))
        return {"deleted": cur.rowcount}
