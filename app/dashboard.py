from __future__ import annotations
"""Dashboard summary endpoint."""
import json
import os
import re
import datetime as _dt
from pathlib import Path

from fastapi import APIRouter, Depends

from app.auth import get_current_user
from app.db import get_db

router = APIRouter(prefix="/api/dashboard", tags=["dashboard"])


_BASE_DIR = Path(__file__).resolve().parent.parent
_CLASSES_PATH = Path(os.environ.get("TRAINER_CLASSES_PATH", str(_BASE_DIR / "data" / "classes.json")))


def _parse_session_dt(date_str: str, time_str: str, year: int) -> tuple[_dt.datetime, _dt.datetime] | None:
    """Parse '4月26日' + '9:00-12:00' into (start, end) datetime in given year. Returns None on failure."""
    md = re.match(r"\s*(\d+)\s*月\s*(\d+)\s*日", date_str or "")
    tm = re.match(r"\s*(\d+):(\d+)\s*-\s*(\d+):(\d+)", time_str or "")
    if not md or not tm:
        return None
    try:
        m, d = int(md.group(1)), int(md.group(2))
        sh, smin, eh, emin = (int(tm.group(i)) for i in (1, 2, 3, 4))
        start = _dt.datetime(year, m, d, sh, smin)
        end = _dt.datetime(year, m, d, eh, emin)
        return start, end
    except ValueError:
        return None


def _group_for_class(class_id: int) -> str | None:
    """Map class_id to schedule group key. Hard-coded per data/classes.json (1-4 / 5-8 / 9-11)."""
    if 1 <= class_id <= 4:
        return "1-4班"
    if 5 <= class_id <= 8:
        return "5-8班"
    if 9 <= class_id <= 11:
        return "9-11班"
    return None


def _next_session_for_class(class_id: int | None) -> dict | None:
    """Return the next (or currently-running) class session for the given user's class."""
    if not class_id or not _CLASSES_PATH.exists():
        return None
    group = _group_for_class(class_id)
    if not group:
        return None
    try:
        with open(_CLASSES_PATH, "r", encoding="utf-8") as f:
            data = json.load(f)
    except Exception:
        return None
    schedule = next((s for s in data.get("schedules", []) if s.get("group") == group), None)
    if not schedule:
        return None
    now = _dt.datetime.now()
    year = now.year
    upcoming = []
    for sess in schedule.get("sessions", []):
        parsed = _parse_session_dt(sess.get("date", ""), sess.get("time", ""), year)
        if not parsed:
            continue
        start, end = parsed
        # Roll into next year if month already past by >6 months (curriculum spans Apr-Jun, simple cutoff)
        if start.month < now.month - 6:
            start = start.replace(year=year + 1)
            end = end.replace(year=year + 1)
        upcoming.append((start, end, sess))
    upcoming.sort(key=lambda x: x[0])
    # Pick first session whose end is in the future (today's class still shows until end)
    for start, end, sess in upcoming:
        if end >= now:
            out = dict(sess)
            out["start_iso"] = start.isoformat(timespec="minutes")
            out["end_iso"] = end.isoformat(timespec="minutes")
            out["is_today"] = start.date() == now.date()
            out["is_ongoing"] = start <= now <= end
            out["group"] = group
            return out
    return None


@router.get("/summary")
def dashboard_summary(user: dict = Depends(get_current_user)):
    uid = user["id"]
    with get_db() as conn:
        weakest_sql = """
            SELECT cs.id, cs.title,
                   SUM((SELECT COUNT(*) FROM question_kp_map m WHERE m.kp_id=kp.id)) AS total,
                   SUM((SELECT COUNT(DISTINCT m.question_id)
                        FROM question_kp_map m
                        JOIN user_answers ua ON ua.question_id=m.question_id
                        WHERE m.kp_id=kp.id AND ua.user_id=?)) AS attempted,
                   SUM((SELECT COUNT(DISTINCT m.question_id)
                        FROM question_kp_map m
                        JOIN (
                          SELECT question_id, is_correct,
                            ROW_NUMBER() OVER (PARTITION BY question_id ORDER BY answered_at DESC, id DESC) rn
                          FROM user_answers WHERE user_id=?
                        ) ua ON ua.question_id=m.question_id AND ua.rn=1 AND ua.is_correct=1
                        WHERE m.kp_id=kp.id)) AS mastered
            FROM curriculum_sections cs
            LEFT JOIN knowledge_points kp ON kp.section_id = cs.id
            WHERE cs.parent_id IS NULL
            GROUP BY cs.id
            ORDER BY cs.ord
        """
        rows = conn.execute(weakest_sql, (uid, uid)).fetchall()
        weakest = []
        for r in rows:
            total = r["total"] or 0
            attempted = r["attempted"] or 0
            mastered = r["mastered"] or 0
            correct_rate = round(mastered / total * 100, 1) if total else 0.0
            weakest.append({
                "id": r["id"], "title": r["title"],
                "total": total, "attempted": attempted,
                "mastered": mastered, "correct_rate": correct_rate,
            })
        weakest_sorted = sorted(weakest, key=lambda w: (w["correct_rate"], -w["total"]))

        next_kp_rows = conn.execute("""
            SELECT kp.id, kp.title, cs.title AS section_title,
                   (SELECT COUNT(*) FROM question_kp_map m WHERE m.kp_id=kp.id) AS total,
                   (SELECT COUNT(DISTINCT m.question_id) FROM question_kp_map m
                    JOIN (
                      SELECT question_id, is_correct,
                        ROW_NUMBER() OVER (PARTITION BY question_id ORDER BY answered_at DESC, id DESC) rn
                      FROM user_answers WHERE user_id=?
                    ) ua ON ua.question_id=m.question_id AND ua.rn=1 AND ua.is_correct=1
                    WHERE m.kp_id=kp.id) AS mastered
            FROM knowledge_points kp
            JOIN curriculum_sections cs ON cs.id = kp.section_id
            WHERE (SELECT COUNT(*) FROM question_kp_map m WHERE m.kp_id=kp.id) > 0
            ORDER BY cs.ord, kp.ord, kp.id
        """, (uid,)).fetchall()
        next_kp = None
        for r in next_kp_rows:
            if (r["mastered"] or 0) < r["total"]:
                next_kp = {"id": r["id"], "title": r["title"],
                           "section_title": r["section_title"],
                           "total": r["total"], "mastered": r["mastered"] or 0}
                break

        wrong_count = conn.execute("""
            SELECT COUNT(DISTINCT question_id) FROM (
                SELECT question_id, is_correct,
                    ROW_NUMBER() OVER (PARTITION BY question_id ORDER BY answered_at DESC, id DESC) rn
                FROM user_answers WHERE user_id=?
            ) WHERE rn=1 AND is_correct=0
        """, (uid,)).fetchone()[0]

        exam_row = conn.execute("""
            SELECT id, score, start_time FROM exam_sessions
            WHERE user_id=? AND end_time IS NOT NULL
            ORDER BY start_time DESC LIMIT 1
        """, (uid,)).fetchone()
        recent_exam = dict(exam_row) if exam_row else None

        ops_exam_row = conn.execute("""
            SELECT id, earned_score, total_score, start_time, submitted_at
            FROM ops_exam_sessions
            WHERE user_id=? AND submitted_at IS NOT NULL
            ORDER BY submitted_at DESC LIMIT 1
        """, (uid,)).fetchone()
        recent_ops_exam = None
        if ops_exam_row:
            earned = ops_exam_row["earned_score"] or 0
            total = ops_exam_row["total_score"] or 0
            recent_ops_exam = {
                "id": ops_exam_row["id"],
                "earned_score": earned,
                "total_score": total,
                "score_pct": round(earned / total * 100, 1) if total else 0.0,
                "start_time": ops_exam_row["start_time"],
                "submitted_at": ops_exam_row["submitted_at"],
            }

        from app.server import _load_operations
        ops_all = _load_operations()
        ops_total = len(ops_all)
        submitted_ids = {
            r["operation_id"] for r in conn.execute("""
                SELECT DISTINCT operation_id FROM op_sessions
                WHERE user_id=? AND submitted_at IS NOT NULL
            """, (uid,)).fetchall()
        }
        draft_row = conn.execute("""
            SELECT operation_id, last_active_at FROM op_sessions
            WHERE user_id=? AND submitted_at IS NULL
            ORDER BY last_active_at DESC LIMIT 1
        """, (uid,)).fetchone()
        draft = None
        if draft_row:
            op = next((q for q in ops_all
                       if q["id"] == draft_row["operation_id"]), None)
            if op:
                draft = {
                    "operation_id": op["id"],
                    "title": op.get("title", ""),
                    "last_active_at": draft_row["last_active_at"],
                }
        ops_progress = {
            "total": ops_total,
            "submitted": len(submitted_ids),
            "draft": draft,
        }

        theory_total = conn.execute("SELECT COUNT(*) FROM questions").fetchone()[0]
        theory_attempted = conn.execute(
            "SELECT COUNT(DISTINCT question_id) FROM user_answers WHERE user_id=?",
            (uid,),
        ).fetchone()[0]
        theory_mastered = conn.execute(
            """
            SELECT COUNT(*) FROM (
                SELECT question_id, is_correct,
                  ROW_NUMBER() OVER (PARTITION BY question_id ORDER BY answered_at DESC, id DESC) rn
                FROM user_answers WHERE user_id=?
            ) WHERE rn=1 AND is_correct=1
            """,
            (uid,),
        ).fetchone()[0]
        theory_progress = {
            "total": theory_total,
            "attempted": theory_attempted or 0,
            "mastered": theory_mastered or 0,
        }

        return {
            "next_kp": next_kp,
            "weakest_sections": weakest_sorted[:3],
            "recent_wrong_count": wrong_count,
            "recent_exam": recent_exam,
            "recent_ops_exam": recent_ops_exam,
            "ops_progress": ops_progress,
            "theory_progress": theory_progress,
            "class_id": user.get("class_id"),
            "next_session": _next_session_for_class(user.get("class_id")),
        }
