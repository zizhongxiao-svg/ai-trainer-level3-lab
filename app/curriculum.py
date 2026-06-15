from __future__ import annotations
"""Curriculum tree endpoints."""
import json
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query

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
    only: Optional[str] = Query(None, pattern="^(wrong|unanswered|corrected|flagged)$"),
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
    flagged_ids = {
        r["question_id"]
        for r in conn.execute(
            "SELECT question_id FROM user_question_flags WHERE user_id=?",
            (uid,),
        ).fetchall()
    }
    # 重置时存档的"已订正"题号；仅当题目无新答题历史时生效（反馈 #15）
    archived_corrected_ids = {
        r["question_id"]
        for r in conn.execute(
            "SELECT question_id FROM user_corrected_archive WHERE user_id=?",
            (uid,),
        ).fetchall()
    }
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
        q["flagged"] = q["id"] in flagged_ids

        if only == "wrong":
            if not q["user_last_answer"] or q["user_last_answer"]["is_correct"]:
                continue
        elif only == "unanswered":
            if q["attempts"] > 0:
                continue
        elif only == "corrected":
            # 已订正：历史上至少错过一次（attempts > correct_count），且最近一次答对；
            # 无答题历史的题以重置存档为准（保留订正状态的重置）
            if q["attempts"] == 0:
                if q["id"] not in archived_corrected_ids:
                    continue
            else:
                last = q["user_last_answer"]
                if not last or not last["is_correct"]:
                    continue
                if q["attempts"] <= q["correct_count"]:
                    continue
        elif only == "flagged":
            if not q["flagged"]:
                continue
        out.append(q)
    return out


@router.get("/kp/{kp_id}/questions")
def questions_by_kp(
    kp_id: int,
    q_type: Optional[str] = Query(None),
    only: Optional[str] = Query(None, pattern="^(wrong|unanswered|corrected|flagged)$"),
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


@router.post("/questions/{qid}/flag")
def flag_question(qid: int, user: dict = Depends(get_current_user)):
    uid = user["id"]
    with get_db() as conn:
        exists = conn.execute("SELECT 1 FROM questions WHERE id=?", (qid,)).fetchone()
        if not exists:
            raise HTTPException(status_code=404, detail="题目不存在")
        conn.execute(
            "INSERT OR IGNORE INTO user_question_flags (user_id, question_id) VALUES (?, ?)",
            (uid, qid),
        )
    return {"flagged": True}


@router.delete("/questions/{qid}/flag")
def unflag_question(qid: int, user: dict = Depends(get_current_user)):
    uid = user["id"]
    with get_db() as conn:
        conn.execute(
            "DELETE FROM user_question_flags WHERE user_id=? AND question_id=?",
            (uid, qid),
        )
    return {"flagged": False}
