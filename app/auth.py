from __future__ import annotations
"""JWT auth helpers shared across routers."""
import os
import secrets as _secrets
from datetime import datetime, timedelta
from pathlib import Path

from fastapi import Depends, HTTPException
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from jose import JWTError, jwt

from app.db import get_db

def _resolve_secret() -> str:
    env_val = os.environ.get("TRAINER_SECRET")
    if env_val:
        return env_val

    base = Path(
        os.environ.get("TRAINER_DATA_DIR")
        or Path(__file__).resolve().parent.parent / "data"
    )
    base.mkdir(parents=True, exist_ok=True)
    secret_file = base / "secret.key"
    if secret_file.exists():
        try:
            value = secret_file.read_text(encoding="utf-8").strip()
        except OSError:
            value = ""
        if value:
            return value

    new_secret = _secrets.token_urlsafe(48)
    try:
        secret_file.write_text(new_secret, encoding="utf-8")
        try:
            os.chmod(secret_file, 0o600)
        except OSError:
            pass
    except OSError:
        return _secrets.token_urlsafe(48)
    return new_secret


SECRET_KEY = _resolve_secret()
ALGORITHM = "HS256"
ACCESS_TOKEN_EXPIRE_HOURS = 72

security = HTTPBearer(auto_error=False)


def create_token(user_id: int, username: str) -> str:
    expire = datetime.utcnow() + timedelta(hours=ACCESS_TOKEN_EXPIRE_HOURS)
    return jwt.encode({"sub": str(user_id), "username": username, "exp": expire},
                      SECRET_KEY, algorithm=ALGORITHM)


def get_current_user(credentials: HTTPAuthorizationCredentials = Depends(security)):
    if not credentials:
        raise HTTPException(401, "未登录")
    try:
        payload = jwt.decode(credentials.credentials, SECRET_KEY, algorithms=[ALGORITHM])
        user_id = int(payload["sub"])
    except (JWTError, KeyError, ValueError):
        raise HTTPException(401, "token无效或已过期")

    with get_db() as conn:
        user = conn.execute("SELECT * FROM users WHERE id=?", (user_id,)).fetchone()
    if not user:
        raise HTTPException(401, "用户不存在")
    user_dict = dict(user)
    try:
        from app import presence
        presence.touch(user_dict["id"], user_dict.get("display_name") or user_dict.get("username") or "", user_dict.get("username") or "")
    except Exception:
        pass
    return user_dict
