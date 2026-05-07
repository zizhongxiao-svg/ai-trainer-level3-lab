from __future__ import annotations
"""Edition / feature-gate runtime config for trainer."""

import os

EDITION_COMMUNITY = "community"
EDITION_FULL = "full"
EDITION_STANDALONE = "standalone"

ALL_FEATURES = (
    "chat",
    "presence",
    "wechat_gate",
    "classes",
    "leaderboard",
    "feedback",
    "admin",
    "ai_grading",
    "ops_unlock",
)

_COMMUNITY_OFF = {
    "chat",
    "presence",
    "wechat_gate",
    "classes",
    "leaderboard",
    "feedback",
    "admin",
    "ai_grading",
    "ops_unlock",
}


def edition() -> str:
    raw = (os.environ.get("TRAINER_EDITION") or EDITION_COMMUNITY).strip().lower()
    if raw in {EDITION_COMMUNITY, EDITION_STANDALONE}:
        return EDITION_COMMUNITY
    return EDITION_FULL


def is_standalone() -> bool:
    return edition() == EDITION_COMMUNITY


def _disabled_overrides() -> set[str]:
    raw = os.environ.get("TRAINER_DISABLED_FEATURES", "")
    return {item.strip() for item in raw.split(",") if item.strip()}


def is_feature_enabled(name: str) -> bool:
    name = name.lower()
    if name in _disabled_overrides():
        return False
    if is_standalone() and name in _COMMUNITY_OFF:
        return False
    return True


def features_snapshot() -> dict[str, bool]:
    return {name: is_feature_enabled(name) for name in ALL_FEATURES}


def license_owner() -> str:
    return ""


def edition_payload() -> dict:
    return {
        "edition": edition(),
        "license_owner": license_owner(),
        "features": features_snapshot(),
    }


class AIGradingDisabled(RuntimeError):
    """Raised when AI grading is invoked while disabled in this edition."""
