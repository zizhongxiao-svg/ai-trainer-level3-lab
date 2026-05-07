from __future__ import annotations
"""In-memory online-user presence tracker.

Any authenticated request calls `touch()` to refresh that user's online
last-seen timestamp. Explicit activity reports call `touch_activity()` so the
UI can distinguish an open browser tab from a user who recently interacted with
the system.

Non-persistent by design — a process restart clears the tracker, which is
acceptable given clients will re-touch on their next request within seconds.
"""

import threading
import time
from typing import Dict

from fastapi import APIRouter, Depends

from app.auth import get_current_user

WINDOW_SECONDS = 180  # 3 minutes

_lock = threading.Lock()
_last_seen: Dict[int, dict] = {}


def touch(user_id: int, display_name: str, username: str) -> None:
    with _lock:
        current = _last_seen.get(user_id, {})
        _last_seen[user_id] = {
            **current,
            "display_name": display_name,
            "username": username,
            "ts": time.time(),
        }


def touch_activity(user_id: int, display_name: str, username: str) -> None:
    now = time.time()
    with _lock:
        current = _last_seen.get(user_id, {})
        _last_seen[user_id] = {
            **current,
            "display_name": display_name,
            "username": username,
            "ts": now,
            "active_ts": now,
        }


def snapshot(window: int = WINDOW_SECONDS) -> list[dict]:
    cutoff = time.time() - window
    with _lock:
        items = [(uid, v) for uid, v in _last_seen.items() if v["ts"] >= cutoff]
        stale = [uid for uid, v in _last_seen.items() if v["ts"] < cutoff]
        for uid in stale:
            del _last_seen[uid]
    items.sort(key=lambda kv: kv[1]["ts"], reverse=True)
    return [
        {
            "display_name": v["display_name"],
            "username": v["username"],
            "seconds_ago": int(time.time() - v["ts"]),
        }
        for _, v in items
    ]


def active_snapshot(window: int = WINDOW_SECONDS) -> list[dict]:
    cutoff = time.time() - window
    now = time.time()
    with _lock:
        items = [
            (uid, v) for uid, v in _last_seen.items()
            if v.get("active_ts", 0) >= cutoff
        ]
    items.sort(key=lambda kv: kv[1].get("active_ts", 0), reverse=True)
    return [
        {
            "display_name": v["display_name"],
            "username": v["username"],
            "seconds_ago": int(now - v.get("active_ts", 0)),
        }
        for _, v in items
    ]


router = APIRouter()


@router.get("/api/presence/online")
def get_online(user=Depends(get_current_user)):
    users = snapshot()
    payload: dict = {"count": len(users), "window_seconds": WINDOW_SECONDS}
    if user.get("is_admin"):
        payload["users"] = users
        active_users = active_snapshot()
        payload["active_count"] = len(active_users)
        payload["active_users"] = active_users
    return payload


@router.post("/api/presence/activity")
def post_activity(user=Depends(get_current_user)):
    touch_activity(
        user["id"],
        user.get("display_name") or user.get("username") or "",
        user.get("username") or "",
    )
    return {"ok": True}
