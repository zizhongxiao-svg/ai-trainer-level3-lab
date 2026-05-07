-- Threaded feedback: admin/user back-and-forth replies, resolved state, read timestamps.

ALTER TABLE feedbacks ADD COLUMN is_resolved        INTEGER NOT NULL DEFAULT 0;
ALTER TABLE feedbacks ADD COLUMN last_msg_at        TEXT;
ALTER TABLE feedbacks ADD COLUMN last_msg_role      TEXT;
ALTER TABLE feedbacks ADD COLUMN admin_last_read_at TEXT;
ALTER TABLE feedbacks ADD COLUMN user_last_read_at  TEXT;

UPDATE feedbacks
   SET last_msg_at   = COALESCE(last_msg_at, created_at),
       last_msg_role = COALESCE(last_msg_role, 'user');

CREATE TABLE IF NOT EXISTS feedback_messages (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    feedback_id INTEGER NOT NULL,
    sender_id   INTEGER NOT NULL,
    sender_role TEXT    NOT NULL CHECK (sender_role IN ('user','admin')),
    content     TEXT    NOT NULL,
    created_at  TEXT    NOT NULL DEFAULT (datetime('now','localtime')),
    FOREIGN KEY (feedback_id) REFERENCES feedbacks(id) ON DELETE CASCADE,
    FOREIGN KEY (sender_id)   REFERENCES users(id)
);

CREATE INDEX IF NOT EXISTS idx_fbmsg_feedback_created
    ON feedback_messages(feedback_id, created_at);

CREATE INDEX IF NOT EXISTS idx_feedbacks_last_msg
    ON feedbacks(last_msg_at);
