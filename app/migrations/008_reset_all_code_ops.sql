-- 所有代码操作题（q1–q5, q11–q20, q26–q30）按 .ipynb 重建 code_segments，
-- blank 索引/数量/总分均与旧版本不兼容；旧 op_sessions 草稿无法复用。
-- 清掉这 19 道题对应的 op_sessions，让用户从空白进度开始。
DELETE FROM op_sessions
WHERE operation_id IN (1, 2, 3, 4, 5, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 26, 27, 28, 29, 30);
