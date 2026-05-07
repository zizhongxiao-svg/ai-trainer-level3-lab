CREATE TABLE IF NOT EXISTS curriculum_sections (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    parent_id INTEGER,
    title TEXT NOT NULL,
    ord INTEGER NOT NULL DEFAULT 0,
    description TEXT,
    FOREIGN KEY (parent_id) REFERENCES curriculum_sections(id)
);
CREATE INDEX IF NOT EXISTS idx_sections_parent ON curriculum_sections(parent_id);

CREATE TABLE IF NOT EXISTS knowledge_points (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    section_id INTEGER NOT NULL,
    title TEXT NOT NULL,
    summary TEXT,
    ord INTEGER NOT NULL DEFAULT 0,
    FOREIGN KEY (section_id) REFERENCES curriculum_sections(id)
);
CREATE INDEX IF NOT EXISTS idx_kp_section ON knowledge_points(section_id);

CREATE TABLE IF NOT EXISTS question_kp_map (
    question_id INTEGER NOT NULL,
    kp_id INTEGER NOT NULL,
    PRIMARY KEY (question_id, kp_id),
    FOREIGN KEY (question_id) REFERENCES questions(id),
    FOREIGN KEY (kp_id) REFERENCES knowledge_points(id)
);
CREATE INDEX IF NOT EXISTS idx_qkpmap_kp ON question_kp_map(kp_id);

CREATE TABLE IF NOT EXISTS question_explanations (
    question_id INTEGER PRIMARY KEY,
    explanation TEXT NOT NULL,
    common_mistake TEXT,
    updated_at TEXT DEFAULT (datetime('now')),
    FOREIGN KEY (question_id) REFERENCES questions(id)
);
