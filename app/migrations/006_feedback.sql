-- User feedback: single-table, text-only, with admin read-state.
-- Hard delete allowed to admin (single-admin system, low-stakes audit trail).

CREATE TABLE IF NOT EXISTS feedbacks (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id    INTEGER NOT NULL,
    content    TEXT    NOT NULL,
    is_read    INTEGER NOT NULL DEFAULT 0,
    created_at TEXT    NOT NULL DEFAULT (datetime('now')),
    FOREIGN KEY (user_id) REFERENCES users(id)
);

CREATE INDEX IF NOT EXISTS idx_feedbacks_user_created
    ON feedbacks(user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_feedbacks_unread_created
    ON feedbacks(is_read, created_at DESC);
