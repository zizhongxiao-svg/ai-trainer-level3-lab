-- Add class_id to users for routing per-class course schedule
ALTER TABLE users ADD COLUMN class_id INTEGER;
