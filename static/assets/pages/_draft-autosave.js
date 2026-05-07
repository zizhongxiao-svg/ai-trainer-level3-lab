// 给操作题详情挂草稿自动保存：5s debounce + 离页 flush。
// 用法：在 page 渲染末尾调用 installAutoSave(host)。
export function installAutoSave(host, delay = 5000) {
  let t = null;
  let flushing = false;

  const flush = async () => {
    if (flushing) return;
    flushing = true;
    try {
      if (typeof host.__bkPushDraft === 'function') await host.__bkPushDraft();
    } finally { flushing = false; }
  };

  const schedule = () => {
    if (t) clearTimeout(t);
    t = setTimeout(flush, delay);
  };

  host.addEventListener('bk-draft-dirty', schedule);

  const onHash = () => { if (t) clearTimeout(t); flush(); };
  window.addEventListener('hashchange', onHash, { once: true });
  window.addEventListener('beforeunload', () => { if (t) clearTimeout(t); flush(); });

  return { flush, cancel: () => t && clearTimeout(t) };
}
