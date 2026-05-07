from __future__ import annotations
"""Database connection and migration runner."""
import os
import re
import sqlite3
from contextlib import contextmanager
from pathlib import Path

BASE_DIR = Path(__file__).parent.parent
DEFAULT_DB = BASE_DIR / "trainer.db"
MIGRATIONS_DIR = Path(__file__).parent / "migrations"


def db_path() -> Path:
    return Path(os.environ.get("TRAINER_DB_PATH", str(DEFAULT_DB)))


@contextmanager
def get_db():
    conn = sqlite3.connect(str(db_path()))
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA journal_mode=WAL")
    conn.execute("PRAGMA foreign_keys=ON")
    try:
        yield conn
        conn.commit()
    finally:
        conn.close()


def run_migrations():
    """Apply all pending .sql files under migrations/ in numeric order."""
    with get_db() as conn:
        conn.execute("""
            CREATE TABLE IF NOT EXISTS schema_version (
                version INTEGER PRIMARY KEY,
                applied_at TEXT DEFAULT (datetime('now'))
            )
        """)
        applied = {r[0] for r in conn.execute("SELECT version FROM schema_version").fetchall()}
        files = sorted(MIGRATIONS_DIR.glob("*.sql"))
        for f in files:
            m = re.match(r"(\d+)_", f.name)
            if not m:
                continue
            ver = int(m.group(1))
            if ver in applied:
                continue
            sql = f.read_text()
            conn.executescript(sql)
            conn.execute("INSERT INTO schema_version (version) VALUES (?)", (ver,))
            conn.commit()
            print(f"[db] applied migration {f.name}")
