ALTER TABLE users ADD COLUMN ops_unlock_required INTEGER DEFAULT 0;
ALTER TABLE users ADD COLUMN ops_unlocked_at TEXT;

CREATE TABLE IF NOT EXISTS ops_unlock_codes (
    code TEXT PRIMARY KEY,
    batch TEXT,
    used_by INTEGER,
    used_at TEXT,
    created_at TEXT DEFAULT (datetime('now','localtime')),
    FOREIGN KEY (used_by) REFERENCES users(id)
);

CREATE INDEX IF NOT EXISTS idx_ops_unlock_codes_used_by ON ops_unlock_codes(used_by);
