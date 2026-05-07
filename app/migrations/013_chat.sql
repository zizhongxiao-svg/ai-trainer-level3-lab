-- 备考广场（聊天广播）：单频道 + 置顶公告
CREATE TABLE IF NOT EXISTS chat_messages (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id    INTEGER NOT NULL,
    content    TEXT    NOT NULL,
    created_at TEXT    NOT NULL DEFAULT (datetime('now')),
    deleted_at TEXT,
    deleted_by INTEGER,
    FOREIGN KEY (user_id)    REFERENCES users(id),
    FOREIGN KEY (deleted_by) REFERENCES users(id)
);
CREATE INDEX IF NOT EXISTS idx_chat_messages_id_desc
    ON chat_messages(id DESC);

CREATE TABLE IF NOT EXISTS chat_pins (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    content    TEXT    NOT NULL,
    created_by INTEGER NOT NULL,
    created_at TEXT    NOT NULL DEFAULT (datetime('now')),
    active     INTEGER NOT NULL DEFAULT 1,
    FOREIGN KEY (created_by) REFERENCES users(id)
);
CREATE INDEX IF NOT EXISTS idx_chat_pins_active
    ON chat_pins(active);
