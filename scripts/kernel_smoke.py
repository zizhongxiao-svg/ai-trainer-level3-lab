"""手动 smoke：启动一个 async kernel，执行 '1+1'，打印 2。
用法：python3.11 scripts/kernel_smoke.py"""
import asyncio
from jupyter_client.manager import AsyncKernelManager


async def main():
    km = AsyncKernelManager(kernel_name="python3")
    await km.start_kernel()
    print(f"[smoke] kernel started id={km.kernel_id}")
    kc = km.client()
    kc.start_channels()
    await kc.wait_for_ready(timeout=30)

    msg_id = kc.execute("print(1+1)")
    got = None
    while True:
        msg = await kc.get_iopub_msg(timeout=10)
        parent = msg.get("parent_header", {}).get("msg_id")
        if parent != msg_id:
            continue
        if msg["msg_type"] == "stream":
            got = msg["content"]["text"]
        if msg["msg_type"] == "status" and msg["content"]["execution_state"] == "idle":
            break
    print(f"[smoke] got stdout={got!r}")
    assert got and got.strip() == "2", f"kernel output wrong: {got!r}"

    kc.stop_channels()
    await km.shutdown_kernel(now=True)
    print("[smoke] ok")


if __name__ == "__main__":
    asyncio.run(main())
