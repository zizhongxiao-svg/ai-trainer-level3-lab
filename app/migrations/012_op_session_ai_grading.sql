-- 实训模式文档题 AI 判卷结果落库（考试模式仍走 ops_exam_grades）。
ALTER TABLE op_sessions ADD COLUMN ai_status TEXT;
ALTER TABLE op_sessions ADD COLUMN ai_rubric_scores_json TEXT;
ALTER TABLE op_sessions ADD COLUMN ai_feedback_json TEXT;
ALTER TABLE op_sessions ADD COLUMN ai_raw_output TEXT;
ALTER TABLE op_sessions ADD COLUMN ai_model TEXT;
ALTER TABLE op_sessions ADD COLUMN ai_reasoning_effort TEXT;
ALTER TABLE op_sessions ADD COLUMN ai_error TEXT;
ALTER TABLE op_sessions ADD COLUMN ai_graded_at TEXT;
