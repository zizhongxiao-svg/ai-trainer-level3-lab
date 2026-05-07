import { auth, API } from './api.js?v=20260503-docx-template-1';
import { renderDashboard } from './pages/dashboard.js?v=20260428-focus-1';
import { renderTheory } from './pages/theory.js?v=20260424-3';
import { renderOperationsList } from './pages/operations-list.js?v=20260428-score-7';
import { renderOperationsCode } from './pages/operations-code.js?v=20260501-inline-cont-1';
import { renderOperationsDoc } from './pages/operations-doc.js?v=20260503-docx-learning-goal-1';
import { renderExamEntry } from './pages/exam-entry.js?v=20260429-ops-unlock-2';
import { renderExamTake } from './pages/exam-take.js?v=20260428-exam-top-4';
import { renderExamResult } from './pages/exam-result.js';
import { renderExamHistory } from './pages/exam-history.js';
import { renderExamOps } from './pages/exam-ops.js?v=20260429-ops-unlock-2';
import { renderMe } from './pages/me.js?v=20260424-4';
import { renderAdmin } from './pages/admin.js';
import { renderClasses } from './pages/classes.js?v=20260424-3';
import { renderFeedback } from './pages/feedback.js?v=20260429-public-1';
import { renderArchitecture } from './pages/architecture.js?v=20260427-1';
import { renderDocFlash } from './pages/doc-flash.js?v=20260430-section-no-1';
import { mountChatDrawer } from './components/chat-drawer.js?v=20260429-chat-drawer-focus-1';
import { handleOpsUnlockError } from './pages/_ops-unlock.js?v=20260429-2';

const { createApp, ref, computed, onMounted, watch, nextTick } = Vue;

window.__EDITION_LOAD = (async () => {
  try {
    const r = await fetch('api/edition');
    if (r.ok) window.__EDITION = await r.json();
  } catch {}
  window.__EDITION = window.__EDITION || { edition: 'community', features: {}, license_owner: '' };
})();

async function renderOpsDispatch(host, ctx) {
  const m = (ctx.hash || '').match(/^#\/ops\/(\d+)/);
  if (!m) {
    await renderOperationsList(host);
    return;
  }
  const id = m[1];
  const params = new URLSearchParams((ctx.hash || '').split('?')[1] || '');
  const sessionId = params.get('session');
  try {
    const op = await API.operation(Number(id));
    if (op.type === 'code') await renderOperationsCode(host, { id, sessionId });
    else await renderOperationsDoc(host, { id, sessionId });
  } catch (e) {
    if (handleOpsUnlockError(e, () => renderOpsDispatch(host, ctx))) {
      host.innerHTML = `<div class="bk-card"><p class="small">操作题需要先解锁。</p></div>`;
      return;
    }
    host.innerHTML = `<div class="bk-card" style="color:var(--err)">${e.message}</div>`;
  }
}

async function renderExamDispatch(host, ctx) {
  const h = ctx.hash || '';
  const mResult = h.match(/^#\/exam\/(\d+)\/result/);
  if (mResult) return renderExamResult(host, { sid: mResult[1] });
  if (h.startsWith('#/exam/history')) return renderExamHistory(host);
  const mTake = h.match(/^#\/exam\/(\d+)/);
  if (mTake) return renderExamTake(host, { sid: mTake[1] });
  return renderExamEntry(host);
}

const ROUTES = [
  { hash: '#/dashboard', label: '首页',     render: renderDashboard },
  { hash: '#/theory',    label: '理论题库', render: renderTheory },
  { hash: '#/ops',       label: '操作实训', render: renderOpsDispatch },
  { hash: '#/exam-ops',  label: '实操模拟', render: renderExamOps, hidden: true, navHash: '#/exam' },
  { hash: '#/exam',      label: '模拟考试', render: renderExamDispatch },
  { hash: '#/classes',   label: '班级',     render: renderClasses, feature: 'classes' },
  { hash: '#/feedback',  label: '反馈',     render: renderFeedback, feature: 'feedback' },
  { hash: '#/me',        label: '我的数据', render: renderMe },
  { hash: '#/doc-flash', label: '小作文速记', render: renderDocFlash },
  { hash: '#/admin',     label: '管理',     render: renderAdmin, adminOnly: true, feature: 'admin' },
  { hash: '#/arch',      label: '架构',     render: renderArchitecture, hidden: true },
];

function matchRoute(h) {
  const base = h.split('?')[0];
  return ROUTES.find(r => base === r.hash || base.startsWith(r.hash + '/'));
}

function currentHash() {
  const h = window.location.hash || '#/dashboard';
  if (!matchRoute(h)) return '#/dashboard';
  return h;
}

(async () => {
await window.__EDITION_LOAD;

createApp({
  setup() {
    const token = ref(auth.token);
    const user = ref(auth.user);
    const loginMode = ref('login');
    const loginForm = ref({ username: '', password: '' });
    const regForm = ref({ username: '', display_name: '', password: '' });
    const loading = ref(false);
    const err = ref('');
    const wechatChallenge = ref(null);
    const wechatStatus = ref('');
    const hash = ref(currentHash());
    const pageHost = ref(null);
    const chatDrawerHost = ref(null);
    let chatDrawerCleanup = null;
    const onlineCount = ref(0);
    const onlineUsers = ref([]);
    const activeCount = ref(0);
    const activeUsers = ref([]);
    const onlinePanelOpen = ref(false);
    const activePanelOpen = ref(false);
    const userMenuOpen = ref(false);
    const feedbackUnread = ref(0);
    const editionFeatures = computed(() => window.__EDITION?.features || {});
    const licenseOwner = computed(() => window.__EDITION?.license_owner || '');
    let onlineTimer = null;
    let feedbackTimer = null;
    let wechatTimer = null;
    let activityTracking = false;
    let activityLastSent = 0;
    const activityMinInterval = 15000;

    async function refreshOnline() {
      if (!token.value) return;
      try {
        const d = await API.presenceOnline();
        onlineCount.value = d.count || 0;
        onlineUsers.value = d.users || [];
        activeCount.value = user.value?.is_admin ? (d.active_count || 0) : 0;
        activeUsers.value = user.value?.is_admin ? (d.active_users || []) : [];
      } catch { /* ignore transient errors */ }
    }
    async function reportActivity(force = false) {
      if (!token.value) return;
      if (!force && document.visibilityState === 'hidden') return;
      const now = Date.now();
      if (!force && now - activityLastSent < activityMinInterval) return;
      activityLastSent = now;
      try { await API.presenceActivity(); } catch { /* ignore */ }
    }
    function onUserActivity() { reportActivity(false); }
    function startActivityTracking() {
      if (editionFeatures.value.presence === false) return;
      if (activityTracking) return;
      activityTracking = true;
      ['pointerdown', 'keydown', 'input', 'submit'].forEach((ev) => {
        window.addEventListener(ev, onUserActivity, { capture: true });
      });
    }
    function stopActivityTracking() {
      if (!activityTracking) return;
      activityTracking = false;
      ['pointerdown', 'keydown', 'input', 'submit'].forEach((ev) => {
        window.removeEventListener(ev, onUserActivity, { capture: true });
      });
      activityLastSent = 0;
    }
    async function refreshFeedbackUnread() {
      if (!token.value) return;
      try {
        const d = await API.feedbackUnreadCount();
        feedbackUnread.value = d.count || 0;
      } catch { /* ignore */ }
    }
    function startOnlinePolling() {
      if (editionFeatures.value.presence === false) return;
      if (onlineTimer) return;
      refreshOnline();
      onlineTimer = setInterval(refreshOnline, 30000);
    }
    function stopOnlinePolling() {
      if (onlineTimer) { clearInterval(onlineTimer); onlineTimer = null; }
      onlineCount.value = 0;
      onlineUsers.value = [];
      activeCount.value = 0;
      activeUsers.value = [];
      onlinePanelOpen.value = false;
      activePanelOpen.value = false;
    }
    function startFeedbackPolling() {
      if (editionFeatures.value.feedback === false) return;
      if (feedbackTimer) return;
      refreshFeedbackUnread();
      feedbackTimer = setInterval(refreshFeedbackUnread, 30000);
    }
    function stopFeedbackPolling() {
      if (feedbackTimer) { clearInterval(feedbackTimer); feedbackTimer = null; }
      feedbackUnread.value = 0;
    }

    const routes = () => ROUTES.filter(r =>
      !r.hidden
      && (!r.adminOnly || user.value.is_admin)
      && (!r.feature || editionFeatures.value[r.feature] !== false)
    );
    const isRouteActive = (r) => {
      const current = matchRoute(hash.value);
      const navHash = current?.navHash || current?.hash || hash.value;
      return navHash === r.hash || navHash.startsWith(r.hash + '/');
    };

    async function openDashboard() {
      window.location.hash = '#/dashboard';
      await nextTick();
      await mount();
    }

    function clearWechatChallenge() {
      if (wechatTimer) { clearInterval(wechatTimer); wechatTimer = null; }
      wechatChallenge.value = null;
      wechatStatus.value = '';
    }

    async function acceptAuthResponse(d) {
      if (d && d.requires_wechat_follow && d.challenge) {
        if (wechatTimer) clearInterval(wechatTimer);
        wechatChallenge.value = d.challenge;
        wechatStatus.value = d.detail || '请完成账号验证，确认后自动登录';
        wechatTimer = setInterval(pollWechatChallenge, 2200);
        pollWechatChallenge();
        return;
      }
      clearWechatChallenge();
      auth.token = d.token; auth.user = d.user;
      token.value = d.token; user.value = d.user;
      await openDashboard();
      reportActivity(true);
    }

    async function pollWechatChallenge() {
      const ch = wechatChallenge.value;
      if (!ch) return;
      try {
        const d = await API.wechatChallenge(ch.id, ch.poll_token);
        if (d.status === 'completed') {
          wechatStatus.value = d.message || '已确认，正在登录';
          await acceptAuthResponse(d);
        } else if (d.status === 'rejected') {
          if (wechatTimer) { clearInterval(wechatTimer); wechatTimer = null; }
          wechatStatus.value = d.message || '该验证方式无法绑定当前账号';
        } else if (d.status === 'expired') {
          if (wechatTimer) { clearInterval(wechatTimer); wechatTimer = null; }
          wechatStatus.value = '二维码已过期，请重新提交登录或注册';
        } else {
          wechatStatus.value = '等待扫码确认…';
        }
      } catch (e) {
        wechatStatus.value = e.message || '确认状态获取失败';
      }
    }

    async function doLogin() {
      clearWechatChallenge();
      err.value = ''; loading.value = true;
      try {
        const d = await API.login(loginForm.value);
        await acceptAuthResponse(d);
      } catch (e) { err.value = e.message; }
      loading.value = false;
    }
    async function doRegister() {
      clearWechatChallenge();
      err.value = ''; loading.value = true;
      try {
        const d = await API.register(regForm.value);
        await acceptAuthResponse(d);
      } catch (e) { err.value = e.message; }
      loading.value = false;
    }
    function setupChatDrawer() {
      if (editionFeatures.value.chat === false) return;
      if (chatDrawerCleanup) return;
      if (!chatDrawerHost.value) return;
      chatDrawerCleanup = mountChatDrawer(chatDrawerHost.value);
    }
    function teardownChatDrawer() {
      if (chatDrawerCleanup) {
        try { chatDrawerCleanup(); } catch {}
        chatDrawerCleanup = null;
      }
    }
    function logout() { stopOnlinePolling(); stopFeedbackPolling(); stopActivityTracking(); teardownChatDrawer(); clearWechatChallenge(); auth.clear(); token.value = ''; user.value = {}; }

    async function mount() {
      if (!token.value) return;
      hash.value = currentHash();
      const route = matchRoute(hash.value);
      if (!route) return;
      if (route.feature && editionFeatures.value[route.feature] === false) {
        window.location.hash = '#/dashboard';
        return;
      }
      if (pageHost.value) {
        pageHost.value.innerHTML = '';
        await route.render(pageHost.value, { user: user.value, hash: hash.value });
      }
    }

    async function refreshUser() {
      if (!token.value) return;
      try {
        const me = await API.me();
        auth.user = me; user.value = me;
      } catch { /* stale token cleared by api() already */ }
    }

    onMounted(async () => {
      window.addEventListener('hashchange', mount);
      window.addEventListener('feedback-unread-refresh', refreshFeedbackUnread);
      await refreshUser();
      mount();
      if (token.value) {
        startOnlinePolling();
        startActivityTracking();
        startFeedbackPolling();
        await nextTick();
        setupChatDrawer();
      }
    });

    watch(token, async (v) => {
      await nextTick();
      await mount();
      if (v) {
        startOnlinePolling();
        startActivityTracking();
        startFeedbackPolling();
        await nextTick();
        setupChatDrawer();
      } else {
        stopOnlinePolling();
        stopFeedbackPolling();
        stopActivityTracking();
        teardownChatDrawer();
      }
    }, { flush: 'post' });

    return { token, user, loginMode, loginForm, regForm, loading, err, hash,
             wechatChallenge, wechatStatus,
             editionFeatures, licenseOwner,
             routes, isRouteActive, doLogin, doRegister, clearWechatChallenge, logout, pageHost, chatDrawerHost,
             onlineCount, onlineUsers, activeCount, activeUsers, onlinePanelOpen, activePanelOpen, userMenuOpen, feedbackUnread,
             toggleOnlinePanel: () => { onlinePanelOpen.value = !onlinePanelOpen.value; if (onlinePanelOpen.value) refreshOnline(); },
             toggleActivePanel: () => { activePanelOpen.value = !activePanelOpen.value; if (activePanelOpen.value) refreshOnline(); },
             closeOnlinePanel: () => { onlinePanelOpen.value = false; },
             closeActivePanel: () => { activePanelOpen.value = false; },
             toggleUserMenu: () => { userMenuOpen.value = !userMenuOpen.value; },
             closeUserMenu: () => { userMenuOpen.value = false; },
             gotoMe: () => { userMenuOpen.value = false; window.location.hash = '#/me'; },
             gotoArch: () => { userMenuOpen.value = false; window.location.hash = '#/arch'; },
             switchTo: (h) => { window.location.hash = h; } };
  },
  template: `
    <div v-if="!token" class="bk-login-wrap">
      <div class="bk-login-box">
        <div class="bk-login-brand">
          <h1>人工智能训练师三级 备考通</h1>
          <p>人工智能训练师三级备考</p>
        </div>
        <p v-if="licenseOwner" style="text-align:center;margin-top:8px;font-size:0.78rem;color:var(--ink-3,#999)">已授权：{{ licenseOwner }}</p>
        <div class="bk-card">
          <div v-if="err" class="bk-alert-err" style="color:var(--err);margin-bottom:12px;font-size:0.85rem">{{ err }}</div>
          <template v-if="loginMode==='login'">
            <div class="bk-field"><label class="bk-field-label">用户名</label><input class="bk-input" v-model="loginForm.username" @keyup.enter="doLogin"></div>
            <div class="bk-field"><label class="bk-field-label">密码</label><input class="bk-input" v-model="loginForm.password" type="password" @keyup.enter="doLogin"></div>
            <button class="bk-btn bk-btn-primary" style="width:100%" @click="doLogin" :disabled="loading">{{ loading?'登录中…':'登录' }}</button>
            <p style="text-align:center;margin-top:14px;font-size:0.85rem;color:var(--ink-2)">没有账号？<a @click="loginMode='register';clearWechatChallenge()" style="color:var(--ink-1);cursor:pointer;text-decoration:underline">注册</a></p>
          </template>
          <template v-else>
            <div class="bk-field"><label class="bk-field-label">用户名</label><input class="bk-input" v-model="regForm.username"></div>
            <div class="bk-field"><label class="bk-field-label">昵称</label><input class="bk-input" v-model="regForm.display_name"></div>
            <div class="bk-field"><label class="bk-field-label">密码</label><input class="bk-input" v-model="regForm.password" type="password" @keyup.enter="doRegister"></div>
            <button class="bk-btn bk-btn-primary" style="width:100%" @click="doRegister" :disabled="loading">{{ loading?'注册中…':'注册' }}</button>
            <p style="text-align:center;margin-top:14px;font-size:0.85rem;color:var(--ink-2)">已有账号？<a @click="loginMode='login';clearWechatChallenge()" style="color:var(--ink-1);cursor:pointer;text-decoration:underline">登录</a></p>
          </template>
          <div v-if="wechatChallenge" style="margin-top:16px;text-align:center;padding:14px;border-radius:8px;background:var(--surface-2,#f5f5f5);border:1px solid var(--line,#e5e7eb)">
            <p style="font-size:0.86rem;color:var(--ink-1);margin:0 0 10px">请扫码完成账号验证</p>
            <img :src="wechatChallenge.qrcode_url" alt="账号验证二维码" style="width:180px;height:180px;border-radius:6px;display:block;margin:0 auto;background:#fff">
            <p style="font-size:0.82rem;color:var(--ink-2);margin:10px 0 0">{{ wechatStatus }}</p>
          </div>
        </div>
      </div>
    </div>
    <div v-else>
      <nav class="bk-nav">
        <div class="bk-nav-brand">人工智能训练师三级 备考通</div>
        <div class="bk-nav-tabs">
          <button v-for="r in routes()" :key="r.hash" class="bk-nav-tab"
                  :class="{on: isRouteActive(r)}"
                  @click="switchTo(r.hash)">
            {{ r.label }}<span v-if="r.hash==='#/feedback' && feedbackUnread>0" class="bk-nav-badge">{{ feedbackUnread>99?'99+':feedbackUnread }}</span>
          </button>
        </div>
        <div class="bk-nav-user">
          <div v-if="editionFeatures.presence !== false" class="bk-online-wrap">
            <button class="bk-online-badge"
                    @click="user.is_admin && toggleOnlinePanel()"
                    :style="user.is_admin ? null : {cursor:'default'}"
                    :title="user.is_admin ? '最近 3 分钟活跃用户' : '当前在线人数（近 3 分钟）'">
              <span class="bk-online-dot"></span>
              <span>在线 {{ onlineCount }} 人</span>
            </button>
            <div v-if="onlinePanelOpen && user.is_admin" class="bk-online-panel" @click.stop>
              <div class="bk-online-panel-hd">当前在线（近 3 分钟）</div>
              <div v-if="onlineUsers.length===0" class="bk-online-panel-empty">暂无其他用户</div>
              <ul v-else class="bk-online-panel-list">
                <li v-for="u in onlineUsers" :key="u.username">
                  <span class="bk-online-dot"></span>
                  <span class="bk-online-name">{{ u.display_name || u.username }}</span>
                  <span class="bk-online-ago">{{ u.seconds_ago < 60 ? '刚刚' : Math.floor(u.seconds_ago/60)+' 分钟前' }}</span>
                </li>
              </ul>
            </div>
            <div v-if="onlinePanelOpen && user.is_admin" class="bk-online-mask" @click="closeOnlinePanel"></div>
          </div>
          <div v-if="user.is_admin && editionFeatures.presence !== false" class="bk-online-wrap">
            <button class="bk-online-badge bk-active-badge"
                    @click="toggleActivePanel"
                    title="最近 3 分钟有点击、输入、提交或聊天发言的用户">
              <span class="bk-active-dot"></span>
              <span>操作 {{ activeCount }} 人</span>
            </button>
            <div v-if="activePanelOpen" class="bk-online-panel" @click.stop>
              <div class="bk-online-panel-hd">真实操作（近 3 分钟）</div>
              <div v-if="activeUsers.length===0" class="bk-online-panel-empty">暂无真实操作用户</div>
              <ul v-else class="bk-online-panel-list">
                <li v-for="u in activeUsers" :key="u.username">
                  <span class="bk-active-dot"></span>
                  <span class="bk-online-name">{{ u.display_name || u.username }}</span>
                  <span class="bk-online-ago">{{ u.seconds_ago < 60 ? '刚刚' : Math.floor(u.seconds_ago/60)+' 分钟前' }}</span>
                </li>
              </ul>
            </div>
            <div v-if="activePanelOpen" class="bk-online-mask" @click="closeActivePanel"></div>
          </div>
          <div class="bk-user-pill-wrap">
            <button class="bk-user-pill" :class="{open:userMenuOpen}" @click="toggleUserMenu">
              <span class="bk-user-pill-avatar">{{ (user.display_name||'U')[0] }}</span>
              <span class="bk-user-pill-name">{{ user.display_name || user.username }}</span>
              <span class="bk-user-pill-caret">▾</span>
            </button>
            <div v-if="userMenuOpen" class="bk-user-menu" @click.stop>
              <div class="bk-user-menu-hd">
                <div class="bk-user-menu-name">{{ user.display_name || user.username }}</div>
                <div class="bk-user-menu-sub">@{{ user.username }}<span v-if="user.is_admin"> · 管理员</span></div>
              </div>
              <button class="bk-user-menu-item" @click="gotoMe">我的数据</button>
              <button v-if="user.is_admin" class="bk-user-menu-item" @click="gotoArch">系统架构</button>
              <button class="bk-user-menu-item bk-user-menu-item-danger" @click="logout">退出登录</button>
            </div>
            <div v-if="userMenuOpen" class="bk-online-mask" @click="closeUserMenu"></div>
          </div>
        </div>
      </nav>
      <div class="bk-shell" ref="pageHost"></div>
      <div v-if="editionFeatures.chat !== false" ref="chatDrawerHost"></div>
    </div>
  `,
}).mount('#app');
})();
