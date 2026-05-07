#!/usr/bin/env bash
set -euo pipefail

mkdir -p /app/persist

if [ ! -f "$TRAINER_DB_PATH" ] && [ -f /app/data/trainer.db.empty ]; then
  cp /app/data/trainer.db.empty "$TRAINER_DB_PATH"
  echo "Seeded empty database at $TRAINER_DB_PATH"
fi

exec "$@"
