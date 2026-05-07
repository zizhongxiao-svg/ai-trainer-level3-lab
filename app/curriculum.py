from __future__ import annotations
"""Curriculum tree endpoints."""
import json
from typing import Optional

from fastapi import APIRouter, Depends, Query

from app.auth import get_current_user
from app.db import get_db

router = APIRouter(prefix="/api/curriculum", tags=["curriculum"])


@router.get("")
def curriculum_tree(user: dict = Depends(get_current_user)):
    """Return sections → kps with per-user completion."""
    uid = user["id"]
    with get_db() as conn:
        sections = conn.execute("""
            SELECT id, title, ord, description
            FROM curriculum_sections
            WHERE parent_id IS NULL
            ORDER BY ord, id
        """).fetchall()

        result = []
        for s in sections:
            kps = conn.execute("""
                SELECT kp.id, kp.title, kp.ord,
                       (SELECT COUNT(*) FROM question_kp_map m
                        WHERE m.kp_id = kp.id) AS total,
                       (SELECT COUNT(DISTINCT m.question_id)
                        FROM question_kp_map m
                        JOIN user_answers ua ON ua.question_id = m.question_id
                        WHERE m.kp_id = kp.id AND ua.user_id = ?) AS attempted,
                       (SELECT COUNT(DISTINCT m.question_id)
                        FROM question_kp_map m
                        JOIN (
                          SELECT question_id, is_correct,
                            ROW_NUMBER() OVER (PARTITION BY question_id ORDER BY answered_at DESC, id DESC) rn
                          FROM user_answers WHERE user_id = ?
                        ) ua ON ua.question_id = m.question_id AND ua.rn = 1 AND ua.is_correct = 1
                        WHERE m.kp_id = kp.id) AS mastered
                FROM knowledge_points kp
                WHERE kp.section_id = ?
                ORDER BY kp.ord, kp.id
            """, (uid, uid, s["id"])).fetchall()

            result.append({
                "id": s["id"],
                "title": s["title"],
                "ord": s["ord"],
                "description": s["description"],
                "kps": [dict(k) for k in kps],
            })
        return result


@router.get("/questions")
def questions_all(
    q_type: Optional[str] = Query(None),
    only: Optional[str] = Query(None, pattern="^(wrong|unanswered|corrected)$"),
    user: dict = Depends(get_current_user),
):
    """List all questions across every module, with per-user answer state."""
    uid = user["id"]
    with get_db() as conn:
        base = "SELECT q.* FROM questions q WHERE 1=1"
        params: list = []
        if q_type:
            base += " AND q.type = ?"
            params.append(q_type)
        base += " ORDER BY q.id"
        rows = conn.execute(base, params).fetchall()
        out = _enrich_questions(conn, uid, rows, only)
        return {"questions": out, "total": len(out)}


def _enrich_questions(conn, uid: int, rows, only: Optional[str]):
    out = []
    for r in rows:
        q = dict(r)
        q["options"] = json.loads(q["options"])
        q["answer"] = json.loads(q["answer"])
        last = conn.execute("""
            SELECT selected, is_correct FROM user_answers
            WHERE user_id=? AND question_id=?
            ORDER BY answered_at DESC, id DESC LIMIT 1
        """, (uid, q["id"])).fetchone()
        q["user_last_answer"] = None
        if last:
            q["user_last_answer"] = {
                "selected": json.loads(last["selected"]),
                "is_correct": bool(last["is_correct"]),
            }
        stats = conn.execute("""
            SELECT COUNT(*) as attempts, COALESCE(SUM(is_correct), 0) as correct
            FROM user_answers WHERE user_id=? AND question_id=?
        """, (uid, q["id"])).fetchone()
        q["attempts"] = stats["attempts"]
        q["correct_count"] = stats["correct"]

        if only == "wrong":
            if not q["user_last_answer"] or q["user_last_answer"]["is_correct"]:
                continue
        elif only == "unanswered":
            if q["attempts"] > 0:
                continue
        elif only == "corrected":
            # 已订正：历史上至少错过一次（attempts > correct_count），且最近一次答对
            last = q["user_last_answer"]
            if not last or not last["is_correct"]:
                continue
            if q["attempts"] <= q["correct_count"]:
                continue
        out.append(q)
    return out


@router.get("/kp/{kp_id}/questions")
def questions_by_kp(
    kp_id: int,
    q_type: Optional[str] = Query(None),
    only: Optional[str] = Query(None, pattern="^(wrong|unanswered|corrected)$"),
    user: dict = Depends(get_current_user),
):
    """List questions mapped to kp_id, with per-user answer state."""
    uid = user["id"]
    with get_db() as conn:
        base = """
            SELECT q.* FROM questions q
            JOIN question_kp_map m ON m.question_id = q.id
            WHERE m.kp_id = ?
        """
        params: list = [kp_id]
        if q_type:
            base += " AND q.type = ?"
            params.append(q_type)
        base += " ORDER BY q.id"
        rows = conn.execute(base, params).fetchall()
        out = _enrich_questions(conn, uid, rows, only)
        return {"questions": out, "total": len(out)}
