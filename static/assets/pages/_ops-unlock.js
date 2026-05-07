import { API } from '../api.js?v=20260429-ops-unlock-2';

export function isOpsUnlockError(err) {
  return !!(err && err.detail && err.detail.code === 'OPS_UNLOCK_REQUIRED');
}

// 用于"状态检查"调用：若服务端返回 OPS_UNLOCK_REQUIRED，则降级为给定空值。
export function ignoreOpsUnlock(fallback) {
  return (e) => {
    if (isOpsUnlockError(e)) return fallback;
    throw e;
  };
}

export function showOpsUnlockModal({ onUnlocked } = {}) {
  const old = document.getElementById('ops-unlock-modal');
  if (old) old.remove();
  const wrap = document.createElement('div');
  wrap.id = 'ops-unlock-modal';
  wrap.className = 'bk-reset-modal-mask';
  wrap.innerHTML = `
    <div class="bk-reset-modal" role="dialog" aria-modal="true" style="max-width:420px">
      <div class="bk-reset-modal-hd">操作题需要解锁码</div>
      <div class="bk-reset-modal-bd" style="line-height:1.7">
        <p style="margin:0 0 8px;color:var(--ink-2)">操作题解锁功能默认关闭。若你的部署启用了该功能，请向课程管理员索取 8 位解锁码。</p>
        <ul style="margin:0 0 6px;padding-left:20px;color:var(--ink-2)">
          <li>管理员可使用项目脚本生成一次性解锁码。</li>
          <li>不要把真实解锁码提交到公开仓库。</li>
        </ul>
        <label class="bk-field-label" for="ops-unlock-code">解锁码</label>
        <input id="ops-unlock-code" class="bk-input" maxlength="12" placeholder="输入 8 位解锁码" style="text-transform:uppercase">
        <div id="ops-unlock-error" style="min-height:20px;margin-top:8px;color:var(--err);font-size:.84rem"></div>
      </div>
      <div class="bk-reset-modal-ft">
        <button class="bk-btn" data-close>暂不解锁</button>
        <button class="bk-btn bk-btn-primary" data-submit>解锁</button>
      </div>
    </div>
  `;
  document.body.appendChild(wrap);
  const input = wrap.querySelector('#ops-unlock-code');
  const error = wrap.querySelector('#ops-unlock-error');
  const submit = wrap.querySelector('[data-submit]');
  const close = () => wrap.remove();
  wrap.querySelector('[data-close]').addEventListener('click', close);
  wrap.addEventListener('click', (e) => { if (e.target === wrap) close(); });
  async function doSubmit() {
    error.textContent = '';
    const code = (input.value || '').trim().toUpperCase();
    if (!code) {
      error.textContent = '请输入解锁码';
      input.focus();
      return;
    }
    submit.disabled = true;
    submit.textContent = '验证中…';
    try {
      await API.opsUnlock(code);
      close();
      if (onUnlocked) await onUnlocked();
    } catch (e) {
      error.textContent = e.message || '解锁失败';
      submit.disabled = false;
      submit.textContent = '解锁';
    }
  }
  submit.addEventListener('click', doSubmit);
  input.addEventListener('keydown', (e) => { if (e.key === 'Enter') doSubmit(); });
  setTimeout(() => input.focus(), 50);
}

export function handleOpsUnlockError(err, onUnlocked) {
  if (!isOpsUnlockError(err)) return false;
  showOpsUnlockModal({ onUnlocked });
  return true;
}
