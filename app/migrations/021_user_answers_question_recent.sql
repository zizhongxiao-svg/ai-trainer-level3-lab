-- Speed up /api/questions per-user latest-answer and attempt aggregation.
CREATE INDEX IF NOT EXISTS idx_user_answers_user_question_recent
    ON user_answers(user_id, question_id, answered_at DESC, id DESC);
