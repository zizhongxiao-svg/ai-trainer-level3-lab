"""KernelPool —— 每 (user_id, operation_id) 一条 jupyter kernel。

Phase 2 约束：
- `kernel_id` 仅在进程生命周期内有效，不跨重启。
- 调度 `allocate()` 时若同 (user, op) 已有活跃 kernel，直接复用。
- `TRAINER_SANDBOX=firejail` 时用 firejail wrap；默认 off。
"""
from __future__ import annotations

import asyncio
import os
import time
from dataclasses import dataclass, field
from typing import Optional

from jupyter_client.manager import AsyncKernelManager


IDLE_TIMEOUT_SECONDS = int(os.environ.get("TRAINER_KERNEL_IDLE_TIMEOUT", "900"))  # 15 min


@dataclass
class KernelEntry:
    kernel_id: str
    user_id: int
    operation_id: int
    manager: AsyncKernelManager
    client: object = None
    last_active: float = field(default_factory=time.time)
    exec_lock: asyncio.Lock = field(default_factory=asyncio.Lock)


class KernelPool:
    """进程内单例。维护 (user_id, operation_id) → KernelEntry。"""

    def __init__(self):
        self._kernels: dict[str, KernelEntry] = {}
        self._by_user_op: dict[tuple[int, int], str] = {}
        self._alloc_lock = asyncio.Lock()

    def _kernel_cmd(self) -> Optional[list[str]]:
        """根据 TRAINER_SANDBOX 返回启动命令前缀；None = 用默认。"""
        mode = os.environ.get("TRAINER_SANDBOX", "off").lower()
        if mode != "firejail":
            return None
        default_profile = os.path.abspath(
            os.path.join(os.path.dirname(__file__), "..", "infra", "firejail", "kernel.profile")
        )
        profile = os.environ.get("TRAINER_FIREJAIL_PROFILE", default_profile)
        return ["firejail", f"--profile={profile}", "--quiet",
                "python", "-m", "ipykernel_launcher", "-f", "{connection_file}"]

    @staticmethod
    def _op_workspace(operation_id: int) -> str:
        """返回 kernel 启动的 cwd：有 data/questions/<id>/ 则用，否则用空目录。"""
        import pathlib
        root = pathlib.Path(__file__).resolve().parent.parent  # trainer/
        per_op = root / "data" / "questions" / str(operation_id)
        if per_op.is_dir():
            return str(per_op)
        empty = root / "data" / "questions" / "_empty"
        empty.mkdir(parents=True, exist_ok=True)
        return str(empty)

    async def allocate(self, user_id: int, operation_id: int) -> str:
        """返回 kernel_id。同 (user, op) 已有则复用。"""
        key = (user_id, operation_id)
        async with self._alloc_lock:
            if key in self._by_user_op:
                kid = self._by_user_op[key]
                if kid in self._kernels:
                    self._kernels[kid].last_active = time.time()
                    return kid
                del self._by_user_op[key]

            km_kwargs = {"kernel_name": "python3"}
            cmd = self._kernel_cmd()
            if cmd:
                km_kwargs["kernel_cmd"] = cmd

            km = AsyncKernelManager(**km_kwargs)
            await km.start_kernel(cwd=self._op_workspace(operation_id))
            kc = km.client()
            kc.start_channels()
            await kc.wait_for_ready(timeout=30)

            entry = KernelEntry(
                kernel_id=km.kernel_id,
                user_id=user_id,
                operation_id=operation_id,
                manager=km,
                client=kc,
            )
            self._kernels[km.kernel_id] = entry
            self._by_user_op[key] = km.kernel_id
            return km.kernel_id

    async def shutdown(self, kernel_id: str) -> None:
        entry = self._kernels.pop(kernel_id, None)
        if not entry:
            return
        self._by_user_op.pop((entry.user_id, entry.operation_id), None)
        try:
            if entry.client:
                entry.client.stop_channels()
            await entry.manager.shutdown_kernel(now=True)
        except Exception as e:
            print(f"[kernel_pool] shutdown {kernel_id} err: {e}")

    async def shutdown_all(self) -> None:
        for kid in list(self._kernels):
            await self.shutdown(kid)

    def get(self, kernel_id: str) -> Optional[KernelEntry]:
        entry = self._kernels.get(kernel_id)
        if entry:
            entry.last_active = time.time()
        return entry

    async def execute_stream(self, kernel_id: str, cell_id: str, code: str):
        """按 cell_id 执行一段 code，异步生成事件流。

        Yields dicts with keys {type, cell_id, ...}:
          - {type:"stream", cell_id, stream:"stdout"|"stderr", text}
          - {type:"display", cell_id, mime, data}
          - {type:"execute_result", cell_id, mime, data}
          - {type:"error", cell_id, ename, evalue, traceback}
          - {type:"done", cell_id, status:"ok"|"error"}
        """
        entry = self._kernels.get(kernel_id)
        if not entry:
            raise KeyError(f"unknown kernel_id={kernel_id}")
        entry.last_active = time.time()
        kc = entry.client

        async with entry.exec_lock:
            msg_id = kc.execute(code)
            status = "ok"
            while True:
                try:
                    msg = await kc.get_iopub_msg(timeout=60)
                except Exception as e:
                    yield {"type": "error", "cell_id": cell_id,
                           "ename": "KernelTimeout", "evalue": str(e),
                           "traceback": []}
                    try:
                        await entry.manager.interrupt_kernel()
                    except Exception as ie:
                        print(f"[kernel_pool] interrupt failed: {ie}")
                    drain_deadline = time.time() + 5
                    drained_idle = False
                    while time.time() < drain_deadline:
                        try:
                            dm = await kc.get_iopub_msg(timeout=1)
                        except Exception:
                            break
                        if dm.get("msg_type") == "status" \
                                and dm.get("content", {}).get("execution_state") == "idle" \
                                and (dm.get("parent_header") or {}).get("msg_id") == msg_id:
                            drained_idle = True
                            break
                    if not drained_idle:
                        await get_pool().shutdown(kernel_id)
                    status = "error"
                    break

                parent = (msg.get("parent_header") or {}).get("msg_id")
                if parent != msg_id:
                    continue

                mtype = msg["msg_type"]
                content = msg["content"]

                if mtype == "stream":
                    yield {"type": "stream", "cell_id": cell_id,
                           "stream": content.get("name", "stdout"),
                           "text": content.get("text", "")}
                elif mtype in ("display_data", "update_display_data"):
                    data = content.get("data", {})
                    mime = "text/plain"
                    if "image/png" in data:
                        mime = "image/png"
                    elif "text/html" in data:
                        mime = "text/html"
                    yield {"type": "display", "cell_id": cell_id,
                           "mime": mime, "data": data.get(mime)}
                elif mtype == "execute_result":
                    data = content.get("data", {})
                    mime = "text/plain"
                    if "image/png" in data:
                        mime = "image/png"
                    yield {"type": "execute_result", "cell_id": cell_id,
                           "mime": mime, "data": data.get(mime)}
                elif mtype == "error":
                    status = "error"
                    yield {"type": "error", "cell_id": cell_id,
                           "ename": content.get("ename", ""),
                           "evalue": content.get("evalue", ""),
                           "traceback": content.get("traceback", [])}
                elif mtype == "status" and content.get("execution_state") == "idle":
                    break

            yield {"type": "done", "cell_id": cell_id, "status": status}

    async def interrupt(self, kernel_id: str) -> None:
        entry = self._kernels.get(kernel_id)
        if not entry:
            raise KeyError(f"unknown kernel_id={kernel_id}")
        await entry.manager.interrupt_kernel()

    async def reap(self, idle_seconds: int = IDLE_TIMEOUT_SECONDS) -> list[str]:
        """回收空闲超时的 kernel；返回被回收的 kernel_id 列表。"""
        now = time.time()
        stale = [kid for kid, e in self._kernels.items()
                 if (now - e.last_active) > idle_seconds]
        for kid in stale:
            await self.shutdown(kid)
        return stale

    async def run_reaper(self, interval: int = 60):
        """后台循环：每 interval 秒跑一次 reap。"""
        while True:
            try:
                await asyncio.sleep(interval)
                reaped = await self.reap()
                if reaped:
                    print(f"[kernel_pool] reaped {len(reaped)} idle kernels: {reaped}")
            except asyncio.CancelledError:
                raise
            except Exception as e:
                print(f"[kernel_pool] reaper err: {e}")


# 进程级单例（由 FastAPI lifespan 初始化 / 关闭）
POOL: Optional[KernelPool] = None


def get_pool() -> KernelPool:
    global POOL
    if POOL is None:
        POOL = KernelPool()
    return POOL
