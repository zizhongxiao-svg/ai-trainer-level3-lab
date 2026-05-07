"""Generate an empty trainer.db for shipment."""
from __future__ import annotations

import os
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

target = ROOT / "data" / "trainer.db.empty"
target.parent.mkdir(parents=True, exist_ok=True)
if target.exists():
    target.unlink()

os.environ["TRAINER_DB_PATH"] = str(target)

from app.db import run_migrations  # noqa: E402

run_migrations()
print(f"Empty DB created at {target}")
