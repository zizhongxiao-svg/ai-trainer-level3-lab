#!/usr/bin/env python3
"""Legacy helper for generating operation unlock codes.

Operation unlock now uses a fixed reusable code in app.ops_unlock.
"""

from __future__ import annotations

import argparse
import secrets
import string
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.db import get_db

ALPHABET = "".join(ch for ch in string.ascii_uppercase + string.digits if ch not in "0O1I")


def make_code() -> str:
    return "".join(secrets.choice(ALPHABET) for _ in range(8))


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--count", type=int, default=400)
    ap.add_argument("--batch", default="ops-20260429")
    ap.add_argument("--output", type=Path)
    args = ap.parse_args()

    codes: list[str] = []
    with get_db() as conn:
        existing = {r["code"] for r in conn.execute("SELECT code FROM ops_unlock_codes").fetchall()}
        while len(codes) < args.count:
            code = make_code()
            if code in existing or code in codes:
                continue
            conn.execute(
                "INSERT INTO ops_unlock_codes (code, batch) VALUES (?, ?)",
                (code, args.batch),
            )
            codes.append(code)
    if args.output:
        args.output.write_text("\n".join(codes) + "\n", encoding="utf-8")
    else:
        print("\n".join(codes))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
