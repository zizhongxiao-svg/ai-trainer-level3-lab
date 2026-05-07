CREATE TABLE IF NOT EXISTS op_sessions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    operation_id INTEGER NOT NULL,
    kernel_id TEXT,
    blanks_draft TEXT,
    rubric_checks TEXT,
    started_at TEXT DEFAULT (datetime('now')),
    last_active_at TEXT DEFAULT (datetime('now')),
    submitted_at TEXT,
    self_score REAL,
    FOREIGN KEY (user_id) REFERENCES users(id)
);
CREATE INDEX IF NOT EXISTS idx_op_sessions_user
    ON op_sessions(user_id, operation_id);
-- 幂等保证：一个 (user, op) 最多只能有一条未提交 session；并发 INSERT 由
-- SQLite 抛 IntegrityError，handler 捕获后回查返回已存在行。
CREATE UNIQUE INDEX IF NOT EXISTS uq_op_sessions_active
    ON op_sessions(user_id, operation_id)
    WHERE submitted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_op_sessions_last_active
    ON op_sessions(last_active_at)
    WHERE submitted_at IS NULL;
