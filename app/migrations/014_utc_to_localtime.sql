-- Convert all existing UTC timestamps to Asia/Shanghai local time (UTC+8).
-- SQLite datetime('now') returns UTC; we switch to datetime('now','localtime').

UPDATE users SET created_at = datetime(created_at, '+8 hours')
  WHERE created_at IS NOT NULL AND created_at < datetime('now');

UPDATE user_answers SET answered_at = datetime(answered_at, '+8 hours')
  WHERE answered_at IS NOT NULL AND answered_at < datetime('now');

UPDATE exam_sessions SET
  start_time = datetime(start_time, '+8 hours'),
  end_time   = CASE WHEN end_time IS NOT NULL THEN datetime(end_time, '+8 hours') ELSE NULL END,
  last_seen_at = CASE WHEN last_seen_at IS NOT NULL THEN datetime(last_seen_at, '+8 hours') ELSE NULL END
  WHERE start_time IS NOT NULL;

UPDATE op_sessions SET
  started_at     = datetime(started_at, '+8 hours'),
  last_active_at = CASE WHEN last_active_at IS NOT NULL THEN datetime(last_active_at, '+8 hours') ELSE NULL END,
  submitted_at   = CASE WHEN submitted_at IS NOT NULL THEN datetime(submitted_at, '+8 hours') ELSE NULL END,
  ai_graded_at   = CASE WHEN ai_graded_at IS NOT NULL THEN datetime(ai_graded_at, '+8 hours') ELSE NULL END
  WHERE started_at IS NOT NULL;

UPDATE ops_exam_sessions SET
  start_time           = datetime(start_time, '+8 hours'),
  end_time             = CASE WHEN end_time IS NOT NULL THEN datetime(end_time, '+8 hours') ELSE NULL END,
  submitted_at         = CASE WHEN submitted_at IS NOT NULL THEN datetime(submitted_at, '+8 hours') ELSE NULL END,
  grading_started_at   = CASE WHEN grading_started_at IS NOT NULL THEN datetime(grading_started_at, '+8 hours') ELSE NULL END,
  grading_completed_at = CASE WHEN grading_completed_at IS NOT NULL THEN datetime(grading_completed_at, '+8 hours') ELSE NULL END
  WHERE start_time IS NOT NULL;

UPDATE feedbacks SET created_at = datetime(created_at, '+8 hours')
  WHERE created_at IS NOT NULL AND created_at < datetime('now');

UPDATE ops_exam_grades SET
  created_at = datetime(created_at, '+8 hours'),
  updated_at = datetime(updated_at, '+8 hours')
  WHERE created_at IS NOT NULL;

UPDATE chat_messages SET
  created_at = datetime(created_at, '+8 hours'),
  deleted_at = CASE WHEN deleted_at IS NOT NULL THEN datetime(deleted_at, '+8 hours') ELSE NULL END
  WHERE created_at IS NOT NULL;

UPDATE chat_pins SET created_at = datetime(created_at, '+8 hours')
  WHERE created_at IS NOT NULL;

UPDATE question_explanations SET updated_at = datetime(updated_at, '+8 hours')
  WHERE updated_at IS NOT NULL;
