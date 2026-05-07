-- 实操考试 AI 判卷状态与逐题明细。

ALTER TABLE ops_exam_sessions ADD COLUMN grading_status TEXT DEFAULT 'none';
ALTER TABLE ops_exam_sessions ADD COLUMN grading_started_at TEXT;
ALTER TABLE ops_exam_sessions ADD COLUMN grading_completed_at TEXT;
ALTER TABLE ops_exam_sessions ADD COLUMN grading_error TEXT;

CREATE TABLE IF NOT EXISTS ops_exam_grades (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    exam_session_id INTEGER NOT NULL,
    operation_id INTEGER NOT NULL,
    op_session_id INTEGER,
    status TEXT NOT NULL DEFAULT 'pending',
    score REAL NOT NULL DEFAULT 0,
    max_score REAL NOT NULL DEFAULT 0,
    rubric_scores_json TEXT,
    ai_feedback_json TEXT,
    raw_output TEXT,
    model TEXT,
    reasoning_effort TEXT,
    error TEXT,
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now')),
    UNIQUE(exam_session_id, operation_id),
    FOREIGN KEY (exam_session_id) REFERENCES ops_exam_sessions(id),
    FOREIGN KEY (op_session_id) REFERENCES op_sessions(id)
);

CREATE INDEX IF NOT EXISTS idx_ops_exam_grades_exam
    ON ops_exam_grades(exam_session_id);
