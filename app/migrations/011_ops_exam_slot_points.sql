-- 实操考试每个槽位的"蓝本固定分"，使总分稳定为 100。
-- 之前 _aggregate_scores 里用每道题自身的 blank/rubric points 求和，
-- 不同题目之间不一致 → 总分会在 101/115 这样的值之间漂移。
-- 现在 start_exam 时把 subunit.points 写入 slot_points_json（与 operation_ids 平行的 JSON 数组），
-- 旧数据该列为 NULL，走 fallback 逻辑（沿用历史 total_score）。

ALTER TABLE ops_exam_sessions ADD COLUMN slot_points_json TEXT;
