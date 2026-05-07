ALTER TABLE users ADD COLUMN wechat_gate_required INTEGER DEFAULT 0;

CREATE TABLE IF NOT EXISTS wechat_user_links (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL UNIQUE,
    openid TEXT NOT NULL UNIQUE,
    unionid TEXT,
    subscribed INTEGER NOT NULL DEFAULT 1,
    subscribed_at TEXT,
    unsubscribed_at TEXT,
    last_event_at TEXT,
    created_at TEXT DEFAULT (datetime('now','localtime')),
    updated_at TEXT DEFAULT (datetime('now','localtime')),
    FOREIGN KEY (user_id) REFERENCES users(id)
);

CREATE TABLE IF NOT EXISTS wechat_login_challenges (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    scene_key TEXT NOT NULL UNIQUE,
    poll_token TEXT NOT NULL,
    ticket TEXT,
    qrcode_url TEXT,
    status TEXT NOT NULL DEFAULT 'pending',
    openid TEXT,
    message TEXT,
    expires_at TEXT NOT NULL,
    created_at TEXT DEFAULT (datetime('now','localtime')),
    completed_at TEXT,
    FOREIGN KEY (user_id) REFERENCES users(id)
);

CREATE INDEX IF NOT EXISTS idx_wechat_challenges_scene ON wechat_login_challenges(scene_key);
CREATE INDEX IF NOT EXISTS idx_wechat_challenges_user ON wechat_login_challenges(user_id);
CREATE INDEX IF NOT EXISTS idx_wechat_challenges_status ON wechat_login_challenges(status);
