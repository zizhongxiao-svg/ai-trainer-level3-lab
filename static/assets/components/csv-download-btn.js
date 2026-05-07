// Triggers a download via fetch+blob so we can attach the auth header.
import { auth } from '../api.js';

export function makeCsvDownloadButton(label, url, filename) {
  const btn = document.createElement('button');
  btn.className = 'bk-btn';
  btn.textContent = label;
  btn.addEventListener('click', async () => {
    btn.disabled = true;
    const original = btn.textContent;
    btn.textContent = '导出中…';
    try {
      const headers = {};
      if (auth.token) headers['Authorization'] = 'Bearer ' + auth.token;
      const resp = await fetch(url, { headers });
      if (!resp.ok) {
        const msg = await resp.text().catch(() => `${resp.status}`);
        throw new Error(msg || `HTTP ${resp.status}`);
      }
      const blob = await resp.blob();
      const objUrl = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = objUrl; a.download = filename;
      document.body.appendChild(a); a.click(); a.remove();
      URL.revokeObjectURL(objUrl);
    } catch (e) {
      alert('导出失败：' + e.message);
    } finally {
      btn.disabled = false;
      btn.textContent = original;
    }
  });
  return btn;
}
