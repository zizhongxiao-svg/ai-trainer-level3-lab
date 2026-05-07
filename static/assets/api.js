// Thin fetch wrapper with token handling.
// Auto-detect base path so the app works behind a reverse-proxy sub-path.
const _self = new URL(import.meta.url).pathname;
export const BASE = _self.replace(/\/static\/assets\/api\.js(\?.*)?$/, '');

const TOKEN_KEY = 't_tok';
const USER_KEY = 't_usr';

export const auth = {
  get token() { return localStorage.getItem(TOKEN_KEY) || ''; },
  set token(v) { v ? localStorage.setItem(TOKEN_KEY, v) : localStorage.removeItem(TOKEN_KEY); },
  get user() { try { return JSON.parse(localStorage.getItem(USER_KEY) || '{}'); } catch { return {}; } },
  set user(v) { localStorage.setItem(USER_KEY, JSON.stringify(v || {})); },
  clear() { localStorage.removeItem(TOKEN_KEY); localStorage.removeItem(USER_KEY); },
};

export async function api(path, opts = {}) {
  const headers = { 'Content-Type': 'application/json', ...(opts.headers || {}) };
  if (auth.token) headers['Authorization'] = 'Bearer ' + auth.token;
  const resp = await fetch(BASE + path, { ...opts, headers });
  if (resp.status === 401) {
    auth.clear();
    window.location.hash = '#/login';
    throw new Error('未登录');
  }
  const data = await resp.json().catch(() => ({}));
  if (!resp.ok) {
    const detail = data.detail;
    const msg = detail && typeof detail === 'object'
      ? (detail.message || `请求失败 (${resp.status})`)
      : (detail || `请求失败 (${resp.status})`);
    const err = new Error(msg);
    err.status = resp.status;
    err.detail = detail;
    throw err;
  }
  return data;
}

export async function apiBlob(path, opts = {}) {
  const headers = { ...(opts.headers || {}) };
  if (auth.token) headers['Authorization'] = 'Bearer ' + auth.token;
  const resp = await fetch(BASE + path, { ...opts, headers });
  if (resp.status === 401) {
    auth.clear();
    window.location.hash = '#/login';
    throw new Error('未登录');
  }
  if (!resp.ok) {
    const data = await resp.json().catch(() => ({}));
    throw new Error(data.detail || `请求失败 (${resp.status})`);
  }
  return resp.blob();
}

// Convenience helpers
export const API = {
  login: (body) => api('/api/auth/login', { method: 'POST', body: JSON.stringify(body) }),
  register: (body) => api('/api/auth/register', { method: 'POST', body: JSON.stringify(body) }),
  me: () => api('/api/auth/me'),
  wechatChallenge: (id, pollToken) =>
    api(`/api/wechat-gate/challenges/${encodeURIComponent(id)}?poll_token=${encodeURIComponent(pollToken)}`),
  curriculum: () => api('/api/curriculum'),
  kpQuestions: (kpId, params = {}) => {
    const qs = new URLSearchParams(params).toString();
    return api(`/api/curriculum/kp/${kpId}/questions${qs ? '?' + qs : ''}`);
  },
  allQuestions: (params = {}) => {
    const qs = new URLSearchParams(params).toString();
    return api(`/api/curriculum/questions${qs ? '?' + qs : ''}`);
  },
  dashboard: () => api('/api/dashboard/summary'),
  submitAnswer: (qid, selected) =>
    api('/api/answers', { method: 'POST', body: JSON.stringify({ question_id: qid, selected }) }),
  stats: () => api('/api/stats'),
  adminStats: () => api('/api/admin/stats'),
  examStart: () => api('/api/exams/start', { method: 'POST' }),
  examActive: () => api('/api/exams/active'),
  examProgress: (sid, answers) =>
    api(`/api/exams/${sid}/progress`, { method: 'PUT', body: JSON.stringify({ answers }) }),
  examReview: (sid) => api(`/api/exams/${sid}/review`),
  examSubmit: (sid, answers) =>
    api('/api/exams/submit', { method: 'POST', body: JSON.stringify({ session_id: sid, answers }) }),
  examHistory: () => api('/api/exams/history'),
  statsHeatmap: (days = 90) => api(`/api/stats/heatmap?days=${days}`),
  leaderboard: (limit = 20) => api(`/api/stats/leaderboard?limit=${limit}`),
  competition: (limit = 20) => api(`/api/stats/competition?limit=${limit}`),
  classes: () => api('/api/classes'),
  setMyClass: (class_id) =>
    api('/api/me/class', { method: 'PUT', body: JSON.stringify({ class_id }) }),
  operations: () => api('/api/operations'),
  operationCategories: () => api('/api/operations/categories'),
  operation: (id) => api(`/api/operations/${id}`),
  operationFiles: (id) => api(`/api/operations/${id}/files`),
  operationDocxTemplate: (id) => api(`/api/operations/${id}/docx-template`),
  operationFileBlob: (id, path) =>
    apiBlob(`/api/operations/${id}/files/${String(path).split('/').map(encodeURIComponent).join('/')}`),
  opSessionCreate: (operation_id) =>
    api('/api/operations/sessions', { method: 'POST', body: JSON.stringify({ operation_id }) }),
  opsUnlockStatus: () => api('/api/ops-unlock/status'),
  opsUnlock: (code) =>
    api('/api/ops-unlock', { method: 'POST', body: JSON.stringify({ code }) }),
  opActiveDrafts: () => api('/api/operations/sessions/active'),
  opSessionGet: (sid) => api(`/api/operations/sessions/${sid}`),
  opSessionDiscard: (sid) =>
    api(`/api/operations/sessions/${sid}`, { method: 'DELETE' }),
  opSessionSaveDraft: (sid, body) =>
    api(`/api/operations/sessions/${sid}/draft`, { method: 'PUT', body: JSON.stringify(body) }),
  opSessionReset: (sid, mode) =>
    api(`/api/operations/sessions/${sid}/reset${mode ? '?mode=' + encodeURIComponent(mode) : ''}`, { method: 'POST' }),
  opSessionSubmit: (sid, body) =>
    api(`/api/operations/sessions/${sid}/submit`, { method: 'POST', body: JSON.stringify(body) }),
  // Practical (ops) mock exam
  opsExamBlueprint: () => api('/api/ops-exams/blueprint'),
  opsExamStart: () => api('/api/ops-exams/start', { method: 'POST', body: '{}' }),
  opsExamActive: () => api('/api/ops-exams/active'),
  opsExamGet: (sid) => api(`/api/ops-exams/${sid}`),
  opsExamSubmit: (sid) => api(`/api/ops-exams/${sid}/submit`, { method: 'POST' }),
  opsExamList: () => api('/api/ops-exams'),
  // Progress reset
  resetTheory: ({ kp_id, section_id } = {}) => {
    const qs = new URLSearchParams();
    if (kp_id) qs.set('kp_id', kp_id);
    if (section_id) qs.set('section_id', section_id);
    const s = qs.toString();
    return api(`/api/me/progress/theory${s ? '?' + s : ''}`, { method: 'DELETE' });
  },
  resetOperations: (op_id) =>
    api(`/api/me/progress/operations${op_id ? `?op_id=${op_id}` : ''}`, { method: 'DELETE' }),
  resetExamsTheory: () => api('/api/me/progress/exams/theory', { method: 'DELETE' }),
  resetExamsOperations: () => api('/api/me/progress/exams/operations', { method: 'DELETE' }),
  // Feedback
  feedbackSubmit: (content) =>
    api('/api/feedbacks', { method: 'POST', body: JSON.stringify({ content }) }),
  feedbackList: () => api('/api/feedbacks'),
  feedbackMine: () => api('/api/feedbacks/mine'),
  feedbackAll: () => api('/api/admin/feedbacks'),
  feedbackThread: (id) => api(`/api/feedbacks/${id}`),
  feedbackReply: (id, content) =>
    api(`/api/feedbacks/${id}/messages`, { method: 'POST', body: JSON.stringify({ content }) }),
  feedbackToggleRead: (id, is_read) =>
    api(`/api/admin/feedbacks/${id}`, { method: 'PATCH', body: JSON.stringify({ is_read }) }),
  feedbackToggleResolved: (id, is_resolved) =>
    api(`/api/admin/feedbacks/${id}`, { method: 'PATCH', body: JSON.stringify({ is_resolved }) }),
  feedbackDelete: (id) =>
    api(`/api/admin/feedbacks/${id}`, { method: 'DELETE' }),
  feedbackUnreadCount: () => api('/api/feedbacks/unread_count'),
  // Online presence
  presenceOnline: () => api('/api/presence/online'),
  presenceActivity: () => api('/api/presence/activity', { method: 'POST', body: '{}' }),
};
