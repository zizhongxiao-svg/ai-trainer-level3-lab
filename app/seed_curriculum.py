from __future__ import annotations
"""Seed curriculum sections + default knowledge points from existing questions.

Idempotent: re-running will not duplicate rows. Safe to call at startup.
"""
from app.db import get_db

# Official syllabus order; any category not in this list is appended at the end.
SECTION_ORDER = [
    "AI基础理论",
    "计算机基础",
    "数据采集与处理",
    "数据标注",
    "模型训练与评估",
    "培训与指导",
    "法律法规",
    "职业道德",
]


def seed():
    with get_db() as conn:
        # Collect distinct categories from questions
        rows = conn.execute(
            "SELECT DISTINCT category FROM questions ORDER BY category"
        ).fetchall()
        cats = [r[0] for r in rows]
        # Sort by SECTION_ORDER, extras append
        ordered = [c for c in SECTION_ORDER if c in cats] + \
                  [c for c in cats if c not in SECTION_ORDER]

        # Ensure top-level sections
        section_ids = {}
        for idx, cat in enumerate(ordered):
            existing = conn.execute(
                "SELECT id FROM curriculum_sections WHERE parent_id IS NULL AND title=?",
                (cat,)
            ).fetchone()
            if existing:
                section_ids[cat] = existing[0]
                conn.execute(
                    "UPDATE curriculum_sections SET ord=? WHERE id=?",
                    (idx, existing[0])
                )
            else:
                cur = conn.execute(
                    "INSERT INTO curriculum_sections (parent_id, title, ord) VALUES (NULL, ?, ?)",
                    (cat, idx)
                )
                section_ids[cat] = cur.lastrowid

        # Ensure default "综合" knowledge point per section
        kp_ids = {}
        for cat, sid in section_ids.items():
            existing = conn.execute(
                "SELECT id FROM knowledge_points WHERE section_id=? AND title='综合'",
                (sid,)
            ).fetchone()
            if existing:
                kp_ids[cat] = existing[0]
            else:
                cur = conn.execute(
                    "INSERT INTO knowledge_points (section_id, title, ord) VALUES (?, '综合', 0)",
                    (sid,)
                )
                kp_ids[cat] = cur.lastrowid

        # Map every question to its default kp
        for cat, kpid in kp_ids.items():
            qrows = conn.execute(
                "SELECT id FROM questions WHERE category=?",
                (cat,)
            ).fetchall()
            for qr in qrows:
                conn.execute(
                    "INSERT OR IGNORE INTO question_kp_map (question_id, kp_id) VALUES (?, ?)",
                    (qr[0], kpid)
                )


if __name__ == "__main__":
    seed()
    print("✅ Curriculum seeded")
