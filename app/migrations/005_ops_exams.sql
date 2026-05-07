-- 实操模拟考试：2 题 / 60 分钟，独立于理论 exam_sessions
-- 真考场把理论和实操分开考，所以这里也分两张表避免语义混淆

CREATE TABLE IF NOT EXISTS ops_exam_sessions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    operation_ids TEXT NOT NULL,    -- JSON array, e.g. [2, 7]
    start_time TEXT DEFAULT (datetime('now')),
    end_time TEXT,                  -- deadline (start_time + duration_minutes)
    submitted_at TEXT,
    earned_score REAL,              -- sum of each op's auto_score.earned
    total_score REAL,               -- sum of each op's auto_score.total
    FOREIGN KEY (user_id) REFERENCES users(id)
);

CREATE INDEX IF NOT EXISTS idx_ops_exam_sessions_user
    ON ops_exam_sessions(user_id);

-- 一人同时最多一个未提交实操考
CREATE UNIQUE INDEX IF NOT EXISTS uq_ops_exam_sessions_active
    ON ops_exam_sessions(user_id)
    WHERE submitted_at IS NULL;
