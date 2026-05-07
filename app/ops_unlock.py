from __future__ import annotations
"""Shared unlock code for costly operation training features."""

import re
import os

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

from app.auth import get_current_user
from app.db import get_db

router = APIRouter(prefix="/api/ops-unlock", tags=["ops-unlock"])

_CODE_RE = re.compile(r"^[A-Z0-9]{8}$")


def is_enabled() -> bool:
    from app import edition
    return edition.is_feature_enabled("ops_unlock")


def mark_new_user_requires_unlock(user_id: int) -> None:
    if not is_enabled():
        return
    with get_db() as db:
        db.execute("UPDATE users SET ops_unlock_required=1 WHERE id=?", (user_id,))


def _row_get(row, key: str, default=None):
    try:
        return row[key]
    except (KeyError, IndexError):
        return default


def user_needs_unlock(user: dict) -> bool:
    if not is_enabled():
        return False
    return bool(_row_get(user, "ops_unlock_required", 0)) and not bool(
        _row_get(user, "ops_unlocked_at", None)
    )


def require_ops_unlocked(user: dict) -> None:
    if not user_needs_unlock(user):
        return
    raise HTTPException(
        status_code=403,
        detail={
            "code": "OPS_UNLOCK_REQUIRED",
            "message": "操作题训练需要解锁码",
            "title": "操作题需要解锁码",
            "description": "操作题解锁功能在 Community Edition 中默认关闭。若你启用该功能，请通过自己的后台生成并分发 8 位解锁码。",
        },
    )


def _normalize_code(code: str) -> str:
    return re.sub(r"\s+", "", code or "").upper()


class UnlockReq(BaseModel):
    code: str


@router.get("/status")
def unlock_status(user=Depends(get_current_user)):
    return {
        "enabled": is_enabled(),
        "required": user_needs_unlock(user),
        "unlocked": not user_needs_unlock(user),
    }


@router.post("")
def unlock_ops(req: UnlockReq, user=Depends(get_current_user)):
    code = _normalize_code(req.code)
    if not _CODE_RE.match(code):
        raise HTTPException(400, "解锁码应为 8 位字母或数字")
    with get_db() as db:
        if not user_needs_unlock(user):
            return {"ok": True, "unlocked": True}
        fixed_code = _normalize_code(os.environ.get("TRAINER_OPS_UNLOCK_CODE", ""))
        if not fixed_code or code != fixed_code:
            raise HTTPException(400, "解锁码无效，请确认后重试")
        db.execute(
            """
            UPDATE users
            SET ops_unlocked_at=datetime('now','localtime')
            WHERE id=?
            """,
            (user["id"],),
        )
    return {"ok": True, "unlocked": True}
