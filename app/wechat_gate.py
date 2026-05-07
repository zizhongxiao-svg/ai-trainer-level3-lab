from __future__ import annotations
"""Disabled WeChat follow gate for the public Community Edition."""

from fastapi import APIRouter, HTTPException

router = APIRouter(prefix="/api/wechat-gate", tags=["wechat-gate"])


def is_enabled() -> bool:
    return False


def user_requires_wechat_gate(user_row) -> bool:
    return False


def user_has_subscribed_link(user_id: int) -> bool:
    return True


def mark_user_requires_gate(user_id: int) -> None:
    return None


def build_gate_response(user_id: int) -> dict:
    raise HTTPException(404, "WeChat gate is not available in Community Edition")
