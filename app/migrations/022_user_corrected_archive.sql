-- 反馈 #15：重置练习状态时保留"已订正"。
-- 重置（keep_corrected=1）前把当时算出的已订正题号存档；
-- 题目无答题历史时订正状态以本表为准，一旦重新作答则回到按历史计算。
CREATE TABLE IF NOT EXISTS user_corrected_archive (
    user_id INTEGER NOT NULL,
    question_id INTEGER NOT NULL,
    archived_at TEXT NOT NULL DEFAULT (datetime('now', 'localtime')),
    PRIMARY KEY (user_id, question_id),
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    FOREIGN KEY (question_id) REFERENCES questions(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_user_corrected_archive_user
    ON user_corrected_archive(user_id);
