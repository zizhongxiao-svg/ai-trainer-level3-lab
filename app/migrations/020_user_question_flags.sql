CREATE TABLE IF NOT EXISTS user_question_flags (
    user_id INTEGER NOT NULL,
    question_id INTEGER NOT NULL,
    flagged_at TEXT NOT NULL DEFAULT (datetime('now', 'localtime')),
    PRIMARY KEY (user_id, question_id),
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    FOREIGN KEY (question_id) REFERENCES questions(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_user_question_flags_user
    ON user_question_flags(user_id, flagged_at DESC);
