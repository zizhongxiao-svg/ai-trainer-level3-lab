-- Phase 3 · C1: exam draft recovery + replay support
-- progress_json: 草稿 {qid: [selected]}, 由 PUT /api/exams/{id}/progress 维护
-- last_seen_at:  最近一次 progress / start 写入时间，用于诊断
ALTER TABLE exam_sessions ADD COLUMN progress_json TEXT;
ALTER TABLE exam_sessions ADD COLUMN last_seen_at TEXT;

-- 热图 90 天聚合需要按日期范围扫 user_answers，加索引
CREATE INDEX IF NOT EXISTS idx_user_answers_user_date
    ON user_answers(user_id, answered_at);
