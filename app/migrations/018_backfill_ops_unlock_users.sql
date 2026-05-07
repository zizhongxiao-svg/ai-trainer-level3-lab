UPDATE users
SET ops_unlocked_at = COALESCE(
    (
        SELECT MAX(c.used_at)
        FROM ops_unlock_codes c
        WHERE c.used_by = users.id
    ),
    datetime('now','localtime')
)
WHERE ops_unlocked_at IS NULL
  AND id IN (
      SELECT used_by
      FROM ops_unlock_codes
      WHERE used_by IS NOT NULL
  );
