// WebSocket 客户端封装。对 /ws/op/{session_id} 一条连接负责：
//   - 鉴权 (?token=)
//   - JSON 编解码
//   - 事件分发（按消息 type）
//   - 自动断线提示（不自动重连，让上层决定）
import { auth, BASE } from './api.js';

export function openOpWS(sessionId, handlers = {}) {
  const token = encodeURIComponent(auth.token || '');
  const scheme = location.protocol === 'https:' ? 'wss' : 'ws';
  const url = `${scheme}://${location.host}${BASE}/ws/op/${sessionId}?token=${token}`;
  const ws = new WebSocket(url);

  ws.addEventListener('message', (ev) => {
    let msg;
    try { msg = JSON.parse(ev.data); } catch { return; }
    const h = handlers[msg.type];
    if (h) h(msg);
    if (handlers.any) handlers.any(msg);
  });
  ws.addEventListener('open', () => handlers.open && handlers.open());
  ws.addEventListener('close', (ev) => handlers.close && handlers.close(ev));
  ws.addEventListener('error', (ev) => handlers.error && handlers.error(ev));

  return {
    raw: ws,
    send(obj) {
      if (ws.readyState !== WebSocket.OPEN) {
        throw new Error('WS 未就绪');
      }
      ws.send(JSON.stringify(obj));
    },
    execute(cells) {
      this.send({ type: 'execute', cells });
    },
    interrupt() { this.send({ type: 'interrupt' }); },
    close() {
      try { ws.close(1000); } catch (_) {}
    },
    get readyState() { return ws.readyState; },
  };
}
