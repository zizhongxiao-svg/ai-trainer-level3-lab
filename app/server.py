#!/usr/bin/env python3
"""AI训练师三级考试备考系统 - FastAPI Backend"""

import json
import mimetypes
import os
import re
import sqlite3
import time
import random
import hashlib
import secrets
import zipfile
from datetime import datetime, timedelta
from pathlib import Path
from typing import Optional
from xml.etree import ElementTree as ET

from app.db import get_db, run_migrations
from app.auth import create_token, get_current_user, security
from app import edition

from fastapi import FastAPI, HTTPException, Depends, Query
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse, JSONResponse
from passlib.context import CryptContext
from pydantic import BaseModel

# ── Config ──────────────────────────────────────────────────────────────────
BASE_DIR = Path(__file__).parent.parent  # project root
DB_PATH = Path(os.environ.get("TRAINER_DB_PATH", str(BASE_DIR / "trainer.db")))
QUESTIONS_PATH = Path(os.environ.get("TRAINER_QUESTIONS_PATH", str(BASE_DIR / "data" / "questions.json")))
OPERATIONS_PATH = Path(os.environ.get("TRAINER_OPERATIONS_PATH", str(BASE_DIR / "data" / "operations.json")))
OFFICIAL_EXAM_BLUEPRINT = {
    "judge": 40,
    "single": 140,
    "multi": 10,
}
QUESTION_TYPE_POINTS = {
    "judge": 0.5,
    "single": 0.5,
    "multi": 1.0,
}
QUESTION_TYPE_LABELS = {
    "judge": "判断题",
    "single": "单选题",
    "multi": "多选题",
}
EXAM_DURATION_MINUTES = 90
EXAM_PASS_SCORE = 60
EXAM_SUBMIT_GRACE_SECONDS = 10

# ── App ─────────────────────────────────────────────────────────────────────
app = FastAPI(title="AI训练师备考系统", version="1.0.0")
app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_credentials=True,
                   allow_methods=["*"], allow_headers=["*"])

pwd_context = CryptContext(schemes=["bcrypt"], deprecated="auto")


def _require_feature(name: str) -> None:
    if not edition.is_feature_enabled(name):
        raise HTTPException(404, "该功能已在当前版本中关闭")


@app.get("/api/edition")
def get_edition():
    return edition.edition_payload()

# ── Database ────────────────────────────────────────────────────────────────
def load_questions_to_db():
    """Load questions from JSON into SQLite, upserting to preserve user answers."""
    with open(QUESTIONS_PATH, "r", encoding="utf-8") as f:
        questions = json.load(f)

    with get_db() as db:
        json_ids = {q["id"] for q in questions}
        for q in questions:
            db.execute(
                "INSERT OR REPLACE INTO questions (id, type, category, text, options, answer) VALUES (?,?,?,?,?,?)",
                (q["id"], q["type"], q["category"], q["text"],
                 json.dumps(q["options"], ensure_ascii=False),
                 json.dumps(q["answer"], ensure_ascii=False))
            )
        # Remove questions no longer in JSON (but keep if they have user answers)
        db_ids = {r[0] for r in db.execute("SELECT id FROM questions").fetchall()}
        stale = db_ids - json_ids
        if stale:
            for sid in stale:
                has_answers = db.execute(
                    "SELECT 1 FROM user_answers WHERE question_id=? LIMIT 1", (sid,)
                ).fetchone()
                if not has_answers:
                    db.execute("DELETE FROM questions WHERE id=?", (sid,))

    return len(questions)


# ── Pydantic models ────────────────────────────────────────────────────────
class RegisterReq(BaseModel):
    username: str
    display_name: str
    password: str

class LoginReq(BaseModel):
    username: str
    password: str

class AnswerReq(BaseModel):
    question_id: int
    selected: list[str]

class ExamSubmitReq(BaseModel):
    session_id: int
    answers: list[AnswerReq]


def normalize_selected_options(question_row: sqlite3.Row, selected: list[str]) -> list[str]:
    """Validate and normalize selected option labels against the question."""
    valid_labels = {
        str(option["label"]).strip()
        for option in json.loads(question_row["options"])
    }
    # Also keep uppercased set for A-E style labels
    valid_upper = {l.upper() for l in valid_labels}
    normalized: list[str] = []
    for raw_label in selected:
        label = str(raw_label).strip()
        # Try exact match first (for √/×), then uppercased (for A/B/C/D)
        if label in valid_labels:
            pass
        elif label.upper() in valid_upper:
            label = label.upper()
        else:
            raise HTTPException(400, f"答案选项无效: {raw_label}")
        if label not in normalized:
            normalized.append(label)

    # Enforce single selection for judge/single types
    q_type = question_row["type"]
    if q_type in ("judge", "single") and len(normalized) > 1:
        raise HTTPException(400, "判断题和单选题只能选择一个答案")

    return sorted(normalized)


def _parse_sqlite_datetime(value: Optional[str]) -> Optional[datetime]:
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


def _effective_theory_session_start(session_row) -> Optional[datetime]:
    """Interpret mixed UTC/local theory exam timestamps without rewriting rows."""
    started = _parse_sqlite_datetime(session_row["start_time"])
    if started is None:
        return None

    last_seen = None
    if "last_seen_at" in session_row.keys():
        last_seen = _parse_sqlite_datetime(session_row["last_seen_at"])
    if last_seen is not None:
        if abs((last_seen - started).total_seconds()) >= 6 * 3600:
            return started + _local_utc_offset()
        return started

    now_local = datetime.now()
    now_utc = datetime.utcnow()
    if abs((now_utc - started).total_seconds()) + 3600 < abs((now_local - started).total_seconds()):
        return started + _local_utc_offset()
    return started


# ── Auth endpoints ──────────────────────────────────────────────────────────
@app.post("/api/auth/register")
def register(req: RegisterReq):
    if len(req.username) < 2 or len(req.password) < 3:
        raise HTTPException(400, "用户名至少2位，密码至少3位")
    with get_db() as db:
        exists = db.execute("SELECT id FROM users WHERE username=?", (req.username,)).fetchone()
        if exists:
            raise HTTPException(400, "用户名已存在")
        hashed = pwd_context.hash(req.password)
        gate_required = 1 if wechat_gate.is_enabled() else 0
        cursor = db.execute(
            """
            INSERT INTO users
                (username, display_name, password_hash, wechat_gate_required, ops_unlock_required, created_at)
            VALUES (?,?,?,?,?,datetime('now','localtime'))
            """,
            (req.username, req.display_name, hashed, gate_required, 1)
        )
        user_id = cursor.lastrowid
    if gate_required:
        try:
            return wechat_gate.build_gate_response(user_id)
        except Exception:
            with get_db() as db:
                db.execute("DELETE FROM users WHERE id=?", (user_id,))
            raise
    return {"token": create_token(user_id, req.username), "user": {"id": user_id, "username": req.username, "display_name": req.display_name, "is_admin": False, "class_id": None}}

@app.post("/api/auth/login")
def login(req: LoginReq):
    with get_db() as db:
        user = db.execute("SELECT * FROM users WHERE username=?", (req.username,)).fetchone()
    if not user or not pwd_context.verify(req.password, user["password_hash"]):
        raise HTTPException(401, "用户名或密码错误")
    if wechat_gate.user_requires_wechat_gate(user) and not wechat_gate.user_has_subscribed_link(user["id"]):
        return wechat_gate.build_gate_response(user["id"])
    return {"token": create_token(user["id"], user["username"]),
            "user": {"id": user["id"], "username": user["username"], "display_name": user["display_name"],
                     "is_admin": bool(user["is_admin"]),
                     "class_id": _row_get(user, "class_id")}}


@app.get("/api/auth/me")
def me(user=Depends(get_current_user)):
    """Return current user profile; used by frontend to refresh is_admin without re-login."""
    return {"id": user["id"], "username": user["username"],
            "display_name": user["display_name"], "is_admin": bool(user.get("is_admin")),
            "class_id": user.get("class_id")}


def _row_get(row, key, default=None):
    """Safely fetch a column from sqlite3.Row that may not exist on legacy rows."""
    try:
        return row[key]
    except (IndexError, KeyError):
        return default


class ClassUpdateReq(BaseModel):
    class_id: Optional[int] = None


@app.put("/api/me/class")
def update_my_class(req: ClassUpdateReq, user=Depends(get_current_user)):
    """Set or clear the current user's class assignment (1..N from classes.json)."""
    _require_feature("classes")
    cid = req.class_id
    if cid is not None:
        # Validate against classes.json
        valid_ids = set()
        if CLASSES_PATH.exists():
            try:
                with open(CLASSES_PATH, "r", encoding="utf-8") as f:
                    data = json.load(f)
                valid_ids = {int(c.get("id")) for c in data.get("classes", []) if c.get("id") is not None}
            except Exception:
                valid_ids = set()
        if valid_ids and cid not in valid_ids:
            raise HTTPException(400, f"无效的班级编号：{cid}")
    with get_db() as db:
        db.execute("UPDATE users SET class_id=? WHERE id=?", (cid, user["id"]))
    return {"ok": True, "class_id": cid}


# ── Question endpoints ──────────────────────────────────────────────────────
@app.get("/api/questions/categories")
def get_categories(
    q_type: Optional[str] = Query(None, alias="type"),
    user=Depends(get_current_user)
):
    with get_db() as db:
        sql = "SELECT category, COUNT(*) as count FROM questions"
        params = []
        if q_type:
            sql += " WHERE type=?"
            params.append(q_type)
        sql += " GROUP BY category ORDER BY MIN(id)"
        rows = db.execute(sql, params).fetchall()
    return [{"name": r["category"], "count": r["count"]} for r in rows]

@app.get("/api/questions")
def get_questions(
    category: Optional[str] = None,
    q_type: Optional[str] = Query(None, alias="type"),
    mode: str = Query("practice", regex="^(practice|wrong|random|all)$"),
    page: int = 1,
    page_size: int = 50,
    user=Depends(get_current_user)
):
    """Get questions for practice.
    Modes:
      - practice: all questions (optionally filtered by category and type)
      - wrong: only questions user has gotten wrong (and not yet answered correctly since)
      - random: random N questions
      - all: all questions with user answer status
    """
    with get_db() as db:
        if mode == "wrong":
            sql = """
                SELECT q.* FROM questions q
                INNER JOIN (
                    SELECT question_id, is_correct,
                        ROW_NUMBER() OVER (PARTITION BY question_id ORDER BY answered_at DESC, id DESC) as rn
                    FROM user_answers WHERE user_id=?
                ) ua ON q.id = ua.question_id AND ua.rn = 1 AND ua.is_correct = 0
            """
            params = [user["id"]]
            wheres = []
            if category:
                wheres.append("q.category=?")
                params.append(category)
            if q_type:
                wheres.append("q.type=?")
                params.append(q_type)
            if wheres:
                sql += " WHERE " + " AND ".join(wheres)
            sql += " ORDER BY q.id"
            rows = db.execute(sql, params).fetchall()
        elif mode == "random":
            sql = "SELECT * FROM questions"
            params = []
            wheres = []
            if category:
                wheres.append("category=?")
                params.append(category)
            if q_type:
                wheres.append("type=?")
                params.append(q_type)
            if wheres:
                sql += " WHERE " + " AND ".join(wheres)
            sql += " ORDER BY RANDOM() LIMIT ?"
            params.append(page_size)
            rows = db.execute(sql, params).fetchall()
        else:
            sql = "SELECT * FROM questions"
            params = []
            wheres = []
            if category:
                wheres.append("category=?")
                params.append(category)
            if q_type:
                wheres.append("type=?")
                params.append(q_type)
            if wheres:
                sql += " WHERE " + " AND ".join(wheres)
            sql += " ORDER BY id"
            rows = db.execute(sql, params).fetchall()

        questions = []
        for r in rows:
            q = dict(r)
            q["options"] = json.loads(q["options"])
            q["answer"] = json.loads(q["answer"])

            last = db.execute("""
                SELECT selected, is_correct FROM user_answers
                WHERE user_id=? AND question_id=?
                ORDER BY answered_at DESC, id DESC LIMIT 1
            """, (user["id"], q["id"])).fetchone()

            q["user_last_answer"] = dict(last) if last else None
            if q["user_last_answer"]:
                q["user_last_answer"]["selected"] = json.loads(q["user_last_answer"]["selected"])

            stats = db.execute("""
                SELECT COUNT(*) as attempts, SUM(is_correct) as correct
                FROM user_answers WHERE user_id=? AND question_id=?
            """, (user["id"], q["id"])).fetchone()
            q["attempts"] = stats["attempts"]
            q["correct_count"] = stats["correct"] or 0

            questions.append(q)

    # Paginate (except random mode)
    if mode != "random":
        total = len(questions)
        # Build lightweight nav list from ALL matching questions
        all_ids = []
        for q in questions:
            last_ans = q.get("user_last_answer")
            all_ids.append({
                "id": q["id"],
                "type": q["type"],
                "answered": q["attempts"] > 0,
                "correct": bool(last_ans and last_ans.get("is_correct")),
            })
        start = (page - 1) * page_size
        questions = questions[start:start + page_size]
        return {"total": total, "page": page, "page_size": page_size,
                "questions": questions, "all_ids": all_ids}

    return {"total": len(questions), "questions": questions}


@app.post("/api/answers")
def submit_answer(req: AnswerReq, user=Depends(get_current_user)):
    """Submit an answer for a single question in practice mode."""
    with get_db() as db:
        q = db.execute("SELECT * FROM questions WHERE id=?", (req.question_id,)).fetchone()
        if not q:
            raise HTTPException(404, "题目不存在")

        correct_answer = sorted(json.loads(q["answer"]))
        user_answer = normalize_selected_options(q, req.selected)
        is_correct = int(correct_answer == user_answer)

        db.execute(
            "INSERT INTO user_answers (user_id, question_id, selected, is_correct, answered_at) VALUES (?,?,?,?,datetime('now','localtime'))",
            (user["id"], req.question_id, json.dumps(user_answer, ensure_ascii=False), is_correct)
        )

    return {
        "is_correct": bool(is_correct),
        "correct_answer": json.loads(q["answer"]),
        "user_answer": req.selected
    }


# ── Exam endpoints ──────────────────────────────────────────────────────────
def _exam_session_payload(db, session_row) -> dict:
    """Render an active (un-submitted) exam session for the frontend."""
    q_ids = json.loads(session_row["question_ids"])
    questions = []
    for qid in q_ids:
        q = db.execute("SELECT * FROM questions WHERE id=?", (qid,)).fetchone()
        if not q:
            continue
        qd = dict(q)
        qd["options"] = json.loads(qd["options"])
        del qd["answer"]  # Never leak answer during the exam
        questions.append(qd)

    progress_raw = session_row["progress_json"] if "progress_json" in session_row.keys() else None
    progress: dict[str, list[str]] = {}
    if progress_raw:
        try:
            parsed = json.loads(progress_raw)
            if isinstance(parsed, dict):
                progress = {str(k): list(v) for k, v in parsed.items() if isinstance(v, list)}
        except (json.JSONDecodeError, TypeError):
            progress = {}

    effective_start = _effective_theory_session_start(session_row)
    if effective_start is None:
        effective_start = datetime.now()
    deadline = (
        effective_start + timedelta(minutes=EXAM_DURATION_MINUTES)
    )
    start_time = effective_start.strftime("%Y-%m-%d %H:%M:%S")
    return {
        "session_id": session_row["id"],
        "questions": questions,
        "total": len(questions),
        "structure": OFFICIAL_EXAM_BLUEPRINT,
        "duration_minutes": EXAM_DURATION_MINUTES,
        "max_score": 100,
        "pass_score": EXAM_PASS_SCORE,
        "start_time": start_time,
        "deadline": deadline.strftime("%Y-%m-%d %H:%M:%S"),
        "progress": progress,
    }


def _find_active_session(db, user_id: int):
    """Return the user's un-submitted, not-expired exam session row, if any."""
    rows = db.execute(
        "SELECT * FROM exam_sessions WHERE user_id=? AND end_time IS NULL "
        "ORDER BY start_time DESC",
        (user_id,),
    ).fetchall()
    cutoff = datetime.now() - timedelta(
        minutes=EXAM_DURATION_MINUTES, seconds=EXAM_SUBMIT_GRACE_SECONDS
    )
    for row in rows:
        started = _effective_theory_session_start(row)
        if started is None:
            continue
        if started > cutoff:
            return row
    return None


@app.post("/api/exams/start")
def start_exam(
    count: int = Query(50, ge=10, le=900),
    category: Optional[str] = None,
    q_type: Optional[str] = Query(None, alias="type"),
    user=Depends(get_current_user)
):
    """Start the official mock exam with a fixed question ratio.

    If the user already has an un-submitted, in-window session, return 409 +
    that session's id so the frontend can route to the resume flow.
    """
    with get_db() as db:
        active = _find_active_session(db, user["id"])
        if active is not None:
            raise HTTPException(
                status_code=409,
                detail={
                    "message": "已有进行中的考试，请继续作答或交卷后再开始新考试。",
                    "session_id": active["id"],
                },
            )

        q_ids: list[int] = []
        for exam_type, required_count in OFFICIAL_EXAM_BLUEPRINT.items():
            rows = db.execute(
                "SELECT id FROM questions WHERE type=? ORDER BY RANDOM() LIMIT ?",
                (exam_type, required_count),
            ).fetchall()
            if len(rows) < required_count:
                raise HTTPException(
                    400,
                    f"{QUESTION_TYPE_LABELS[exam_type]}题量不足，无法生成官方模拟卷",
                )
            q_ids.extend(r["id"] for r in rows)
        random.shuffle(q_ids)

        cursor = db.execute(
            "INSERT INTO exam_sessions (user_id, question_ids, start_time, total, last_seen_at) "
            "VALUES (?,?,datetime('now','localtime'),?, datetime('now','localtime'))",
            (user["id"], json.dumps(q_ids), len(q_ids))
        )
        session_id = cursor.lastrowid
        session_row = db.execute(
            "SELECT * FROM exam_sessions WHERE id=?", (session_id,)
        ).fetchone()

        return _exam_session_payload(db, session_row)


@app.get("/api/exams/active")
def get_active_exam(user=Depends(get_current_user)):
    """Return the user's un-submitted, in-window exam session, or {}."""
    with get_db() as db:
        active = _find_active_session(db, user["id"])
        if active is None:
            return {}
        return _exam_session_payload(db, active)


class ExamProgressReq(BaseModel):
    answers: list[AnswerReq]


@app.put("/api/exams/{session_id}/progress")
def save_exam_progress(
    session_id: int,
    req: ExamProgressReq,
    user=Depends(get_current_user),
):
    """Persist exam draft answers (debounced from the frontend, ~15s)."""
    with get_db() as db:
        session = db.execute(
            "SELECT * FROM exam_sessions WHERE id=? AND user_id=?",
            (session_id, user["id"]),
        ).fetchone()
        if not session:
            raise HTTPException(404, "考试会话不存在")
        if session["end_time"]:
            raise HTTPException(409, "该考试已交卷，无法保存草稿")

        valid_qids = set(json.loads(session["question_ids"]))
        question_cache: dict[int, sqlite3.Row] = {}
        progress: dict[str, list[str]] = {}
        for ans in req.answers:
            if ans.question_id not in valid_qids:
                raise HTTPException(400, "草稿包含不属于本场考试的题目")
            if ans.question_id not in question_cache:
                qrow = db.execute(
                    "SELECT * FROM questions WHERE id=?", (ans.question_id,)
                ).fetchone()
                if not qrow:
                    raise HTTPException(500, f"考试题目不存在: {ans.question_id}")
                question_cache[ans.question_id] = qrow
            normalized = normalize_selected_options(
                question_cache[ans.question_id], ans.selected
            )
            progress[str(ans.question_id)] = normalized

        db.execute(
            "UPDATE exam_sessions SET progress_json=?, last_seen_at=datetime('now','localtime') "
            "WHERE id=?",
            (json.dumps(progress, ensure_ascii=False), session_id),
        )
    return {"saved": len(progress)}


@app.get("/api/exams/{session_id}/review")
def review_exam(session_id: int, user=Depends(get_current_user)):
    """Return per-question replay payload for a submitted exam."""
    with get_db() as db:
        session = db.execute(
            "SELECT * FROM exam_sessions WHERE id=? AND user_id=?",
            (session_id, user["id"]),
        ).fetchone()
        if not session:
            raise HTTPException(404, "考试会话不存在")
        if not session["end_time"]:
            raise HTTPException(409, "该考试尚未交卷，无法查看复盘")

        answer_rows = db.execute(
            "SELECT question_id, selected, is_correct FROM exam_answers WHERE session_id=?",
            (session_id,),
        ).fetchall()
        ans_map = {
            r["question_id"]: {
                "selected": json.loads(r["selected"]),
                "is_correct": bool(r["is_correct"]),
            }
            for r in answer_rows
        }

        q_ids = json.loads(session["question_ids"])
        items = []
        for qid in q_ids:
            q = db.execute("SELECT * FROM questions WHERE id=?", (qid,)).fetchone()
            if not q:
                continue
            qd = dict(q)
            qd["options"] = json.loads(qd["options"])
            qd["answer"] = json.loads(qd["answer"])
            user_ans = ans_map.get(qid, {"selected": [], "is_correct": False})
            items.append({
                "id": qd["id"],
                "type": qd["type"],
                "category": qd["category"],
                "text": qd["text"],
                "options": qd["options"],
                "correct_answer": qd["answer"],
                "user_answer": user_ans["selected"],
                "is_correct": user_ans["is_correct"],
                "max_points": QUESTION_TYPE_POINTS.get(qd["type"], 0),
                "points_awarded": (
                    QUESTION_TYPE_POINTS.get(qd["type"], 0)
                    if user_ans["is_correct"] else 0
                ),
            })

        return {
            "session_id": session_id,
            "score": session["score"],
            "total": session["total"],
            "pass_score": EXAM_PASS_SCORE,
            "start_time": session["start_time"],
            "end_time": session["end_time"],
            "items": items,
        }

@app.post("/api/exams/submit")
def submit_exam(req: ExamSubmitReq, user=Depends(get_current_user)):
    """Submit all answers for an exam."""
    with get_db() as db:
        session = db.execute("SELECT * FROM exam_sessions WHERE id=? AND user_id=?",
                             (req.session_id, user["id"])).fetchone()
        if not session:
            raise HTTPException(404, "考试会话不存在")
        if session["end_time"]:
            raise HTTPException(400, "该考试已提交过")
        start_time = _effective_theory_session_start(session)
        if start_time is None:
            raise HTTPException(500, "考试开始时间异常")
        deadline = start_time + timedelta(minutes=EXAM_DURATION_MINUTES)
        if datetime.now() > deadline + timedelta(seconds=EXAM_SUBMIT_GRACE_SECONDS):
            raise HTTPException(400, "考试已超时，请重新开始官方模拟卷")

        session_qids = json.loads(session["question_ids"])
        submitted_answers: dict[int, list[str]] = {}
        question_map: dict[int, sqlite3.Row] = {}
        for qid in session_qids:
            question = db.execute("SELECT * FROM questions WHERE id=?", (qid,)).fetchone()
            if not question:
                raise HTTPException(500, f"考试题目不存在: {qid}")
            question_map[qid] = question

        valid_qids = set(session_qids)
        for ans in req.answers:
            if ans.question_id not in valid_qids:
                raise HTTPException(400, "提交了不属于本场考试的题目")
            if ans.question_id in submitted_answers:
                raise HTTPException(400, "存在重复提交的题目")
            submitted_answers[ans.question_id] = normalize_selected_options(
                question_map[ans.question_id],
                ans.selected,
            )

        correct_count = 0
        total_points = 0.0
        breakdown = {
            q_type: {
                "label": QUESTION_TYPE_LABELS[q_type],
                "total_questions": OFFICIAL_EXAM_BLUEPRINT[q_type],
                "correct": 0,
                "score": 0.0,
                "max_score": OFFICIAL_EXAM_BLUEPRINT[q_type] * QUESTION_TYPE_POINTS[q_type],
            }
            for q_type in OFFICIAL_EXAM_BLUEPRINT
        }
        results = []
        for qid in session_qids:
            q = question_map[qid]
            correct_answer = sorted(json.loads(q["answer"]))
            user_answer = submitted_answers.get(qid, [])
            is_correct = int(correct_answer == user_answer)
            correct_count += is_correct
            q_type = q["type"]
            awarded_points = QUESTION_TYPE_POINTS[q_type] if is_correct else 0.0
            total_points += awarded_points
            breakdown[q_type]["correct"] += is_correct
            breakdown[q_type]["score"] += awarded_points

            db.execute(
                "INSERT INTO exam_answers (session_id, question_id, selected, is_correct) VALUES (?,?,?,?)",
                (req.session_id, qid, json.dumps(user_answer, ensure_ascii=False), is_correct)
            )
            # Also record in user_answers for stats
            db.execute(
                "INSERT INTO user_answers (user_id, question_id, selected, is_correct, answered_at) VALUES (?,?,?,?,datetime('now','localtime'))",
                (user["id"], qid, json.dumps(user_answer, ensure_ascii=False), is_correct)
            )

            results.append({
                "question_id": qid,
                "type": q_type,
                "is_correct": bool(is_correct),
                "correct_answer": json.loads(q["answer"]),
                "user_answer": user_answer,
                "question_text": q["text"],
                "points_awarded": awarded_points,
                "max_points": QUESTION_TYPE_POINTS[q_type],
            })

        total = len(session_qids)
        score = round(total_points, 1)
        db.execute(
            "UPDATE exam_sessions SET end_time=datetime('now','localtime'), score=?, "
            "progress_json=NULL, last_seen_at=datetime('now','localtime') WHERE id=?",
            (score, req.session_id)
        )
        # Close any other orphaned sessions for this user (e.g. from double-click)
        db.execute(
            "UPDATE exam_sessions SET end_time=datetime('now','localtime'), score=0 "
            "WHERE user_id=? AND end_time IS NULL AND id!=?",
            (user["id"], req.session_id)
        )

    return {
        "score": score,
        "correct": correct_count,
        "total": total,
        "pass_score": EXAM_PASS_SCORE,
        "duration_minutes": EXAM_DURATION_MINUTES,
        "breakdown": {
            q_type: {
                **data,
                "score": round(data["score"], 1),
            }
            for q_type, data in breakdown.items()
        },
        "results": results
    }

@app.get("/api/exams/history")
def exam_history(user=Depends(get_current_user)):
    with get_db() as db:
        rows = db.execute("""
            SELECT id, start_time, end_time, score, total
            FROM exam_sessions WHERE user_id=? AND end_time IS NOT NULL
            ORDER BY start_time DESC LIMIT 50
        """, (user["id"],)).fetchall()
    return [dict(r) for r in rows]


# ── Stats endpoints ─────────────────────────────────────────────────────────
@app.get("/api/stats")
def get_stats(user=Depends(get_current_user)):
    """Get current user's learning statistics."""
    with get_db() as db:
        total_questions = db.execute("SELECT COUNT(*) FROM questions").fetchone()[0]

        # Overall stats
        overall = db.execute("""
            SELECT COUNT(DISTINCT question_id) as attempted,
                   COUNT(*) as total_attempts,
                   SUM(is_correct) as correct_attempts
            FROM user_answers WHERE user_id=?
        """, (user["id"],)).fetchone()

        # Category stats
        cat_stats = db.execute("""
            SELECT q.category,
                   COUNT(DISTINCT q.id) as total,
                   COUNT(DISTINCT CASE WHEN ua.question_id IS NOT NULL THEN q.id END) as attempted,
                   SUM(CASE WHEN ua.is_correct = 1 AND ua.rn = 1 THEN 1 ELSE 0 END) as mastered
            FROM questions q
            LEFT JOIN (
                SELECT question_id, is_correct,
                    ROW_NUMBER() OVER (PARTITION BY question_id ORDER BY answered_at DESC, id DESC) as rn
                FROM user_answers WHERE user_id=?
            ) ua ON q.id = ua.question_id AND ua.rn = 1
            GROUP BY q.category ORDER BY MIN(q.id)
        """, (user["id"],)).fetchall()

        # Per-question buckets:
        #   wrong       — latest attempt is wrong (待清错题)
        #   corrected   — has at least one historical wrong, latest is correct (已订正，二刷三刷复盘对象)
        #   first_pass  — only correct attempts ever (首答即对，可不复盘)
        bucket_row = db.execute("""
            SELECT
                SUM(CASE WHEN latest_correct = 0 THEN 1 ELSE 0 END) AS wrong_count,
                SUM(CASE WHEN latest_correct = 1 AND has_wrong = 1 THEN 1 ELSE 0 END) AS corrected_count,
                SUM(CASE WHEN latest_correct = 1 AND has_wrong = 0 THEN 1 ELSE 0 END) AS first_pass_count
            FROM (
                SELECT question_id,
                       MAX(CASE WHEN is_correct = 0 THEN 1 ELSE 0 END) AS has_wrong,
                       MAX(CASE WHEN rn = 1 THEN is_correct END) AS latest_correct
                FROM (
                    SELECT question_id, is_correct,
                        ROW_NUMBER() OVER (PARTITION BY question_id ORDER BY answered_at DESC, id DESC) as rn
                    FROM user_answers WHERE user_id=?
                )
                GROUP BY question_id
            )
        """, (user["id"],)).fetchone()
        wrong_count = bucket_row["wrong_count"] or 0
        corrected_count = bucket_row["corrected_count"] or 0
        first_pass_count = bucket_row["first_pass_count"] or 0

        # Recent activity (last 7 days)
        daily = db.execute("""
            SELECT DATE(answered_at) as day, COUNT(*) as count, SUM(is_correct) as correct
            FROM user_answers WHERE user_id=?
            AND answered_at >= datetime('now', 'localtime', '-7 days')
            GROUP BY DATE(answered_at) ORDER BY day
        """, (user["id"],)).fetchall()

        # Exam stats
        exam_stats = db.execute("""
            SELECT COUNT(*) as exam_count,
                   AVG(score) as avg_score,
                   MAX(score) as best_score
            FROM exam_sessions WHERE user_id=? AND end_time IS NOT NULL
        """, (user["id"],)).fetchone()

    return {
        "total_questions": total_questions,
        "attempted": overall["attempted"],
        "total_attempts": overall["total_attempts"],
        "correct_rate": round(overall["correct_attempts"] / overall["total_attempts"] * 100, 1) if overall["total_attempts"] else 0,
        "wrong_count": wrong_count,
        "corrected_count": corrected_count,
        "first_pass_count": first_pass_count,
        "categories": [dict(r) for r in cat_stats],
        "daily_activity": [dict(r) for r in daily],
        "exams": dict(exam_stats) if exam_stats else {},
    }


@app.get("/api/admin/stats")
def admin_stats(user=Depends(get_current_user)):
    """Admin: see all users' progress."""
    _require_feature("admin")
    if not user.get("is_admin"):
        raise HTTPException(403, "仅管理员可访问")

    with get_db() as db:
        users = db.execute("""
            SELECT u.id, u.username, u.display_name, u.created_at,
                   COUNT(DISTINCT ua.question_id) as attempted,
                   COUNT(ua.id) as total_attempts,
                   COALESCE(SUM(ua.is_correct), 0) as correct_attempts
            FROM users u
            LEFT JOIN user_answers ua ON u.id = ua.user_id
            GROUP BY u.id ORDER BY attempted DESC
        """).fetchall()

        # Exam leaderboard
        exams = db.execute("""
            SELECT u.display_name, u.username,
                   COUNT(es.id) as exam_count,
                   ROUND(AVG(es.score), 1) as avg_score,
                   MAX(es.score) as best_score
            FROM users u
            LEFT JOIN exam_sessions es ON u.id = es.user_id AND es.end_time IS NOT NULL
            GROUP BY u.id
            HAVING exam_count > 0
            ORDER BY avg_score DESC
        """).fetchall()

    return {
        "users": [dict(r) for r in users],
        "leaderboard": [dict(r) for r in exams]
    }


@app.get("/api/stats/heatmap")
def get_heatmap(
    days: int = Query(90, ge=1, le=365),
    user=Depends(get_current_user),
):
    """Return per-day answer counts over the trailing N days for the heatmap.

    Activity = practice answers + exam answers (both rows live in user_answers).
    """
    from datetime import date as _date
    with get_db() as db:
        rows = db.execute(
            "SELECT DATE(answered_at) AS day, COUNT(*) AS count "
            "FROM user_answers WHERE user_id=? "
            "AND answered_at >= datetime('now', 'localtime', ?) "
            "GROUP BY DATE(answered_at)",
            (user["id"], f"-{days - 1} days"),
        ).fetchall()
    counts = {r["day"]: r["count"] for r in rows}
    today = _date.today()
    series = []
    for offset in range(days - 1, -1, -1):
        d = today - timedelta(days=offset)
        key = d.strftime("%Y-%m-%d")
        series.append({"date": key, "count": counts.get(key, 0)})
    return {"days": days, "series": series}


@app.get("/api/stats/leaderboard")
def get_leaderboard(
    limit: int = Query(20, ge=1, le=100),
    user=Depends(get_current_user),
):
    _require_feature("leaderboard")
    """Public leaderboard by exam performance.

    Ranking = (avg_score DESC, exam_count DESC). Users with no submitted
    exam are excluded.
    """
    with get_db() as db:
        rows = db.execute(
            """
            SELECT u.id, u.username, u.display_name,
                   COUNT(es.id) AS exam_count,
                   ROUND(AVG(es.score), 1) AS avg_score,
                   MAX(es.score) AS best_score
            FROM users u
            INNER JOIN exam_sessions es
                ON u.id = es.user_id AND es.end_time IS NOT NULL
            GROUP BY u.id
            ORDER BY avg_score DESC, exam_count DESC, u.id ASC
            LIMIT ?
            """,
            (limit,),
        ).fetchall()
    return {
        "me": user["id"],
        "rows": [
            {
                "rank": idx + 1,
                "user_id": r["id"],
                "username": r["username"],
                "display_name": r["display_name"],
                "exam_count": r["exam_count"],
                "avg_score": r["avg_score"],
                "best_score": r["best_score"],
                "is_me": r["id"] == user["id"],
            }
            for idx, r in enumerate(rows)
        ],
    }


@app.get("/api/stats/competition")
def get_competition_board(
    limit: int = Query(20, ge=1, le=100),
    user=Depends(get_current_user),
):
    """Public competition board.

    Exposes aggregate progress and exam scores only. Detailed answer history
    remains private/admin-only.
    """
    _require_feature("leaderboard")
    with get_db() as db:
        total_questions = db.execute("SELECT COUNT(*) FROM questions").fetchone()[0]
        total_operations = len(_load_operations())

        theory_rows = db.execute(
            """
            SELECT u.id, u.username, u.display_name,
                   COUNT(DISTINCT latest.question_id) AS attempted,
                   COUNT(DISTINCT CASE WHEN latest.is_correct=1 THEN latest.question_id END) AS mastered
            FROM users u
            LEFT JOIN (
                SELECT user_id, question_id, is_correct
                FROM (
                    SELECT user_id, question_id, is_correct,
                           ROW_NUMBER() OVER (
                               PARTITION BY user_id, question_id
                               ORDER BY answered_at DESC, id DESC
                           ) AS rn
                    FROM user_answers
                )
                WHERE rn=1
            ) latest ON latest.user_id = u.id
            GROUP BY u.id
            ORDER BY mastered DESC, attempted DESC, u.id ASC
            LIMIT ?
            """,
            (limit,),
        ).fetchall()

        ops_rows = db.execute(
            """
            SELECT u.id, u.username, u.display_name,
                   COUNT(DISTINCT os.operation_id) AS submitted
            FROM users u
            LEFT JOIN op_sessions os
                ON os.user_id = u.id AND os.submitted_at IS NOT NULL
            GROUP BY u.id
            ORDER BY submitted DESC, u.id ASC
            LIMIT ?
            """,
            (limit,),
        ).fetchall()

        theory_exam_rows = db.execute(
            """
            SELECT u.id, u.username, u.display_name,
                   COUNT(es.id) AS exam_count,
                   ROUND(AVG(es.score), 1) AS avg_score,
                   MAX(es.score) AS best_score
            FROM users u
            INNER JOIN exam_sessions es
                ON u.id = es.user_id AND es.end_time IS NOT NULL
            GROUP BY u.id
            ORDER BY avg_score DESC, best_score DESC, exam_count DESC, u.id ASC
            LIMIT ?
            """,
            (limit,),
        ).fetchall()

        ops_exam_rows = db.execute(
            """
            SELECT u.id, u.username, u.display_name,
                   COUNT(oes.id) AS exam_count,
                   ROUND(AVG(
                       CASE
                           WHEN oes.total_score IS NOT NULL AND oes.total_score > 0
                           THEN oes.earned_score * 100.0 / oes.total_score
                           ELSE oes.earned_score
                       END
                   ), 1) AS avg_score,
                   ROUND(MAX(
                       CASE
                           WHEN oes.total_score IS NOT NULL AND oes.total_score > 0
                           THEN oes.earned_score * 100.0 / oes.total_score
                           ELSE oes.earned_score
                       END
                   ), 1) AS best_score
            FROM users u
            INNER JOIN ops_exam_sessions oes
                ON u.id = oes.user_id AND oes.submitted_at IS NOT NULL
            GROUP BY u.id
            ORDER BY avg_score DESC, best_score DESC, exam_count DESC, u.id ASC
            LIMIT ?
            """,
            (limit,),
        ).fetchall()

    def progress_rows(rows, done_key: str, total: int):
        out = []
        for idx, r in enumerate(rows):
            done = r[done_key] or 0
            pct = round(done / total * 100, 1) if total else 0.0
            out.append({
                "rank": idx + 1,
                "user_id": r["id"],
                "username": r["username"],
                "display_name": r["display_name"],
                done_key: done,
                "total": total,
                "progress_pct": pct,
                "is_me": r["id"] == user["id"],
            })
        return out

    def exam_rows(rows):
        return [
            {
                "rank": idx + 1,
                "user_id": r["id"],
                "username": r["username"],
                "display_name": r["display_name"],
                "exam_count": r["exam_count"],
                "avg_score": r["avg_score"],
                "best_score": r["best_score"],
                "is_me": r["id"] == user["id"],
            }
            for idx, r in enumerate(rows)
        ]

    return {
        "me": user["id"],
        "totals": {
            "theory_questions": total_questions,
            "operations": total_operations,
        },
        "theory_progress": progress_rows(theory_rows, "mastered", total_questions),
        "ops_progress": progress_rows(ops_rows, "submitted", total_operations),
        "theory_exam": exam_rows(theory_exam_rows),
        "ops_exam": exam_rows(ops_exam_rows),
    }


# ── Admin CSV exports ───────────────────────────────────────────────────────
def _csv_streaming_response(filename: str, header: list[str], row_iter):
    """Render an iterable of rows as a streaming CSV download."""
    import csv
    import io
    from fastapi.responses import StreamingResponse

    def gen():
        buf = io.StringIO()
        writer = csv.writer(buf)
        writer.writerow(header)
        yield buf.getvalue()
        buf.seek(0); buf.truncate(0)
        for row in row_iter:
            writer.writerow(row)
            yield buf.getvalue()
            buf.seek(0); buf.truncate(0)

    return StreamingResponse(
        gen(),
        media_type="text/csv; charset=utf-8",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


@app.get("/api/admin/export/users.csv")
def admin_export_users(user=Depends(get_current_user)):
    _require_feature("admin")
    if not user.get("is_admin"):
        raise HTTPException(403, "仅管理员可访问")
    with get_db() as db:
        rows = db.execute(
            """
            SELECT u.id, u.username, u.display_name, u.created_at,
                   COUNT(DISTINCT ua.question_id) AS attempted,
                   COUNT(ua.id) AS total_attempts,
                   COALESCE(SUM(ua.is_correct), 0) AS correct_attempts
            FROM users u
            LEFT JOIN user_answers ua ON u.id = ua.user_id
            GROUP BY u.id ORDER BY u.id
            """
        ).fetchall()

    def iter_rows():
        for r in rows:
            attempts = r["total_attempts"] or 0
            correct = r["correct_attempts"] or 0
            rate = round(correct / attempts * 100, 1) if attempts else 0.0
            yield [
                r["id"], r["username"], r["display_name"], r["created_at"],
                r["attempted"], attempts, correct, rate,
            ]

    return _csv_streaming_response(
        "users.csv",
        ["id", "username", "display_name", "registered_at",
         "attempted_questions", "total_attempts", "correct_attempts", "correct_rate_pct"],
        iter_rows(),
    )


@app.get("/api/admin/export/exams.csv")
def admin_export_exams(user=Depends(get_current_user)):
    _require_feature("admin")
    if not user.get("is_admin"):
        raise HTTPException(403, "仅管理员可访问")
    with get_db() as db:
        rows = db.execute(
            """
            SELECT es.id, u.username, u.display_name,
                   es.start_time, es.end_time, es.score, es.total
            FROM exam_sessions es
            INNER JOIN users u ON u.id = es.user_id
            WHERE es.end_time IS NOT NULL
            ORDER BY es.start_time DESC
            """
        ).fetchall()

    def iter_rows():
        for r in rows:
            passed = (r["score"] is not None and r["score"] >= EXAM_PASS_SCORE)
            yield [
                r["id"], r["username"], r["display_name"],
                r["start_time"], r["end_time"],
                r["score"], r["total"],
                "Y" if passed else "N",
            ]

    return _csv_streaming_response(
        "exams.csv",
        ["session_id", "username", "display_name",
         "start_time", "end_time", "score", "total_questions", "passed"],
        iter_rows(),
    )


# ── Operation Questions API ─────────────────────────────────────────────────
_operations_cache = None

def _load_operations():
    global _operations_cache
    if _operations_cache is None:
        if OPERATIONS_PATH.exists():
            with open(OPERATIONS_PATH, encoding="utf-8") as f:
                _operations_cache = json.load(f)
        else:
            _operations_cache = []
    return _operations_cache

# ── Feature routers ─────────────────────────────────────────────────────────
# NOTE: 必须在 `/api/operations/{question_id}` 之前注册，否则 `{question_id}`
# 会吞掉 `sessions` 字面量段，导致 POST /api/operations/sessions 返回 405。
from app.chat import router as chat_router, ws_router as chat_ws_router
from app.curriculum import router as curriculum_router
from app.dashboard import router as dashboard_router
from app.op_sessions import router as op_sessions_router
from app.op_ws import router as op_ws_router
from app.ops_exams import router as ops_exams_router
from app.progress_reset import router as progress_reset_router
from app.presence import router as presence_router
from app.wechat_gate import router as wechat_gate_router
from app.ops_unlock import router as ops_unlock_router, require_ops_unlocked
from app import wechat_gate
app.include_router(curriculum_router)
app.include_router(dashboard_router)
app.include_router(op_sessions_router)
app.include_router(op_ws_router)
app.include_router(ops_exams_router)
app.include_router(progress_reset_router)
if edition.is_feature_enabled("chat"):
    app.include_router(chat_router)
    app.include_router(chat_ws_router)
if edition.is_feature_enabled("presence"):
    app.include_router(presence_router)
if edition.is_feature_enabled("wechat_gate"):
    app.include_router(wechat_gate_router)
if edition.is_feature_enabled("ops_unlock"):
    app.include_router(ops_unlock_router)


# ── Classes (分班 / 课程安排 / 录屏) ────────────────────────────────────────
CLASSES_PATH = Path(os.environ.get("TRAINER_CLASSES_PATH", str(BASE_DIR / "data" / "classes.json")))


@app.get("/api/classes")
def get_classes(user=Depends(get_current_user)):
    """Return class committee, course schedule and recording metadata."""
    _require_feature("classes")
    if not CLASSES_PATH.exists():
        return {"classes": [], "schedules": [], "recordings": []}
    with open(CLASSES_PATH, "r", encoding="utf-8") as f:
        data = json.load(f)
    return {
        "classes": data.get("classes", []),
        "schedules": data.get("schedules", []),
        "recordings": data.get("recordings", []),
    }


@app.get("/api/operations")
def get_operations(category: Optional[str] = Query(None), user=Depends(get_current_user)):
    ops = _load_operations()
    if category:
        ops = [q for q in ops if q["category"] == category]
    op_by_id = {q["id"]: q for q in ops}
    with get_db() as conn:
        rows = conn.execute(
            """
            SELECT id, operation_id, self_score, submitted_at FROM (
                SELECT id, operation_id, self_score, submitted_at,
                       ROW_NUMBER() OVER (
                           PARTITION BY operation_id
                           ORDER BY submitted_at DESC, id DESC
                       ) rn
                FROM op_sessions
                WHERE user_id=? AND submitted_at IS NOT NULL
            ) WHERE rn=1
            """,
            (user["id"],),
        ).fetchall()
    submitted = {}
    for r in rows:
        op = op_by_id.get(r["operation_id"])
        if not op:
            continue
        total = float(op.get("total_score") or 0)
        score = float(r["self_score"] or 0)
        submitted[r["operation_id"]] = {
            "session_id": r["id"],
            "submitted_at": r["submitted_at"],
            "score": round(score, 1),
            "total": round(total, 1),
            "score_pct": round(score / total * 100, 1) if total else None,
        }
    ops = [
        {**q, "practice_result": submitted.get(q["id"])}
        for q in ops
    ]
    return {"questions": ops, "total": len(ops)}

@app.get("/api/operations/categories")
def get_operation_categories():
    ops = _load_operations()
    cats = {}
    for q in ops:
        c = q["category"]
        if c not in cats:
            cats[c] = {"name": c, "count": 0, "code_count": 0, "doc_count": 0}
        cats[c]["count"] += 1
        if q["type"] == "code":
            cats[c]["code_count"] += 1
        else:
            cats[c]["doc_count"] += 1
    return {"categories": list(cats.values())}

@app.get("/api/operations/{question_id}")
def get_operation(question_id: int, user=Depends(get_current_user)):
    require_ops_unlocked(user)
    ops = _load_operations()
    for q in ops:
        if q["id"] == question_id:
            payload = dict(q)
            sol = BASE_DIR / "data" / "questions" / str(question_id) / "solution.md"
            if sol.is_file():
                try:
                    payload["solution_guide"] = sol.read_text(encoding="utf-8")
                except OSError:
                    pass
            return payload
    raise HTTPException(404, "Operation question not found")


def _operation_workspace(question_id: int) -> Path:
    return BASE_DIR / "data" / "questions" / str(question_id)


def _safe_op_file(question_id: int, rel_path: str) -> Path:
    root = _operation_workspace(question_id).resolve()
    target = (root / rel_path).resolve()
    if root not in target.parents and target != root:
        raise HTTPException(400, "非法文件路径")
    if not target.is_file():
        raise HTTPException(404, "文件不存在")
    return target


def _file_kind(path: Path) -> str:
    suffix = path.suffix.lower()
    if suffix in {".csv", ".xlsx", ".xls"}:
        return "data"
    if suffix in {".ipynb", ".py"}:
        return "code"
    if suffix in {".onnx", ".pkl", ".joblib"}:
        return "model"
    if suffix in {".jpg", ".jpeg", ".png", ".gif", ".webp"}:
        return "image"
    if suffix in {".txt", ".md", ".json", ".html"}:
        return "text"
    if suffix in {".docx", ".doc"}:
        return "doc"
    return "file"


def _is_viewable(path: Path) -> bool:
    mime, _ = mimetypes.guess_type(path.name)
    suffix = path.suffix.lower()
    return bool(
        (mime and (mime.startswith("text/") or mime.startswith("image/")))
        or suffix in {".csv", ".txt", ".md", ".json", ".html", ".ipynb", ".py"}
    )


_DOCX_NS = {"w": "http://schemas.openxmlformats.org/wordprocessingml/2006/main"}


def _is_empty_learning_goal_prompt(text: str) -> bool:
    compact = re.sub(r"\s+", "", text or "")
    return compact in {"学习目标：", "学习目标:"}


def _docx_template_payload(question_id: int, docx_path: Path) -> dict:
    try:
        with zipfile.ZipFile(docx_path) as zf:
            xml = zf.read("word/document.xml")
    except (KeyError, zipfile.BadZipFile, OSError):
        raise HTTPException(400, "无法读取 Word 素材")

    try:
        root = ET.fromstring(xml)
    except ET.ParseError:
        raise HTTPException(400, "Word 素材格式异常")
    paragraphs = []
    blank_count = 0
    previous_text = ""
    for p in root.findall(".//w:body/w:p", _DOCX_NS):
        text_parts = []
        for node in p.iter():
            if node.tag == f"{{{_DOCX_NS['w']}}}t":
                text_parts.append(node.text or "")
            elif node.tag == f"{{{_DOCX_NS['w']}}}tab":
                text_parts.append("\t")
            elif node.tag == f"{{{_DOCX_NS['w']}}}br":
                text_parts.append("\n")
        text = "".join(text_parts).strip()
        if not text:
            continue
        segments = []
        pos = 0
        for match in re.finditer(r"_{5,}", text):
            if match.start() > pos:
                segments.append({"type": "text", "text": text[pos:match.start()]})
            blank_count += 1
            segments.append({
                "type": "blank",
                "id": f"B{blank_count}",
                "width": min(max(len(match.group(0)), 12), 28),
            })
            pos = match.end()
        if segments:
            if pos < len(text):
                segments.append({"type": "text", "text": text[pos:]})
        elif _is_empty_learning_goal_prompt(text):
            segments.append({"type": "text", "text": text})
            blank_count += 1
            segments.append({
                "type": "blank",
                "id": f"B{blank_count}",
                "width": 36,
                "kind": "learning_goal",
                "context": previous_text,
            })
        paragraphs.append({"segments": segments or [{"type": "text", "text": text}]})
        previous_text = text

    return {
        "available": blank_count > 0,
        "question_id": question_id,
        "file": docx_path.name,
        "blank_count": blank_count,
        "paragraphs": paragraphs if blank_count > 0 else [],
    }


@app.get("/api/operations/{question_id}/files")
def get_operation_files(question_id: int, user=Depends(get_current_user)):
    require_ops_unlocked(user)
    if not any(q["id"] == question_id for q in _load_operations()):
        raise HTTPException(404, "Operation question not found")
    root = _operation_workspace(question_id)
    if not root.is_dir():
        return {"files": [], "total": 0}

    files = []
    for path in sorted(root.rglob("*")):
        if not path.is_file():
            continue
        if "__pycache__" in path.parts or path.name.startswith(".") or path.suffix == ".pyc":
            continue
        rel = path.relative_to(root).as_posix()
        mime, _ = mimetypes.guess_type(path.name)
        files.append({
            "path": rel,
            "name": path.name,
            "size": path.stat().st_size,
            "kind": _file_kind(path),
            "mime": mime or "application/octet-stream",
            "viewable": _is_viewable(path),
        })
    return {"files": files, "total": len(files)}


@app.get("/api/operations/{question_id}/docx-template")
def get_operation_docx_template(question_id: int, user=Depends(get_current_user)):
    require_ops_unlocked(user)
    op = next((q for q in _load_operations() if q["id"] == question_id), None)
    if not op:
        raise HTTPException(404, "Operation question not found")
    if op.get("type") != "doc":
        raise HTTPException(404, "Not a document operation")
    root = _operation_workspace(question_id)
    docx_files = sorted(p for p in root.glob("*.docx") if p.is_file())
    if not docx_files:
        return {"available": False, "question_id": question_id, "blank_count": 0, "paragraphs": []}
    return _docx_template_payload(question_id, docx_files[0])


@app.get("/api/operations/{question_id}/files/{rel_path:path}")
def get_operation_file(question_id: int, rel_path: str, user=Depends(get_current_user)):
    require_ops_unlocked(user)
    if not any(q["id"] == question_id for q in _load_operations()):
        raise HTTPException(404, "Operation question not found")
    path = _safe_op_file(question_id, rel_path)
    mime, _ = mimetypes.guess_type(path.name)
    return FileResponse(
        path,
        media_type=mime or "application/octet-stream",
        filename=path.name,
    )

# ── Startup ─────────────────────────────────────────────────────────────────
import asyncio as _asyncio
from app.kernel_pool import get_pool as _get_pool

_reaper_task = None


@app.on_event("startup")
async def startup():
    run_migrations()
    count = load_questions_to_db()
    from app.seed_curriculum import seed as seed_curriculum
    seed_curriculum()

    # Phase 2: KernelPool 是进程内单例，多 worker 会让全表 UPDATE 踩到其他 worker 的活 kernel
    _wc = int(os.environ.get("WEB_CONCURRENCY", "1"))
    if _wc > 1:
        raise RuntimeError(
            f"Phase 2 requires WEB_CONCURRENCY=1 (got {_wc}); "
            "KernelPool is process-local."
        )

    # Phase 2: op_sessions.kernel_id 不跨进程生命周期 → 启动时一律清空
    with get_db() as conn:
        conn.execute("UPDATE op_sessions SET kernel_id=NULL WHERE kernel_id IS NOT NULL")

    global _reaper_task
    pool = _get_pool()
    _reaper_task = _asyncio.create_task(pool.run_reaper(interval=60))

    print(f"✅ Loaded {count} questions, curriculum seeded, kernel reaper started")

    # Phase 3 · D2: warn if code-type operations are missing their data/questions/<id>/ dir
    try:
        _ops = _load_operations()
        _missing = []
        for _op in _ops:
            if _op.get("type") == "code":
                _dir = BASE_DIR / "data" / "questions" / str(_op.get("id"))
                if not _dir.is_dir():
                    _missing.append(f"  · op#{_op.get('id')} {_op.get('title','')[:30]} → {_dir.relative_to(BASE_DIR)}")
        if _missing:
            print("⚠️  以下代码题缺少数据目录（kernel 将使用空目录，含数据集引用的题会失败）：")
            for line in _missing:
                print(line)
    except Exception as _e:  # noqa: BLE001
        print(f"⚠️  op data-dir check skipped: {_e}")


@app.on_event("shutdown")
async def shutdown():
    global _reaper_task
    if _reaper_task:
        _reaper_task.cancel()
        try:
            await _reaper_task
        except _asyncio.CancelledError:
            pass
        _reaper_task = None
    pool = _get_pool()
    await pool.shutdown_all()
    print("✅ Kernel pool shut down")

# ── Feedback ───────────────────────────────────────────────────────────────
FEEDBACK_MAX_LEN = 2000


class FeedbackReq(BaseModel):
    content: str


class FeedbackPatchReq(BaseModel):
    is_read: Optional[bool] = None
    is_resolved: Optional[bool] = None


class FeedbackMessageReq(BaseModel):
    content: str


def _now_local_sql() -> str:
    # Match migrations: SQLite localtime string "YYYY-MM-DD HH:MM:SS"
    return "datetime('now','localtime')"


# Millisecond-precision timestamp used for feedback read/last_msg fields,
# so back-to-back operations within one second still sort strictly.
_FB_NOW = "strftime('%Y-%m-%d %H:%M:%f','now','localtime')"


def _feedback_unread_for_user(db, user) -> int:
    if user.get("is_admin"):
        row = db.execute(
            "SELECT COUNT(*) AS n FROM feedbacks "
            "WHERE last_msg_role='user' "
            "  AND (admin_last_read_at IS NULL OR last_msg_at > admin_last_read_at)"
        ).fetchone()
    else:
        row = db.execute(
            "SELECT COUNT(*) AS n FROM feedbacks "
            "WHERE user_id=? AND last_msg_role='admin' "
            "  AND (user_last_read_at IS NULL OR last_msg_at > user_last_read_at)",
            (user["id"],),
        ).fetchone()
    return int(row["n"] or 0)


@app.post("/api/feedbacks")
def feedback_submit(req: FeedbackReq, user=Depends(get_current_user)):
    _require_feature("feedback")
    content = (req.content or "").strip()
    if not content:
        raise HTTPException(400, "反馈内容不能为空")
    if len(content) > FEEDBACK_MAX_LEN:
        raise HTTPException(400, f"反馈内容不能超过 {FEEDBACK_MAX_LEN} 字")
    with get_db() as db:
        cur = db.execute(
            "INSERT INTO feedbacks (user_id, content, last_msg_at, last_msg_role, "
            "                       user_last_read_at) "
            "VALUES (?, ?, " + _FB_NOW + ", 'user', "
            "        " + _FB_NOW + ")",
            (user["id"], content),
        )
        fid = cur.lastrowid
        row = db.execute(
            "SELECT id, content, is_read, is_resolved, created_at, "
            "       last_msg_at, last_msg_role "
            "FROM feedbacks WHERE id=?", (fid,),
        ).fetchone()
    return dict(row)


@app.get("/api/feedbacks/mine")
def feedback_mine(user=Depends(get_current_user)):
    _require_feature("feedback")
    with get_db() as db:
        rows = db.execute(
            "SELECT id, content, is_read, is_resolved, created_at, "
            "       last_msg_at, last_msg_role, user_last_read_at "
            "FROM feedbacks WHERE user_id=? "
            "ORDER BY COALESCE(last_msg_at, created_at) DESC, id DESC",
            (user["id"],),
        ).fetchall()
        out = []
        for r in rows:
            d = dict(r)
            d["unread"] = bool(
                d["last_msg_role"] == "admin" and
                (d["user_last_read_at"] is None or
                 (d["last_msg_at"] or "") > (d["user_last_read_at"] or ""))
            )
            out.append(d)
    return {"rows": out}


@app.get("/api/feedbacks")
def feedback_public_list(user=Depends(get_current_user)):
    _require_feature("feedback")
    with get_db() as db:
        rows = db.execute(
            "SELECT f.id, f.content, f.is_read, f.is_resolved, f.created_at, "
            "       f.last_msg_at, f.last_msg_role, f.admin_last_read_at, "
            "       f.user_last_read_at, f.user_id, u.username, u.display_name "
            "FROM feedbacks f JOIN users u ON u.id=f.user_id "
            "ORDER BY COALESCE(f.last_msg_at, f.created_at) DESC, f.id DESC"
        ).fetchall()
        out = []
        unread = 0
        for r in rows:
            d = dict(r)
            if user.get("is_admin"):
                d["unread"] = bool(
                    d["last_msg_role"] == "user" and
                    (d["admin_last_read_at"] is None or
                     (d["last_msg_at"] or "") > (d["admin_last_read_at"] or ""))
                )
            elif d["user_id"] == user["id"]:
                d["unread"] = bool(
                    d["last_msg_role"] == "admin" and
                    (d["user_last_read_at"] is None or
                     (d["last_msg_at"] or "") > (d["user_last_read_at"] or ""))
                )
            else:
                d["unread"] = False
            if d["unread"]:
                unread += 1
            out.append(d)
    return {"rows": out, "total": len(out), "unread": unread,
            "resolved": sum(1 for d in out if d["is_resolved"])}


@app.get("/api/admin/feedbacks")
def feedback_admin_list(user=Depends(get_current_user)):
    _require_feature("feedback")
    if not user.get("is_admin"):
        raise HTTPException(403, "仅管理员可访问")
    with get_db() as db:
        rows = db.execute(
            "SELECT f.id, f.content, f.is_read, f.is_resolved, f.created_at, "
            "       f.last_msg_at, f.last_msg_role, f.admin_last_read_at, "
            "       f.user_id, u.username, u.display_name "
            "FROM feedbacks f JOIN users u ON u.id=f.user_id "
            "ORDER BY COALESCE(f.last_msg_at, f.created_at) DESC, f.id DESC"
        ).fetchall()
        out = []
        unread = 0
        for r in rows:
            d = dict(r)
            d["unread"] = bool(
                d["last_msg_role"] == "user" and
                (d["admin_last_read_at"] is None or
                 (d["last_msg_at"] or "") > (d["admin_last_read_at"] or ""))
            )
            if d["unread"]:
                unread += 1
            out.append(d)
    return {"rows": out, "total": len(out), "unread": unread,
            "resolved": sum(1 for d in out if d["is_resolved"])}


@app.get("/api/feedbacks/unread_count")
def feedback_unread_count(user=Depends(get_current_user)):
    if not edition.is_feature_enabled("feedback"):
        return {"count": 0}
    with get_db() as db:
        return {"count": _feedback_unread_for_user(db, user)}


@app.get("/api/feedbacks/{fid}")
def feedback_thread(fid: int, user=Depends(get_current_user)):
    _require_feature("feedback")
    with get_db() as db:
        f = db.execute(
            "SELECT f.*, u.username, u.display_name "
            "FROM feedbacks f JOIN users u ON u.id=f.user_id WHERE f.id=?",
            (fid,),
        ).fetchone()
        if not f:
            raise HTTPException(404, "反馈不存在")

        msgs = db.execute(
            "SELECT m.id, m.sender_id, m.sender_role, m.content, m.created_at, "
            "       u.username, u.display_name "
            "FROM feedback_messages m LEFT JOIN users u ON u.id=m.sender_id "
            "WHERE m.feedback_id=? ORDER BY m.created_at ASC, m.id ASC",
            (fid,),
        ).fetchall()

        # Mark as read only for the admin or the feedback owner. Other users
        # may view the public thread without changing either side's read state.
        if user.get("is_admin"):
            db.execute(
                "UPDATE feedbacks SET admin_last_read_at=" + _FB_NOW + ", "
                "                     is_read=1 WHERE id=?", (fid,))
        elif f["user_id"] == user["id"]:
            db.execute(
                "UPDATE feedbacks SET user_last_read_at=" + _FB_NOW + " "
                "WHERE id=?", (fid,))

    f = dict(f)
    return {
        "feedback": {
            "id": f["id"], "user_id": f["user_id"],
            "username": f["username"], "display_name": f["display_name"],
            "content": f["content"], "created_at": f["created_at"],
            "is_read": bool(f["is_read"]), "is_resolved": bool(f["is_resolved"]),
            "last_msg_at": f["last_msg_at"], "last_msg_role": f["last_msg_role"],
        },
        "messages": [dict(m) for m in msgs],
    }


@app.post("/api/feedbacks/{fid}/messages")
def feedback_post_message(fid: int, req: FeedbackMessageReq,
                          user=Depends(get_current_user)):
    _require_feature("feedback")
    content = (req.content or "").strip()
    if not content:
        raise HTTPException(400, "回复内容不能为空")
    if len(content) > FEEDBACK_MAX_LEN:
        raise HTTPException(400, f"回复内容不能超过 {FEEDBACK_MAX_LEN} 字")
    with get_db() as db:
        f = db.execute("SELECT user_id FROM feedbacks WHERE id=?", (fid,)).fetchone()
        if not f:
            raise HTTPException(404, "反馈不存在")
        is_admin = bool(user.get("is_admin"))
        if not is_admin and f["user_id"] != user["id"]:
            raise HTTPException(403, "无权回复")
        role = "admin" if is_admin else "user"
        cur = db.execute(
            "INSERT INTO feedback_messages (feedback_id, sender_id, sender_role, content) "
            "VALUES (?, ?, ?, ?)",
            (fid, user["id"], role, content),
        )
        mid = cur.lastrowid
        # Update thread state + the sender's read timestamp.
        if is_admin:
            db.execute(
                "UPDATE feedbacks SET last_msg_at=" + _FB_NOW + ", "
                "                     last_msg_role='admin', "
                "                     admin_last_read_at=" + _FB_NOW + ", "
                "                     is_read=1 "
                "WHERE id=?", (fid,))
        else:
            db.execute(
                "UPDATE feedbacks SET last_msg_at=" + _FB_NOW + ", "
                "                     last_msg_role='user', "
                "                     user_last_read_at=" + _FB_NOW + ", "
                "                     is_read=0 "
                "WHERE id=?", (fid,))
        row = db.execute(
            "SELECT m.id, m.sender_id, m.sender_role, m.content, m.created_at, "
            "       u.username, u.display_name "
            "FROM feedback_messages m LEFT JOIN users u ON u.id=m.sender_id "
            "WHERE m.id=?", (mid,)
        ).fetchone()
    return dict(row)


@app.patch("/api/admin/feedbacks/{fid}")
def feedback_admin_patch(fid: int, req: FeedbackPatchReq,
                         user=Depends(get_current_user)):
    _require_feature("feedback")
    if not user.get("is_admin"):
        raise HTTPException(403, "仅管理员可访问")
    sets, args = [], []
    if req.is_read is not None:
        sets.append("is_read=?"); args.append(1 if req.is_read else 0)
        if req.is_read:
            sets.append("admin_last_read_at=" + _FB_NOW + "")
    if req.is_resolved is not None:
        sets.append("is_resolved=?"); args.append(1 if req.is_resolved else 0)
    if not sets:
        raise HTTPException(400, "无可更新字段")
    args.append(fid)
    with get_db() as db:
        cur = db.execute(f"UPDATE feedbacks SET {', '.join(sets)} WHERE id=?", args)
        if cur.rowcount == 0:
            raise HTTPException(404, "反馈不存在")
        row = db.execute(
            "SELECT id, is_read, is_resolved FROM feedbacks WHERE id=?", (fid,)
        ).fetchone()
    return {"id": row["id"], "is_read": bool(row["is_read"]),
            "is_resolved": bool(row["is_resolved"])}


@app.delete("/api/admin/feedbacks/{fid}")
def feedback_admin_delete(fid: int, user=Depends(get_current_user)):
    _require_feature("feedback")
    if not user.get("is_admin"):
        raise HTTPException(403, "仅管理员可访问")
    with get_db() as db:
        db.execute("DELETE FROM feedback_messages WHERE feedback_id=?", (fid,))
        cur = db.execute("DELETE FROM feedbacks WHERE id=?", (fid,))
        if cur.rowcount == 0:
            raise HTTPException(404, "反馈不存在")
    return {"deleted": fid}


# ── Static files ────────────────────────────────────────────────────────────
@app.get("/")
def serve_index():
    return FileResponse(BASE_DIR / "static" / "index.html")

@app.get("/favicon.ico")
def serve_favicon():
    return FileResponse(BASE_DIR / "static" / "favicon.svg", media_type="image/svg+xml")

app.mount("/static", StaticFiles(directory=str(BASE_DIR / "static")), name="static")
