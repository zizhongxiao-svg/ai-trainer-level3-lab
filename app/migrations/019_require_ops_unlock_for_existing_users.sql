UPDATE users
SET ops_unlock_required = 1
WHERE ops_unlocked_at IS NULL
  AND COALESCE(ops_unlock_required, 0) = 0;
