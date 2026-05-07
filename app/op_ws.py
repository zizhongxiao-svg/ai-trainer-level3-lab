from __future__ import annotations
"""WebSocket /ws/op/{session_id} —— kernel 通信。

鉴权：?token=<jwt> (浏览器 WebSocket 不能加 Authorization 头)
消息协议（见 spec §5.3.3）：
  client → server:
    {type:"execute", cells:[{id, code}, ...]}
    {type:"interrupt"}
    {type:"ping"}
  server → client:
    {type:"ready", kernel_id}
    {type:"stream",  cell_id, stream, text}
    {type:"display", cell_id, mime, data}
    {type:"execute_result", cell_id, mime, data}
    {type:"error",   cell_id, ename, evalue, traceback}
    {type:"done",    cell_id, status}
    {type:"batch_done"}
    {type:"interrupted"}
    {type:"pong"}
"""
import json

from fastapi import APIRouter, WebSocket, WebSocketDisconnect, Query

from app.auth import SECRET_KEY, ALGORITHM
from app.db import get_db
from app.kernel_pool import get_pool
from app.ops_unlock import user_needs_unlock

router = APIRouter()


def _auth_from_token(token: str) -> dict | None:
    """解析 token，返回 user row，无效则 None。"""
    try:
        from jose import JWTError, jwt
        payload = jwt.decode(token, SECRET_KEY, algorithms=[ALGORITHM])
        user_id = int(payload["sub"])
    except Exception:
        return None
    with get_db() as conn:
        row = conn.execute("SELECT * FROM users WHERE id=?", (user_id,)).fetchone()
    return dict(row) if row else None


@router.websocket("/ws/op/{session_id}")
async def op_ws(
    websocket: WebSocket,
    session_id: int,
    token: str = Query(default=""),
):
    user = _auth_from_token(token) if token else None
    if not user:
        await websocket.close(code=4401, reason="unauthorized")
        return
    if user_needs_unlock(user):
        await websocket.close(code=4403, reason="ops unlock required")
        return

    with get_db() as conn:
        row = conn.execute(
            "SELECT user_id, operation_id, submitted_at FROM op_sessions WHERE id=?",
            (session_id,),
        ).fetchone()
    if not row:
        await websocket.close(code=4404, reason="session not found")
        return
    if row["user_id"] != user["id"]:
        await websocket.close(code=4403, reason="forbidden")
        return
    if row["submitted_at"]:
        await websocket.close(code=4409, reason="session already submitted")
        return

    await websocket.accept()
    pool = get_pool()
    kernel_id = None
    try:
        kernel_id = await pool.allocate(user_id=user["id"],
                                        operation_id=row["operation_id"])
    except Exception as e:
        await websocket.send_text(json.dumps(
            {"type": "error", "cell_id": None,
             "ename": "KernelAllocFailed", "evalue": str(e), "traceback": []}
        ))
        await websocket.close(code=4500)
        return

    with get_db() as conn:
        conn.execute(
            "UPDATE op_sessions SET kernel_id=?, last_active_at=datetime('now','localtime') WHERE id=?",
            (kernel_id, session_id),
        )

    await websocket.send_text(json.dumps({"type": "ready", "kernel_id": kernel_id}))

    try:
        while True:
            raw = await websocket.receive_text()
            try:
                msg = json.loads(raw)
            except ValueError:
                await websocket.send_text(json.dumps(
                    {"type": "error", "cell_id": None,
                     "ename": "BadJSON", "evalue": raw[:200], "traceback": []}
                ))
                continue

            mtype = msg.get("type")

            if mtype == "execute":
                cells = msg.get("cells") or []
                for cell in cells:
                    cid = cell.get("id") or "unknown"
                    code = cell.get("code") or ""
                    async for ev in pool.execute_stream(kernel_id, cid, code):
                        await websocket.send_text(json.dumps(ev))
                await websocket.send_text(json.dumps({"type": "batch_done"}))

            elif mtype == "interrupt":
                try:
                    await pool.interrupt(kernel_id)
                    await websocket.send_text(json.dumps({"type": "interrupted"}))
                except Exception as e:
                    await websocket.send_text(json.dumps(
                        {"type": "error", "cell_id": None,
                         "ename": "InterruptFailed", "evalue": str(e),
                         "traceback": []}
                    ))

            elif mtype == "ping":
                await websocket.send_text(json.dumps({"type": "pong"}))

            else:
                await websocket.send_text(json.dumps(
                    {"type": "error", "cell_id": None,
                     "ename": "UnknownType", "evalue": str(mtype), "traceback": []}
                ))

    except WebSocketDisconnect:
        pass
    except Exception as e:
        print(f"[op_ws] session={session_id} err: {e}")
        try:
            await websocket.close(code=4500)
        except Exception:
            pass
