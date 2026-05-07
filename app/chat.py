from __future__ import annotations
"""Chat broadcast: single-channel, all-users, real-time + REST history."""
import asyncio
import json
import time
from collections import deque
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query, WebSocket, WebSocketDisconnect
from pydantic import BaseModel, Field
from starlette.websockets import WebSocketState

from app.auth import ALGORITHM, SECRET_KEY, get_current_user
from app.db import get_db

router = APIRouter(prefix="/api/chat", tags=["chat"])
ws_router = APIRouter()  # no prefix — WS lives at /ws/chat

# ── 进程内连接池 ──────────────────────────────────────────────────────
_connections: set[WebSocket] = set()
_conn_lock = asyncio.Lock()

# ── 进程内限流：每用户 5 秒内最多 30 条 ──────────────────────────────
_RATE_WINDOW_SECONDS = 5.0
_RATE_MAX = 30
_user_send_times: dict[int, deque] = {}
_rate_lock = asyncio.Lock()


async def _rate_check(user_id: int) -> bool:
    """True 表示放行，False 表示超限。"""
    now = time.monotonic()
    async with _rate_lock:
        dq = _user_send_times.setdefault(user_id, deque())
        cutoff = now - _RATE_WINDOW_SECONDS
        while dq and dq[0] < cutoff:
            dq.popleft()
        if len(dq) >= _RATE_MAX:
            return False
        dq.append(now)
        return True


async def _broadcast(payload: dict):
    text = json.dumps(payload, ensure_ascii=False)
    async with _conn_lock:
        targets = list(_connections)
    dead = []
    for ws in targets:
        try:
            if ws.client_state != WebSocketState.CONNECTED:
                dead.append(ws)
                continue
            await ws.send_text(text)
        except Exception:
            dead.append(ws)
    if dead:
        async with _conn_lock:
            for ws in dead:
                _connections.discard(ws)


def _auth_from_token(token: str) -> dict | None:
    try:
        from jose import jwt
        payload = jwt.decode(token, SECRET_KEY, algorithms=[ALGORITHM])
        user_id = int(payload["sub"])
    except Exception:
        return None
    with get_db() as conn:
        row = conn.execute("SELECT * FROM users WHERE id=?", (user_id,)).fetchone()
    return dict(row) if row else None


def _insert_message(user_id: int, content: str) -> dict:
    with get_db() as conn:
        cur = conn.execute(
            "INSERT INTO chat_messages (user_id, content) VALUES (?, ?)",
            (user_id, content),
        )
        mid = cur.lastrowid
        row = conn.execute(
            """
            SELECT m.id, m.user_id, m.content, m.created_at,
                   u.display_name, u.username
            FROM chat_messages m JOIN users u ON u.id = m.user_id
            WHERE m.id=?
            """,
            (mid,),
        ).fetchone()
        conn.commit()
    return {
        "type": "msg",
        "id": row["id"],
        "user_id": row["user_id"],
        "name": row["display_name"] or row["username"],
        "content": row["content"],
        "created_at": row["created_at"],
    }


def _row_to_msg(r) -> dict:
    if r["deleted_at"]:
        return {
            "id": r["id"],
            "user_id": r["user_id"],
            "name": r["display_name"] or r["username"],
            "content": "",
            "created_at": r["created_at"],
            "deleted": True,
        }
    return {
        "id": r["id"],
        "user_id": r["user_id"],
        "name": r["display_name"] or r["username"],
        "content": r["content"],
        "created_at": r["created_at"],
        "deleted": False,
    }


@router.get("/messages")
def list_messages(
    before_id: Optional[int] = Query(default=None, ge=1),
    limit: int = Query(default=50, ge=1, le=100),
    user: dict = Depends(get_current_user),
):
    where = "WHERE m.deleted_at IS NULL"
    args: list = []
    if before_id:
        where += " AND m.id < ?"
        args.append(before_id)
    sql = f"""
        SELECT m.id, m.user_id, m.content, m.created_at, m.deleted_at,
               u.display_name, u.username
        FROM chat_messages m
        JOIN users u ON u.id = m.user_id
        {where}
        ORDER BY m.id DESC
        LIMIT ?
    """
    args.append(limit + 1)
    with get_db() as conn:
        rows = conn.execute(sql, args).fetchall()
    has_more = len(rows) > limit
    rows = rows[:limit]
    # 返回升序，前端直接 append
    msgs = [_row_to_msg(r) for r in reversed(rows)]
    return {"messages": msgs, "has_more": has_more}


@router.delete("/messages/{mid}")
async def delete_message(mid: int, user: dict = Depends(get_current_user)):
    with get_db() as conn:
        row = conn.execute(
            "SELECT user_id, deleted_at FROM chat_messages WHERE id=?", (mid,)
        ).fetchone()
        if not row:
            raise HTTPException(status_code=404, detail="message not found")
        if row["deleted_at"]:
            return {"ok": True}
        if row["user_id"] != user["id"] and not user.get("is_admin"):
            raise HTTPException(status_code=403, detail="forbidden")
        conn.execute(
            "UPDATE chat_messages SET deleted_at=datetime('now','localtime'), deleted_by=? WHERE id=?",
            (user["id"], mid),
        )
        conn.commit()
    await _broadcast({"type": "deleted", "id": mid})
    return {"ok": True, "id": mid}


class PinIn(BaseModel):
    content: str = Field(..., min_length=1, max_length=500)


def _require_admin(user: dict):
    if not user.get("is_admin"):
        raise HTTPException(status_code=403, detail="admin only")


@router.get("/pin")
def get_pin(user: dict = Depends(get_current_user)):
    with get_db() as conn:
        row = conn.execute(
            """
            SELECT p.id, p.content, p.created_by, p.created_at,
                   u.display_name, u.username
            FROM chat_pins p
            JOIN users u ON u.id = p.created_by
            WHERE p.active = 1
            ORDER BY p.id DESC
            LIMIT 1
            """
        ).fetchone()
    if not row:
        return {"pin": None}
    return {
        "pin": {
            "id": row["id"],
            "content": row["content"],
            "created_by_name": row["display_name"] or row["username"],
            "created_at": row["created_at"],
        }
    }


@router.put("/pin")
async def set_pin(body: PinIn, user: dict = Depends(get_current_user)):
    _require_admin(user)
    content = body.content.strip()
    if not content:
        raise HTTPException(status_code=400, detail="empty content")
    with get_db() as conn:
        conn.execute("UPDATE chat_pins SET active=0 WHERE active=1")
        conn.execute(
            "INSERT INTO chat_pins (content, created_by) VALUES (?, ?)",
            (content, user["id"]),
        )
        conn.commit()
    await _broadcast({
        "type": "pin",
        "content": content,
        "created_by_name": user.get("display_name") or user["username"],
    })
    return {"ok": True}


@router.delete("/pin")
async def clear_pin(user: dict = Depends(get_current_user)):
    _require_admin(user)
    with get_db() as conn:
        conn.execute("UPDATE chat_pins SET active=0 WHERE active=1")
        conn.commit()
    await _broadcast({"type": "pin", "content": None})
    return {"ok": True}


@ws_router.websocket("/ws/chat")
async def chat_ws(websocket: WebSocket, token: str = Query(default="")):
    user = _auth_from_token(token) if token else None
    if not user:
        await websocket.close(code=4401, reason="unauthorized")
        return
    await websocket.accept()
    async with _conn_lock:
        _connections.add(websocket)
    try:
        while True:
            raw = await websocket.receive_text()
            try:
                msg = json.loads(raw)
            except ValueError:
                await websocket.send_text(
                    json.dumps({"type": "error", "message": "bad json"})
                )
                continue
            mtype = msg.get("type")
            if mtype == "ping":
                await websocket.send_text(json.dumps({"type": "pong"}))
                continue
            if mtype == "send":
                content = (msg.get("content") or "").strip()
                if not content:
                    await websocket.send_text(
                        json.dumps({"type": "error", "message": "empty"})
                    )
                    continue
                if len(content) > 1000:
                    await websocket.send_text(
                        json.dumps({"type": "error", "message": "too long (max 1000)"})
                    )
                    continue
                if not await _rate_check(user["id"]):
                    await websocket.send_text(
                        json.dumps({"type": "error", "message": "发太快了，缓一缓"})
                    )
                    continue
                try:
                    from app import presence
                    presence.touch_activity(
                        user["id"],
                        user.get("display_name") or user.get("username") or "",
                        user.get("username") or "",
                    )
                except Exception:
                    pass
                payload = _insert_message(user["id"], content)
                await _broadcast(payload)
                continue
            await websocket.send_text(
                json.dumps({"type": "error", "message": f"unknown type: {mtype}"})
            )
    except WebSocketDisconnect:
        pass
    finally:
        async with _conn_lock:
            _connections.discard(websocket)
