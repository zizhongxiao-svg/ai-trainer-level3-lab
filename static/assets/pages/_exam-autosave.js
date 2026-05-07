// Exam draft autosave: 15s debounce + beforeunload + hashchange flush.
// Page must expose host.__bkPushDraft = async () => {...}; events 'bk-draft-dirty'.
export function installExamAutoSave(host, delay = 15000) {
  let t = null;
  let busy = false;

  const flush = async () => {
    if (busy) return;
    busy = true;
    try { if (typeof host.__bkPushDraft === 'function') await host.__bkPushDraft(); }
    finally { busy = false; }
  };

  const schedule = () => {
    if (t) clearTimeout(t);
    t = setTimeout(flush, delay);
  };

  const onDirty = () => schedule();
  const onHash = () => { if (t) clearTimeout(t); flush(); };
  const onUnload = () => { if (t) clearTimeout(t); flush(); };

  host.addEventListener('bk-draft-dirty', onDirty);
  window.addEventListener('hashchange', onHash, { once: true });
  window.addEventListener('beforeunload', onUnload);

  return {
    flush,
    cancel: () => {
      if (t) clearTimeout(t); t = null;
      host.removeEventListener('bk-draft-dirty', onDirty);
      window.removeEventListener('beforeunload', onUnload);
    },
  };
}
