/* ═══════════════════════════════════════════════════════════
   app.js — no-gem Dashboard (static GitHub Pages edition)
   Auth: GitHub OAuth → JWT stored in localStorage.
   API_BASE read from ?api=... URL param; no key in URLs.
   Local dev (no ?api=): direct /api/... calls, no auth guard.
   ═══════════════════════════════════════════════════════════ */

/* ── Config from URL ─────────────────────────────────────── */
const _params = new URLSearchParams(window.location.search);
const API_BASE = (_params.get('api') || '').replace(/\/$/, '');

// If /auth/callback redirected here with ?token=, store it and clean the URL.
(function _handleAuthReturn() {
  const token = _params.get('token');
  if (!token) return;
  localStorage.setItem('dash-jwt', token);
  const clean = new URL(window.location.href);
  clean.searchParams.delete('token');
  window.history.replaceState({}, '', clean.toString());
})();

function _jwt()         { return localStorage.getItem('dash-jwt') || ''; }
function _authHeaders() { const j = _jwt(); return j ? { Authorization: `Bearer ${j}` } : {}; }
function apiUrl(path)   { return `${API_BASE}${path}`; }

// Redirect to GitHub OAuth if no JWT (only when API_BASE points to a remote backend).
async function _ensureAuth() {
  if (!API_BASE) return true; // local dev — no auth required
  if (_jwt()) return true;
  window.location.href = `${API_BASE}/auth/login?return=${encodeURIComponent(window.location.href)}`;
  return false;
}

// On 401 from any API call: clear JWT and redirect to re-auth.
function _handleUnauthorized() {
  localStorage.removeItem('dash-jwt');
  if (API_BASE) window.location.href = `${API_BASE}/auth/login?return=${encodeURIComponent(window.location.href)}`;
}

/* ── Global state (populated after fetch) ─────────────────── */
let AVATARS = {}, DQ_AVATARS = {}, DQ_TYPE_MAP = {}, DQ_COLORS = {};
let REGISTRY = [], DETAIL_DATA = {}, TASK_STATS = { recent:[], upcoming:[], byDay:{}, byType:{} };
let ALL_BY_STATUS = {}, SOURCES = [], COSTS = {}, PRIVILEGE_MATRIX = {}, LEVEL_OVERRIDES = {};
let FORCE_FLASH = false, INTENSITY_MODE = 'balanced', ACTIVE_PROVIDER = 'gemini';
let PANEL_PREFS = {}, COST_BY_DAY = {}, LAST_7_KEYS = [], COST_BY_AGENT_7D = {};
let LOCATION_PROFILE = null;
const SCALE = 6, DS = 8;
const AGENT_SOURCE_DOMAINS = { 'news-agent':'news', 'scout-agent':'scout' };

const TASK_TO_AGENT_ID = {
  deep_context:'context-agent', wiki_lint:'lint-agent', develop:'dev-agent',
  review:'review-agent', db_audit:'db-audit-agent', content:'drafting-agent',
  content_review:'editorial-agent', plan:'orchestrator', scout:'scout-agent',
};
const TASK_MODEL_MAP = {
  deep_context:'flash', wiki_lint:'flash', review:'flash', db_audit:'flash',
  develop:'pro', content:'pro', content_review:'pro', plan:'pro', scout:'pro',
};
const LV_COLORS = ['','#64748B','#38BDF8','#A78BFA','#F97316','#EF4444'];
const LV_NAMES = ['','Utility','Responder','Producer','Orchestrator','Builder'];
const FLOWS = [
  {name:'Daily Intelligence', color:'#60A5FA', agents:['news-agent','context-agent','lint-agent','scout-agent']},
  {name:'Development',        color:'#F97316', agents:['orchestrator','dev-agent','review-agent']},
  {name:'Content Pipeline',   color:'#A78BFA', agents:['orchestrator','structure-agent','drafting-agent','editorial-agent']},
  {name:'On-demand',          color:'#34D399', agents:['chat-agent','slide-agent','summary-agent']},
];

/* ═══════════════════════════════════════════════════════════
   BOOTSTRAP — load data then render
══════════════════════════════════════════════════════════════ */
async function loadDashboard() {
  if (!await _ensureAuth()) return;

  // Show a loading indicator without destroying the DOM
  const loaderId = '_dash-load-overlay';
  let loader = document.getElementById(loaderId);
  if (!loader) {
    loader = document.createElement('div');
    loader.id = loaderId;
    loader.className = 'dash-loading';
    loader.style.cssText = 'position:fixed;inset:0;z-index:200;background:var(--bg);opacity:.85';
    loader.innerHTML = '<div class="dash-loading-spinner"></div><div class="dash-loading-text">Loading…</div>';
    document.body.appendChild(loader);
  }
  loader.style.display = 'flex';

  try {
    const res = await fetch(apiUrl('/api/dashboard-data'), { headers: _authHeaders() });
    if (res.status === 401) { _handleUnauthorized(); return; }
    if (!res.ok) throw new Error(`HTTP ${res.status} ${res.statusText}`);
    const data = await res.json();
    _applyData(data);
    _renderAll(data);
  } catch (err) {
    // Show error in the active page
    const errEl = document.querySelector('.page.active') || document.querySelector('.page');
    if (errEl) errEl.innerHTML = `
      <div class="dash-error">
        <div class="dash-error-title">Failed to load dashboard</div>
        <div class="dash-error-msg">${esc(err.message)}</div>
        <div class="dash-error-hint">
          Add <code>?api=https://your-cloud-run-url&key=SECRET</code> to the URL,
          or run the backend locally at the same origin.
        </div>
        <button class="save-btn" style="margin-top:14px" onclick="loadDashboard()">Retry</button>
      </div>`;
  } finally {
    if (loader) loader.style.display = 'none';
  }
}

function _applyData(d) {
  AVATARS          = d.avatars         || {};
  DQ_AVATARS       = d.dqAvatars       || {};
  DQ_TYPE_MAP      = d.dqTypeMap       || {};
  DQ_COLORS        = d.dqColors        || {};
  REGISTRY         = d.registry        || [];
  DETAIL_DATA      = d.detailData      || {};
  TASK_STATS       = d.taskStats       || { recent:[], upcoming:[], byDay:{}, byType:{} };
  ALL_BY_STATUS    = d.allByStatus     || {};
  SOURCES          = d.sources         || [];
  COSTS            = d.costs           || {};
  PRIVILEGE_MATRIX = d.privilegeMatrix || {};
  LEVEL_OVERRIDES  = d.levelOverrides  || {};
  FORCE_FLASH      = !!d.forceFlash;
  INTENSITY_MODE   = d.intensityMode   || 'balanced';
  ACTIVE_PROVIDER  = d.activeProvider  || 'gemini';
  PANEL_PREFS      = d.panelPrefs      || {};
  COST_BY_DAY      = d.costByDay       || {};
  LAST_7_KEYS      = d.last7Keys       || [];
  COST_BY_AGENT_7D = d.costByAgent7d   || {};
  LOCATION_PROFILE = d.locationProfile || null;
  // Side-load data referenced by render helpers
  window._inboxData      = d.inbox         || { pending:[], done:[], ignored:[] };
  window._factChecks     = d.factChecks    || [];
  window._knowledgeData  = d.knowledgeData || {};
}

function _renderAll(d) {
  _renderAgentStatsBox();
  _renderAgentGrid();
  _renderKpiRow();
  _renderChannelCards(d.channels || []);
  _renderCostStrip();
  _renderTaskFeed();
  _renderKnowledge();
  _renderInbox();
  _renderAnalytics();
  _renderSettings(d.channels || []);
  _syncProviderUI();
  _renderLocationPill();
  _renderFlashList();
  _renderBadges();
  _renderDocsTree(d.docs || []);
  _initCharts();
  _startAvatarAnimations();
}

/* ═══════════════════════════════════════════════════════════
   NAVIGATION
══════════════════════════════════════════════════════════════ */
let _activePage = 'overview';

function navTo(pageId) {
  _activePage = pageId;
  document.querySelectorAll('.page').forEach(p => p.classList.toggle('active', p.id === 'page-' + pageId));
  document.querySelectorAll('.nav-pill').forEach(p => p.classList.toggle('active', p.dataset.page === pageId));
  document.querySelectorAll('.mob-tab[data-page]').forEach(b => b.classList.toggle('active', b.dataset.page === pageId));
  if (pageId === 'analytics') _initCharts();
  if (pageId === 'docs') _initDocsIfNeeded();
  if (pageId === 'settings') _loadDiscordChannels();
  window.scrollTo({ top:0, behavior:'instant' });
}

document.querySelectorAll('.nav-pill').forEach(p => p.addEventListener('click', () => navTo(p.dataset.page)));

function openMoreSheet() { document.getElementById('mob-more-sheet').classList.add('open'); }
function closeMoreSheet(e) {
  if (!e || e.target === document.getElementById('mob-more-sheet') || e.type === 'click') {
    document.getElementById('mob-more-sheet').classList.remove('open');
  }
}

function toggleDrop(id) {
  const drop = document.getElementById(id);
  if (!drop) return;
  const open = drop.classList.toggle('open');
  if (open) {
    const close = (e) => { if (!drop.contains(e.target)) { drop.classList.remove('open'); document.removeEventListener('click', close); } };
    setTimeout(() => document.addEventListener('click', close), 10);
  }
}

/* ═══════════════════════════════════════════════════════════
   HELPERS
══════════════════════════════════════════════════════════════ */
function relTime(iso) {
  if (!iso) return '';
  const m = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
  if (m < 1) return 'just now'; if (m < 60) return m + 'm ago';
  const h = Math.round(m / 60); if (h < 24) return h + 'h ago';
  return Math.round(h / 24) + 'd ago';
}
function fmtDate(iso) {
  if (!iso) return '';
  return new Date(iso).toLocaleString('ja-JP', { timeZone:'Asia/Tokyo', month:'2-digit', day:'2-digit', hour:'2-digit', minute:'2-digit' });
}
function cmap(colors) { const [b,a,h,d] = colors; return {0:null,1:b,2:a,3:h,4:d}; }

function drawGrid(ctx, grid, cm, blink, scale) {
  ctx.clearRect(0, 0, ctx.canvas.width, ctx.canvas.height);
  if (!grid) return;
  for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) {
    let v = grid[y]?.[x]; const c = (blink && v === 3) ? cm[1] : cm[v];
    if (c) { ctx.fillStyle = c; ctx.fillRect(x * scale, y * scale, scale, scale); }
  }
}

function nextRun(freq) {
  if (!freq) return '';
  const now = new Date(), tj = new Date(now.toLocaleString('en-US', { timeZone:'Asia/Tokyo' }));
  if (freq.includes('On-demand') || freq.includes('Inline')) return 'When triggered';
  if (freq.includes('10 min')) { const m = 10 - tj.getMinutes() % 10; return `In ~${m}m`; }
  if (freq.includes('07:0')) {
    const min = freq.includes('07:01') ? 1 : 0, next = new Date(tj);
    next.setHours(7, min, 0, 0); if (next <= tj) next.setDate(next.getDate() + 1);
    const dh = Math.round((next - tj) / 3600000);
    return dh < 1 ? '< 1h' : dh < 24 ? `In ~${dh}h` : 'Tomorrow 07:00 JST';
  }
  if (freq.includes('Wed & Sun')) {
    const day = tj.getDay(), du = [3,0].map(t => (t-day+7)%7).sort((a,b)=>a-b)[0] || 7;
    const names = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];
    return du === 0 ? 'Today 07:00 JST' : `In ${du}d (${names[(day+du)%7]})`;
  }
  return freq;
}

function agentChip(taskType) {
  const agentId = TASK_TO_AGENT_ID[taskType]; if (!agentId) return '';
  const reg = REGISTRY.find(r => r.id === agentId); if (!reg) return '';
  return `<span class="agent-chip" style="border-color:${reg.colors[0]}66;color:${reg.colors[0]}">⬡ ${esc(reg.name)}</span>`;
}

/* ═══════════════════════════════════════════════════════════
   OVERVIEW — AGENT STATS BOX
══════════════════════════════════════════════════════════════ */
function _renderAgentStatsBox() {
  const running = Object.values(DETAIL_DATA).filter(d => d.status === 'running').length;
  const failed  = Object.values(DETAIL_DATA).filter(d => d.status === 'failed').length;
  const enabled = Object.values(DETAIL_DATA).filter(d => d.enabled !== false).length;
  const pending = (TASK_STATS.upcoming || []).length;
  document.getElementById('agent-stats-box').innerHTML = `
    <div class="asb-stat"><div class="asb-val">${REGISTRY.length}</div><div class="asb-label">Agents</div></div>
    <div class="asb-sep"></div>
    <div class="asb-stat"><div class="asb-val run">${running}</div><div class="asb-label">Running</div></div>
    <div class="asb-sep"></div>
    <div class="asb-stat"><div class="asb-val fail">${failed}</div><div class="asb-label">Failed</div></div>
    <div class="asb-sep"></div>
    <div class="asb-stat"><div class="asb-val">${enabled}</div><div class="asb-label">Enabled</div></div>
    <div class="asb-sep"></div>
    <div class="asb-stat"><div class="asb-val">${pending}</div><div class="asb-label">Pending tasks</div></div>
  `;
}

/* ═══════════════════════════════════════════════════════════
   OVERVIEW — AGENT GRID
══════════════════════════════════════════════════════════════ */
let _avTheme = localStorage.getItem('avTheme') || 'classic';
let _catFilter = 'all', _lvFilter = null, _trigFilter = null;

function _renderAgentGrid() {
  const grid = document.getElementById('agent-grid');
  if (!grid) return;
  grid.innerHTML = REGISTRY.map(reg => {
    const d = DETAIL_DATA[reg.id] || {};
    const status = d.status || 'idle';
    const enabled = d.enabled !== false;
    const pct = Math.min(100, Math.round(((d.tokensUsed || 0) / (d.tokenLimit || 1)) * 100));
    const barColor = pct > 80 ? '#EF4444' : pct > 50 ? '#FBBF24' : reg.colors[0];
    const costEst = (COST_BY_AGENT_7D[reg.id] || 0);
    const trig = (d.trigger || 'interactive');
    const spark = LAST_7_KEYS.map(k => (TASK_STATS.byDay?.[k]?.agentCounts?.[reg.id] || 0)).join(',');
    return `<div class="acard ${status} ${enabled ? '' : 'disabled'}"
      data-agent="${reg.id}" data-avatar="${reg.avatar || ''}"
      data-colors="${(reg.colors || []).join('|')}"
      data-category="${reg.category || ''}" data-level="${reg.level || 1}"
      data-trigger="${trig}" data-name="${esc(reg.name)}"
      data-tools="${esc((reg.tools || []).join(','))}"
      data-spark="${spark}" data-tokens="${d.tokensUsed || 0}"
      data-anim="${status}" onclick="openDetail('${reg.id}')">
      <div style="display:flex;justify-content:center;margin-bottom:4px">
        <canvas class="avatar" width="${SCALE*8}" height="${SCALE*8}" style="image-rendering:pixelated"></canvas>
      </div>
      <div class="acard-info">
        <div class="acard-name">${esc(reg.name)}</div>
        <div class="acard-desc">${esc(reg.desc || '')}</div>
        <div class="acard-chips" style="margin-top:4px">
          <span class="chip chip-${status}">${status}</span>
          <span class="cat-chip">${esc(reg.category || '')}</span>
        </div>
        <div class="acard-foot" style="margin-top:6px">
          <div style="flex:1">
            <div class="tok-bar-wrap"><div class="tok-bar" style="width:${pct}%;background:${barColor}"></div></div>
            <div class="token-text">${(d.tokensUsed||0) >= 1000 ? ((d.tokensUsed/1000).toFixed(1)+'k') : (d.tokensUsed||0)} / ${((d.tokenLimit||0)/1000).toFixed(0)}k</div>
          </div>
          <div class="card-cost">${costEst > 0 ? '$'+(costEst).toFixed(3) : ''}</div>
        </div>
      </div>
      <button class="agent-toggle ${enabled ? 'on' : ''}" onclick="toggleAgent('${reg.id}',event)" title="${enabled ? 'Disable':'Enable'}">
        ${enabled ? '●' : '○'}
      </button>
    </div>`;
  }).join('');

  // Sync av-theme buttons
  document.querySelectorAll('.av-theme-btn').forEach(b => b.classList.toggle('active', b.textContent.toLowerCase().includes(_avTheme)));

  _startAvatarAnimations();
  _applyAgentFilters();
}

function _startAvatarAnimations() {
  document.querySelectorAll('.acard[data-agent]').forEach(card => {
    const cv = card.querySelector('canvas.avatar'); if (!cv) return;
    const ctx = cv.getContext('2d');
    const reg = REGISTRY.find(r => r.id === card.dataset.agent); if (!reg) return;
    const anim = card.dataset.anim; let t0 = 0;
    (function frame(ts) {
      if (!t0) t0 = ts; const e = ts - t0;
      const blink = e % 4200 > 4000;
      let dy = 0, dx = 0;
      if (anim === 'running') dy = Math.round(Math.sin(e/280)*3);
      else if (anim !== 'failed') dy = Math.round(Math.sin(e/1300)*2);
      if (anim === 'failed') dx = Math.round(Math.sin(e/75)*2);
      cv.style.transform = `translate(${dx}px,${dy}px)`;
      if (_avTheme === 'dq') {
        const dqType = DQ_TYPE_MAP[reg.id] || 'scholar';
        const grid = DQ_AVATARS[dqType];
        const cols = DQ_COLORS[dqType] || reg.colors;
        drawGrid(ctx, grid, {0:null,1:cols[0],2:cols[1],3:cols[2],4:cols[3]}, blink, SCALE);
      } else if (_avTheme === 'initials') {
        ctx.clearRect(0,0,cv.width,cv.height);
        ctx.fillStyle = reg.colors[0] || '#888'; ctx.fillRect(0,0,cv.width,cv.height);
        ctx.fillStyle = '#fff'; ctx.font = `bold ${cv.width*.42}px sans-serif`;
        ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
        ctx.fillText((reg.name||'?').slice(0,2).toUpperCase(), cv.width/2, cv.height/2);
      } else {
        drawGrid(ctx, AVATARS[card.dataset.avatar], cmap(card.dataset.colors.split('|')), blink, SCALE);
      }
      if (anim === 'running') { const l = Math.floor((e/55)%48); ctx.fillStyle='rgba(0,0,0,.06)'; ctx.fillRect(0,l,48,2); }
      requestAnimationFrame(frame);
    })();
  });
}

function setAvTheme(t, el) {
  _avTheme = t; localStorage.setItem('avTheme', t);
  document.querySelectorAll('.av-theme-btn').forEach(b => b.classList.toggle('active', b === el));
}

function filterAgents() { _applyAgentFilters(); }

function setCatFilter(el, cat) {
  _catFilter = cat;
  document.querySelectorAll('.cat-tab').forEach(b => b.classList.toggle('active', b === el));
  _applyAgentFilters();
}

function _applyAgentFilters() {
  const q = (document.getElementById('agent-search')?.value || '').toLowerCase();
  document.querySelectorAll('.acard[data-agent]').forEach(c => {
    const ok = (_catFilter === 'all' || c.dataset.category === _catFilter)
      && (!_lvFilter || +c.dataset.level === _lvFilter)
      && (!_trigFilter || c.dataset.trigger === _trigFilter)
      && (!q || c.dataset.name.toLowerCase().includes(q) || c.dataset.agent.includes(q) || (c.dataset.tools||'').includes(q));
    c.classList.toggle('hidden', !ok);
  });
}

/* ═══════════════════════════════════════════════════════════
   OVERVIEW — KPI + COST STRIP
══════════════════════════════════════════════════════════════ */
function _renderKpiRow() {
  const bs = ALL_BY_STATUS || {};
  const statuses = [
    { s:'pending',   label:'Pending',   color:'#64748B' },
    { s:'running',   label:'Running',   color:'#38BDF8' },
    { s:'completed', label:'Completed', color:'#34D399' },
    { s:'failed',    label:'Failed',    color:'#EF4444' },
  ];
  document.getElementById('kpi-row').innerHTML = statuses.map(({s,label,color}) => {
    const n = (bs[s] || []).length;
    return `<div class="kpi" onclick="openTaskModal('${s}')" style="border-top:2px solid ${color}">
      <div class="kpi-label">${label}</div>
      <div class="kpi-value" style="color:${color}">${n}</div>
      <div class="kpi-hint">click to view</div>
    </div>`;
  }).join('');
}

function _renderCostStrip() {
  const today = new Date().toISOString().split('T')[0];
  const dayCost = COST_BY_DAY[today] || 0;
  const el = document.getElementById('day-cost-label');
  if (el) el.textContent = dayCost > 0 ? `Today: $${dayCost.toFixed(4)}` : '';

  const sel = document.getElementById('intensity-select');
  const selS = document.getElementById('intensity-select-s');
  if (sel) sel.value = INTENSITY_MODE;
  if (selS) selS.value = INTENSITY_MODE;

  const fb = document.getElementById('flash-global-btn');
  const fbS = document.getElementById('flash-global-btn-s');
  [fb, fbS].forEach(b => { if (b) { b.textContent = `⚡ Flash: ${FORCE_FLASH ? 'on' : 'off'}`; b.className = 'flash-toggle ' + (FORCE_FLASH ? 'active' : 'inactive'); } });

  const cb = document.getElementById('cost-badge');
  if (cb) { cb.textContent = dayCost > 0 ? `$${dayCost.toFixed(3)}` : ''; cb.className = 'cost-badge' + (dayCost > 0.1 ? ' high' : ''); }
}

/* ═══════════════════════════════════════════════════════════
   OVERVIEW — CHANNEL CARDS
══════════════════════════════════════════════════════════════ */
function _renderChannelCards(channels) {
  const el = document.getElementById('channel-cards');
  if (!el) return;
  if (!channels || !channels.length) { el.innerHTML = '<div style="font-size:11px;color:var(--m)">No channel data.</div>'; return; }
  el.innerHTML = channels.map(ch => `
    <div class="ch-card">
      <div class="ch-card-key">${esc(ch.key || ch.channelId || '—')}</div>
      <div class="ch-card-id">${esc(ch.channelId || '')}</div>
      ${ch.threadId ? `<div class="ch-card-thread">${esc(ch.threadId)}</div>` : ''}
      <div class="ch-card-agents">
        ${(ch.agents || []).map(a => `<span class="ch-agent-pill">${esc(a)}</span>`).join('')}
      </div>
    </div>`).join('');
}

/* ═══════════════════════════════════════════════════════════
   TASKS PAGE
══════════════════════════════════════════════════════════════ */
let _taskStatusFilter = 'all';

function setTaskFilter(el, status) {
  _taskStatusFilter = status;
  document.querySelectorAll('.qcat[data-status]').forEach(b => b.classList.toggle('active', b === el));
  _renderTaskFeed();
}

function _renderTaskFeed() {
  const el = document.getElementById('task-feed'); if (!el) return;
  let tasks;
  if (_taskStatusFilter === 'all') {
    tasks = [...(TASK_STATS.upcoming || []), ...(TASK_STATS.recent || [])];
  } else {
    tasks = ALL_BY_STATUS[_taskStatusFilter] || [];
  }
  if (!tasks.length) { el.innerHTML = '<div style="color:var(--m);font-size:11px;padding:12px 0">No tasks.</div>'; return; }
  el.innerHTML = tasks.slice(0, 60).map(t => {
    const isUpcoming = t.status === 'pending' || t.status === 'running';
    const btn = isUpcoming
      ? (t.id && t.status === 'pending' ? `<button class="act-btn cancel" onclick="doTaskAction('${t.id}','cancel',this)">✕</button>`
        : t.id && t.status === 'running' ? `<button class="act-btn stop" onclick="doTaskAction('${t.id}','stop',this)">⏹</button>` : '')
      : (t.id && (t.status === 'failed' || t.status === 'cancelled') ? `<button class="act-btn resume" onclick="doTaskAction('${t.id}','resume',this)">↻</button>` : '');
    const timeStr = isUpcoming ? `Queued ${relTime(t.createdAt)} · P${t.priority ?? 3}` : `${fmtDate(t.updatedAt)} · ${relTime(t.updatedAt)}`;
    const clickable = t.id ? `style="cursor:pointer" onclick="openTaskDetail('${t.id}')"` : '';
    return `<div class="feed-item" ${clickable}>
      <div class="feed-dot ${t.status}"></div>
      <div class="feed-text">${esc(t.goal)}
        <div class="feed-type"><span class="tl-type">${esc((t.type||'').replace(/_/g,' '))}</span>${agentChip(t.type)} ${timeStr}</div>
      </div>${btn}
    </div>`;
  }).join('');
}

/* ═══════════════════════════════════════════════════════════
   KNOWLEDGE PAGE
══════════════════════════════════════════════════════════════ */
let _kTab = 'sources';

function setKTab(el, tab) {
  _kTab = tab;
  document.querySelectorAll('.tab-btn[data-ktab]').forEach(b => b.classList.toggle('active', b === el));
  document.querySelectorAll('#page-knowledge .tab-content > div').forEach(d => d.classList.add('hidden'));
  document.getElementById('k-' + tab)?.classList.remove('hidden');
}

function _renderKnowledge() {
  document.getElementById('k-sources').innerHTML   = _buildSourceRows(SOURCES.filter(s => !s.blocked));
  document.getElementById('k-blocked').innerHTML   = _buildBlockedSourceRows(SOURCES.filter(s => s.blocked));
  const kd = (window._knowledgeData || {});
  document.getElementById('k-followups').innerHTML = _buildSuggestedFollowupRows(kd.suggestedFollowups || []);
  document.getElementById('k-merges').innerHTML    = _buildMergeSuggestionRows(kd.mergeSuggestions || []);
  document.getElementById('k-vaults').innerHTML    = _buildVaultRows(kd.vaults || [], kd.pendingVaultTasks || []);
  document.getElementById('k-bases').innerHTML     = _buildBasesRows(kd.bases || []);
}

function _buildSourceRows(sources) {
  if (!sources || !sources.length) return `<div style="color:var(--m);font-size:11px;padding:8px 0">No sources yet.</div>`;
  return sources.map(s => {
    const tc = s.type === 'rss' ? '#60A5FA' : s.type === 'url' ? '#A78BFA' : '#34D399';
    const dc = s.domain === 'news' ? '#FBBF24' : '#2DD4BF';
    return `<div class="src-row" data-domain="${s.domain}" data-id="${s.id}">
      <div class="src-toggle ${s.enabled ? 'on':'off'}" onclick="toggleSource('${s.id}',${!s.enabled})"></div>
      <div class="src-body">
        <div class="src-name">${esc(s.name)}</div>
        <div class="src-meta">
          <span style="color:${tc}">${(s.type||'').toUpperCase()}</span>
          <span style="color:${dc}">${s.domain}</span>
          ${s.genre ? `<span style="color:var(--m)">${esc(s.genre)}</span>` : ''}
          <a href="${esc(s.url)}" target="_blank" rel="noopener" style="color:var(--m);font-size:9px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:200px">${esc(s.url)}</a>
        </div>
      </div>
      <button class="act-btn cancel" onclick="blockSource('${s.id}')" style="font-size:8px;padding:2px 6px">⛔</button>
    </div>`;
  }).join('');
}

function _buildBlockedSourceRows(blocked) {
  if (!blocked || !blocked.length) return `<div style="color:var(--m);font-size:11px;padding:8px 0">No blocked sources.</div>`;
  return blocked.map(s => `<div class="src-row" data-id="${s.id}">
    <div class="src-toggle blocked"></div>
    <div class="src-body">
      <div class="src-name" style="text-decoration:line-through">${esc(s.name)}</div>
      <div class="src-meta"><span style="color:var(--error)">⛔ ${esc(s.blockedReason || 'blocked')}</span></div>
    </div>
    <button class="act-btn resume" onclick="unblockSource('${s.id}')" style="font-size:8px;padding:2px 6px">↻</button>
  </div>`).join('');
}

function _buildMergeSuggestionRows(items) {
  if (!items || !items.length) return `<div style="color:var(--m);font-size:11px;padding:8px 0">No flagged duplicates.</div>`;
  return items.map(m => {
    const pct = (Number(m.similarity) * 100).toFixed(1);
    return `<div class="src-row" data-merge-id="${esc(m.id)}" style="display:block;padding:6px 8px;border-left:3px solid #FBBF24">
      <div style="display:flex;justify-content:space-between;align-items:center;gap:8px;flex-wrap:wrap">
        <div style="flex:1"><div class="src-name">${esc(m.slugAName||m.slugA)} ⇔ ${esc(m.slugBName||m.slugB)}</div>
          <div style="font-size:10px;color:var(--m)">${pct}% similar</div></div>
        <div style="display:flex;gap:6px">
          <button class="act-btn resume" onclick="markMerged('${esc(m.id)}')" style="font-size:9px;padding:3px 9px">✓ Merged</button>
          <button class="act-btn cancel" onclick="dismissMerge('${esc(m.id)}')" style="font-size:9px;padding:3px 8px">✕</button>
        </div>
      </div>
    </div>`;
  }).join('');
}

function _buildSuggestedFollowupRows(items) {
  if (!items || !items.length) return `<div style="color:var(--m);font-size:11px;padding:8px 0">No pending follow-ups.</div>`;
  const byPage = {};
  for (const it of items) (byPage[it.pageSlug] ??= { pageName: it.pageName, items:[] }).items.push(it);
  return Object.entries(byPage).map(([slug, g]) => `<div class="src-row" style="display:block;padding:6px 8px;border-left:3px solid #A78BFA">
    <div class="src-name">from <span style="color:var(--acc)">${esc(g.pageName)}</span></div>
    ${g.items.map(it => `<div style="display:flex;justify-content:space-between;align-items:center;gap:8px;padding:4px 0;border-top:1px solid var(--div)">
      <div style="font-size:10px;color:var(--txt);flex:1">${esc(it.question)}</div>
      <div style="display:flex;gap:4px">
        <button class="act-btn resume" onclick="researchFollowup('${esc(slug)}','${esc(it.question).replace(/'/g,'')}',this)" style="font-size:9px;padding:3px 9px">🔬 Research</button>
        <button class="act-btn cancel" onclick="dismissFollowup('${esc(slug)}','${esc(it.question).replace(/'/g,'')}',this)" style="font-size:9px;padding:3px 8px">✕</button>
      </div>
    </div>`).join('')}
  </div>`).join('');
}

function _buildVaultRows(vaults, pendingVaultTasks) {
  const pending = (pendingVaultTasks || []).map(p => `<div class="src-row" style="display:block;border-left:3px solid #F97316;padding:6px 8px">
    <div class="src-name">${esc(p.vaultId)} → ${esc(p.repoName)}</div>
    <div style="font-size:10px;color:var(--m)">awaiting approval · ${p.visibility}</div>
  </div>`).join('');
  if (!vaults || !vaults.length) return pending + `<div style="color:var(--m);font-size:11px;padding:8px 0">No vaults registered.</div>`;
  return pending + vaults.slice().sort((a,b) => (b.is_default?1:0)-(a.is_default?1:0)).map(v => {
    const vc = v.visibility === 'confidential' ? '#EF4444' : v.visibility === 'internal' ? '#F97316' : '#34D399';
    const db = v.is_default ? `<span style="background:color-mix(in srgb,var(--grn) 14%,transparent);color:var(--grn);padding:1px 5px;border-radius:3px;font-size:9px">DEFAULT</span> ` : '';
    return `<div class="src-row" style="display:block;padding:6px 8px;border-left:3px solid ${vc}">
      <div style="display:flex;justify-content:space-between;align-items:center;gap:8px;flex-wrap:wrap">
        <div><div class="src-name">${db}${esc(v.id)}</div>
          <div style="font-size:10px;color:var(--m)">${esc(v.categories?.join(', ') || '(any)')} · ${v.pageCount||0} pages</div></div>
        <div style="display:flex;gap:6px">
          ${!v.is_default ? `<button class="act-btn cancel" onclick="deleteVault('${esc(v.id)}')" style="font-size:9px;padding:3px 8px">✕</button>` : ''}
        </div>
      </div>
    </div>`;
  }).join('');
}

function _buildBasesRows(bases) {
  if (!bases || !bases.length) return `<div style="color:var(--m);font-size:11px;padding:8px 0">No saved bases.</div>`;
  return bases.map(b => `<div class="src-row base-row" data-base-slug="${esc(b.id)}" style="display:block;padding:6px 8px;border-left:3px solid #6366F1">
    <div style="display:flex;justify-content:space-between;align-items:center;gap:8px;flex-wrap:wrap">
      <div><div class="src-name">${esc(b.name)}</div>${b.description?`<div style="font-size:10px;color:var(--m)">${esc(b.description)}</div>`:''}</div>
      <div style="display:flex;gap:6px">
        <button class="act-btn resume" onclick="runBase('${esc(b.id)}')" style="font-size:9px;padding:3px 10px">Run</button>
        <button class="act-btn cancel" onclick="deleteBase('${esc(b.id)}')" style="font-size:9px;padding:3px 8px">✕</button>
      </div>
    </div>
    <div class="base-result" id="baseResult-${esc(b.id)}" style="display:none;margin-top:8px"></div>
  </div>`).join('');
}

/* ═══════════════════════════════════════════════════════════
   INBOX PAGE
══════════════════════════════════════════════════════════════ */
let _iTab = 'pending';

function setITab(el, tab) {
  _iTab = tab;
  document.querySelectorAll('.tab-btn[data-itab]').forEach(b => b.classList.toggle('active', b === el));
  _renderInbox();
}

function _renderInbox() {
  _renderInboxList(_iTab);
  _renderFactChecks();
}

function _renderInboxList(status) {
  const el = document.getElementById('inbox-list'); if (!el) return;
  const items = (window._inboxData || {})[status] || [];
  if (!items.length) { el.innerHTML = `<div style="color:var(--m);font-size:11px;padding:12px 0">${status === 'pending' ? 'No pending items — orchestrator is unblocked.' : 'No items.'}</div>`; return; }
  el.innerHTML = items.map(it => {
    const ago = it.lastSeenAt ? new Date(it.lastSeenAt).toLocaleString('en-US', { timeZone:'Asia/Tokyo', hour12:false }) : '';
    const isUrl = it.command && /^https?:\/\//i.test(it.command);
    const cmdEl = it.command
      ? (isUrl ? `<a href="${esc(it.command)}" target="_blank" rel="noopener" style="color:var(--acc);word-break:break-all">${esc(it.command.substring(0,120))}${it.command.length>120?'…':''}</a>`
          : `<code style="font-size:9px;padding:2px 4px;border-radius:3px">${esc(it.command)}</code>`)
      : '';
    return `<div class="inbox-item" data-id="${esc(it.id)}">
      <div class="inbox-action">🚧 ${esc(it.action)}</div>
      <div class="inbox-why">${esc(it.reason)}</div>
      ${cmdEl ? `<div class="inbox-cmd">${cmdEl}</div>` : ''}
      <div class="inbox-foot">
        ${status === 'pending' ? `<button class="act-btn resume" onclick="inboxDone('${esc(it.id)}')" style="font-size:9px;padding:3px 10px">✓ Done</button>
          <button class="act-btn cancel" onclick="inboxIgnore('${esc(it.id)}')" style="font-size:9px;padding:3px 10px">✕ Ignore</button>` : ''}
        ${it.occurrences > 1 ? `<span style="font-size:9px;color:var(--warn)">×${it.occurrences}</span>` : ''}
        <span class="inbox-time">${ago}</span>
      </div>
    </div>`;
  }).join('');
}

function _renderFactChecks() {
  const el = document.getElementById('factcheck-list'); if (!el) return;
  const fcs = (window._factChecks || []);
  if (!fcs.length) { el.innerHTML = `<div style="color:var(--m);font-size:11px;padding:8px 0">No fact-check runs yet.</div>`; return; }
  el.innerHTML = fcs.map(fc => {
    const c = fc.counts || {};
    const total = (fc.verdicts || []).length || 0;
    const verPct = total > 0 ? Math.round(((c.verified||0)/total)*100) : 0;
    const hasIssues = (c.unsupported||0) + (c.partial||0) > 0;
    const dotColor = hasIssues ? '#EF4444' : verPct >= 80 ? '#34D399' : '#FBBF24';
    return `<details class="fc-row" style="border-left:3px solid ${dotColor}">
      <summary style="cursor:pointer;list-style:none;display:flex;justify-content:space-between;align-items:center;gap:8px">
        <span class="fc-date">${esc(fc.newsDate || fc.id)} — ${total} blocks</span>
        <span class="fc-verdict">
          <span style="color:#34D399">✓${c.verified||0}</span>
          <span style="color:#FBBF24">~${c.partial||0}</span>
          <span style="color:#EF4444">!${c.unsupported||0}</span>
          <span style="color:var(--m)">?${c.unverifiable||0}</span>
          <span style="color:${verPct>=80?'#34D399':verPct>=60?'#FBBF24':'#EF4444'}">${verPct}%</span>
        </span>
      </summary>
      <div style="font-size:10px;margin-top:6px">
        ${(fc.verdicts||[]).filter(v=>v.verdict==='unsupported'||v.verdict==='partial').slice(0,5).map(v=>`
          <div style="margin-top:4px;color:var(--txt)">${v.verdict==='unsupported'?'🚨':'⚠️'} ${esc((v.headline||'').substring(0,80))}</div>
          <div style="color:var(--m);font-style:italic;margin-left:14px">${esc(v.reason)}</div>
        `).join('') || '<div style="color:var(--m)">All blocks verified.</div>'}
      </div>
    </details>`;
  }).join('');
}

/* ═══════════════════════════════════════════════════════════
   ANALYTICS PAGE
══════════════════════════════════════════════════════════════ */
function _renderAnalytics() {
  _renderCostTable();
  _renderPrivMatrix();
}

function _renderCostTable() {
  const tbody = document.getElementById('cost-table-body'); if (!tbody) return;
  const entries = Object.entries(COSTS).sort((a,b) => b[1].estimatedCost - a[1].estimatedCost);
  if (!entries.length) { tbody.innerHTML = `<tr><td colspan="4" style="color:var(--m);font-size:11px;padding:8px">No data yet.</td></tr>`; return; }
  tbody.innerHTML = entries.map(([agentId, c]) => {
    const reg = REGISTRY.find(r => r.id === agentId);
    const model = reg ? reg.model : agentId;
    const tok = c.tokensUsed >= 1000 ? (c.tokensUsed/1000).toFixed(1)+'k' : String(c.tokensUsed||0);
    return `<tr>
      <td class="ct-name">${esc(reg?.name || agentId)}</td>
      <td class="ct-model">${esc(model)}</td>
      <td class="ct-tok">${tok}</td>
      <td class="ct-cost">${c.estimatedCost > 0 ? '$'+c.estimatedCost.toFixed(4) : '—'}</td>
    </tr>`;
  }).join('');
}

function _renderPrivMatrix() {
  const el = document.getElementById('priv-matrix'); if (!el) return;
  const ALL_ACTIONS = ['read_firestore','post_discord_message','read_github_files',
    'write_wiki','backup_to_drive','query_knowledge_base','write_firestore',
    'queue_orchestrator_tasks','trigger_github_actions','manage_agent_privileges',
    'create_branch','create_pr','execute_dev_workflow'];
  el.innerHTML = Object.entries(PRIVILEGE_MATRIX).map(([lv, pm]) => {
    const allowed = new Set(pm.actions || []);
    return `<div style="margin-bottom:12px">
      <div style="font-size:11px;font-weight:700;color:${LV_COLORS[lv]||'var(--m)'};margin-bottom:4px">Lv.${lv} ${LV_NAMES[lv]||''}</div>
      <div style="display:flex;flex-wrap:wrap;gap:4px">
        ${ALL_ACTIONS.map(a => `<span style="font-size:9px;padding:2px 6px;border-radius:4px;background:color-mix(in srgb,${allowed.has(a)?'var(--grn)':'var(--m)'} 12%,transparent);color:${allowed.has(a)?'var(--grn)':'var(--m2)'}">${a.replace(/_/g,' ')}</span>`).join('')}
      </div>
    </div>`;
  }).join('');
}

/* ═══════════════════════════════════════════════════════════
   SETTINGS PAGE
══════════════════════════════════════════════════════════════ */
function _renderSettings(channels) {
  const el = document.getElementById('agent-ch-list'); if (!el) return;
  // channels may be Discord channels (key+id shape) or LINE channels (channelId shape)
  const opts = (channels || []).map(ch => {
    const val = ch.key || ch.channelId || '';
    const label = ch.key ? `${ch.key} (${ch.id || ch.channelId || ''})` : ch.channelId;
    return `<option value="${esc(val)}">${esc(label)}</option>`;
  }).join('');
  el.innerHTML = REGISTRY.map(reg => `<div class="agent-ch-row">
    <span class="agent-ch-name">${esc(reg.name)}</span>
    <select class="agent-ch-select" onchange="saveAgentChannel('${reg.id}',this.value)">
      <option value="">— none —</option>
      ${opts}
    </select>
  </div>`).join('');
}

/* ═══════════════════════════════════════════════════════════
   AI PROVIDER MANAGEMENT
══════════════════════════════════════════════════════════════ */
function _syncProviderUI() {
  const sel = document.getElementById('provider-select');
  if (sel) sel.value = ACTIVE_PROVIDER;
}

async function setActiveProvider(value) {
  ACTIVE_PROVIDER = value;
  await fetch(apiUrl('/api/project/provider'), {
    method:'POST', headers:{..._authHeaders(),'Content-Type':'application/json'},
    body: JSON.stringify({ activeProvider: value })
  }).catch(()=>{});
}

async function saveProviderKey() {
  const key = document.getElementById('provider-key-input')?.value.trim();
  if (!key) { alert('Paste an API key first.'); return; }
  const btn = document.querySelector('[onclick="saveProviderKey()"]');
  const statusEl = document.getElementById('provider-key-status');
  if (btn) { btn.disabled = true; btn.textContent = '…'; }
  try {
    const res = await fetch(apiUrl('/api/project/provider'), {
      method:'POST', headers:{..._authHeaders(),'Content-Type':'application/json'},
      body: JSON.stringify({ activeProvider: ACTIVE_PROVIDER, apiKey: key })
    });
    if (!res.ok) throw new Error(res.status);
    document.getElementById('provider-key-input').value = '';
    if (statusEl) statusEl.textContent = `✓ Key saved for ${ACTIVE_PROVIDER}. Restart Cloud Run if overriding env var.`;
    if (btn) { btn.textContent = '✓'; setTimeout(() => { btn.textContent = 'Save'; btn.disabled = false; }, 2000); }
  } catch (e) {
    if (statusEl) statusEl.textContent = `Failed: ${e.message}`;
    if (btn) { btn.textContent = 'ERR'; setTimeout(() => { btn.textContent = 'Save'; btn.disabled = false; }, 2000); }
  }
}

/* ═══════════════════════════════════════════════════════════
   DISCORD CHANNEL MANAGEMENT
══════════════════════════════════════════════════════════════ */
let _discordChannels = [];

async function _loadDiscordChannels() {
  if (!API_BASE) return;
  try {
    const res = await fetch(apiUrl('/api/channels'), { headers: _authHeaders() });
    if (res.status === 401) { _handleUnauthorized(); return; }
    if (!res.ok) return;
    const data = await res.json();
    _discordChannels = Object.entries(data.channels || {}).map(([key, ch]) => ({ key, ...ch }));
    _renderDiscordChannelsList(_discordChannels);
    _renderSettings(_discordChannels); // refresh agent assignment dropdowns with live channel list
  } catch {}
}

function _renderDiscordChannelsList(channels) {
  const el = document.getElementById('discord-channels-list'); if (!el) return;
  if (!channels || !channels.length) {
    el.innerHTML = '<div style="font-size:11px;color:var(--m)">No Discord channels configured.</div>';
    return;
  }
  el.innerHTML = channels.map(ch => `
    <div class="src-row" data-ch-key="${esc(ch.key)}">
      <div class="src-body">
        <div class="src-name">${esc(ch.key)}</div>
        <div class="src-meta">
          <span style="color:var(--m)">${esc(ch.id || ch.channelId || '')}</span>
          <span style="color:${ch.asThread?'#7289DA':'var(--m2)'}">${ch.asThread ? 'thread' : 'post'}</span>
          ${ch.threadName ? `<span style="font-size:9px;color:var(--m)">${esc(ch.threadName)}</span>` : ''}
        </div>
      </div>
      <button class="act-btn cancel" onclick="removeDiscordChannel('${esc(ch.key)}')" style="font-size:8px;padding:2px 8px">✕</button>
    </div>`).join('');
}

async function addDiscordChannel() {
  const key = document.getElementById('new-ch-key')?.value.trim();
  const id  = document.getElementById('new-ch-id')?.value.trim();
  const asThread  = document.getElementById('new-ch-thread')?.checked || false;
  const threadName = document.getElementById('new-ch-threadname')?.value.trim() || undefined;
  if (!key || !id) { alert('Key and Channel ID are required.'); return; }
  const res = await fetch(apiUrl('/api/channels'), {
    method:'POST', headers:{..._authHeaders(),'Content-Type':'application/json'},
    body: JSON.stringify({ key, id, asThread, ...(threadName ? { threadName } : {}) })
  });
  if (res.ok) {
    ['new-ch-key','new-ch-id','new-ch-threadname'].forEach(eId => { const e = document.getElementById(eId); if (e) e.value = ''; });
    const cb = document.getElementById('new-ch-thread'); if (cb) cb.checked = false;
    _loadDiscordChannels();
  } else alert('Failed: ' + res.status);
}

async function removeDiscordChannel(key) {
  if (!confirm(`Remove channel "${key}"?`)) return;
  const row = document.querySelector(`[data-ch-key="${CSS.escape(key)}"]`);
  if (row) row.style.opacity = '0.3';
  const res = await fetch(apiUrl(`/api/channels/${encodeURIComponent(key)}`), {
    method:'DELETE', headers:_authHeaders()
  });
  if (res.ok) _loadDiscordChannels();
  else { if (row) row.style.opacity = ''; alert('Failed: ' + res.status); }
}

async function resetDashLayout() {
  if (!confirm('Reset adaptive panel order back to defaults?')) return;
  await fetch(apiUrl('/api/dashboard/prefs'), { method:'DELETE', headers:_authHeaders() }).catch(()=>{});
  loadDashboard();
}

async function saveAgentChannel(agentId, channelKey) {
  await fetch(apiUrl('/api/agent-channel'), {
    method:'POST', headers:{..._authHeaders(),'Content-Type':'application/json'},
    body: JSON.stringify({ agentId, channelKey: channelKey || '' })
  }).catch(()=>{});
}

/* ═══════════════════════════════════════════════════════════
   LOCATION PILL + MODAL
══════════════════════════════════════════════════════════════ */
function _renderLocationPill() {
  const lp = LOCATION_PROFILE;
  const pill = document.getElementById('location-pill');
  if (pill) {
    const label = lp?.city ? `📍 ${lp.city}${lp.countryCode ? ', ' + lp.countryCode : ''}` : '📍 —';
    pill.textContent = label;
  }
  const det = document.getElementById('location-detail');
  if (det && lp) {
    det.innerHTML = `<b>${esc(lp.city||'?')}, ${esc(lp.country||'?')}</b><br>
      ${lp.timezone ? esc(lp.timezone) + '<br>' : ''}
      ${lp.confidence ? 'Confidence: ' + esc(lp.confidence) + '<br>' : ''}
      ${lp.userOverride ? '<span style="color:var(--grn)">Manual override</span><br>' : ''}
      ${lp.reasoning ? '<span style="font-size:10px;color:var(--m)">' + esc(lp.reasoning.substring(0,100)) + '…</span>' : ''}`;
    const ci = document.getElementById('loc-city-input'), coi = document.getElementById('loc-country-input');
    if (ci) ci.value = lp.city || ''; if (coi) coi.value = lp.countryCode || '';
  }
}

async function saveLocationOverride() {
  const city = document.getElementById('loc-city-input')?.value.trim();
  const cc = document.getElementById('loc-country-input')?.value.trim().toUpperCase();
  if (!city) { alert('City is required.'); return; }
  const res = await fetch(apiUrl('/api/project/location'), {
    method:'POST', headers:{..._authHeaders(),'Content-Type':'application/json'},
    body: JSON.stringify({ city, countryCode:cc || null, userOverride:true })
  });
  if (!res.ok) { alert('Save failed: ' + res.status); return; }
  loadDashboard();
}

async function clearLocationOverride() {
  if (!confirm('Clear manual override? Auto-inference will resume.')) return;
  await fetch(apiUrl('/api/project/location'), {
    method:'POST', headers:{..._authHeaders(),'Content-Type':'application/json'},
    body: JSON.stringify({ clearOverride:true })
  }).catch(()=>{});
  loadDashboard();
}

function closeLocOverlay(e) {
  if (!e || e.target === document.getElementById('loc-overlay')) {
    document.getElementById('loc-overlay')?.classList.remove('open');
  }
}

/* ═══════════════════════════════════════════════════════════
   FLASH LIST + SETTINGS
══════════════════════════════════════════════════════════════ */
function _renderFlashList() {
  const el = document.getElementById('flash-list'); if (!el) return;
  el.innerHTML = REGISTRY.map(reg => {
    const isFlash = FORCE_FLASH || (LEVEL_OVERRIDES && LEVEL_OVERRIDES[reg.id] === 'flash');
    return `<div style="display:flex;align-items:center;justify-content:space-between;padding:4px 8px;font-size:11px">
      <span style="color:var(--txt)">${esc(reg.name)}</span>
      <button class="flash-toggle ${isFlash?'active':'inactive'}" style="font-size:9px;padding:3px 8px" onclick="toggleAgentFlash('${reg.id}',this)">
        ${isFlash ? '⚡ Flash' : 'Pro'}
      </button>
    </div>`;
  }).join('');
}

async function toggleFlashGlobal() {
  await fetch(apiUrl('/api/project/settings'), {
    method:'POST', headers:{..._authHeaders(),'Content-Type':'application/json'},
    body: JSON.stringify({ forceFlash: !FORCE_FLASH })
  }).catch(()=>{});
  loadDashboard();
}

async function toggleAgentFlash(agentId, btn) {
  btn.disabled = true;
  const cur = btn.classList.contains('active');
  await fetch(apiUrl(`/api/agents/${agentId}/settings`), {
    method:'POST', headers:{..._authHeaders(),'Content-Type':'application/json'},
    body: JSON.stringify({ forceFlash: !cur })
  }).catch(()=>{});
  loadDashboard();
}

async function setIntensity(value) {
  if (!value || value === INTENSITY_MODE) return;
  const sel = document.getElementById('intensity-select');
  const selS = document.getElementById('intensity-select-s');
  if (sel) sel.value = value; if (selS) selS.value = value;
  await fetch(apiUrl('/api/project/intensity'), {
    method:'POST', headers:{..._authHeaders(),'Content-Type':'application/json'},
    body: JSON.stringify({ intensityMode: value })
  }).catch(()=>{});
  INTENSITY_MODE = value;
}

/* ═══════════════════════════════════════════════════════════
   AGENT DETAIL OVERLAY
══════════════════════════════════════════════════════════════ */
function openDetail(id) {
  const reg = REGISTRY.find(r => r.id === id), d = DETAIL_DATA[id]; if (!reg || !d) return;
  const pct = Math.min(100, Math.round(((d.tokensUsed||0)/(d.tokenLimit||1))*100));
  const bc = pct > 80 ? '#EF4444' : pct > 50 ? '#FBBF24' : reg.colors[0];
  const lc = LV_COLORS[d.level || 1];
  const myFlows = FLOWS.filter(f => f.agents.includes(id));

  document.getElementById('detail-content').innerHTML = `
    <div class="p-header">
      <canvas id="detailCanvas" width="${DS*8}" height="${DS*8}" style="image-rendering:pixelated;flex-shrink:0"></canvas>
      <div>
        <div class="p-title">${esc(id.replace(/-/g,' ').replace(/\b\w/g,c=>c.toUpperCase()))}</div>
        <div class="p-sub">${esc(d.category||'')} · ${esc(d.agentType||'')} · Lv.${d.level||1} ${LV_NAMES[d.level]||''}</div>
      </div>
    </div>
    <div class="p-section"><div class="p-label">Description</div><div class="p-value">${esc(d.fullDesc||d.desc||'')}</div></div>
    <div class="p-row">
      <div class="p-stat"><div class="s-label">Model</div><div class="s-value" style="font-size:9px">${esc(d.model||reg.model||'')}</div></div>
      <div class="p-stat"><div class="s-label">Level</div><div class="s-value" style="color:${lc}">Lv.${d.level||1}</div></div>
      <div class="p-stat"><div class="s-label">Status</div><div class="s-value" style="color:${d.enabled!==false?'#34D399':'#EF4444'};font-size:9px">
        ${d.enabled!==false?'ENABLED':'DISABLED'}
        <button class="act-btn ${d.enabled!==false?'cancel':'resume'}" onclick="toggleAgent('${id}',event)" style="font-size:9px;padding:2px 8px;margin-left:4px">${d.enabled!==false?'Disable':'Enable'}</button>
      </div></div>
      <div class="p-stat"><div class="s-label">Next Run</div><div class="s-value" style="font-size:9px">${esc(nextRun(d.frequency||reg.frequency||''))}</div></div>
    </div>
    <div class="p-section">
      <div class="p-label">Token budget</div>
      <div class="p-bar-wrap"><div class="p-bar-fill" style="width:${pct}%;background:${bc}"></div></div>
      <div style="font-size:10px;color:var(--m);margin-top:3px">
        ${d.tokensUsed>=1000?(d.tokensUsed/1000).toFixed(1)+'k':d.tokensUsed||0} / ${((d.tokenLimit||0)/1000).toFixed(0)}k (${pct}%)
        ${d.estimatedCost>0?` · ≈$${d.estimatedCost.toFixed(4)}`:'' }
      </div>
    </div>
    ${myFlows.length ? `<div class="p-section"><div class="p-label">In Flows</div>${myFlows.map(f=>`<div style="font-size:9px;margin-top:4px;color:${f.color}">${esc(f.name)}: ${f.agents.map(a=>{const r=REGISTRY.find(x=>x.id===a);return a===id?`<b>[${esc(r?.name||a)}]</b>`:`<span style="color:var(--m)">${esc(r?.name||a)}</span>`;}).join(' → ')}</div>`).join('')}</div>` : ''}
    ${(d.tools||reg.tools||[]).length ? `<div class="p-section"><div class="p-label">Tools</div><div style="display:flex;flex-wrap:wrap;gap:4px;margin-top:4px">${(d.tools||reg.tools||[]).map(t=>`<span style="font-size:9px;padding:2px 6px;border-radius:4px;background:var(--accent-bg);color:var(--acc)">${esc(t)}</span>`).join('')}</div></div>` : ''}
    ${d.task ? `<div class="p-task" style="margin-top:12px"><div class="t-label">Last task</div><div class="t-value">[${(d.task.status||'').toUpperCase()}] ${esc(d.task.goal||'—')}</div><div class="t-value" style="margin-top:3px;color:var(--m)">Created: ${fmtDate(d.task.createdAt)} · Updated: ${fmtDate(d.task.updatedAt)}</div>${d.task.error?`<div style="color:var(--error);font-size:10px;margin-top:4px">${esc(d.task.error.substring(0,150))}</div>`:''}</div>` : ''}
  `;

  // Draw avatar
  const dc = document.getElementById('detailCanvas');
  if (dc) drawGrid(dc.getContext('2d'), AVATARS[reg.avatar], cmap(reg.colors), false, DS);

  document.getElementById('detail-overlay').classList.add('open');
}

function closeDetail() { document.getElementById('detail-overlay').classList.remove('open'); }
function closeDetailIfBg(e) { if (e.target === document.getElementById('detail-overlay')) closeDetail(); }

/* ═══════════════════════════════════════════════════════════
   TASK MODALS
══════════════════════════════════════════════════════════════ */
let _taskModal = null;

function openTaskModal(status) {
  const tasks = ALL_BY_STATUS[status] || [];
  // Reuse detail overlay
  const title = `${status.charAt(0).toUpperCase()+status.slice(1)} Tasks (${tasks.length})`;
  document.getElementById('detail-content').innerHTML = `
    <div class="p-title">${esc(title)}</div>
    <div style="margin-top:14px">
      ${tasks.length ? tasks.map(t => `<div class="tl-item" ${t.id ? `onclick="openTaskDetail('${t.id}')" style="cursor:pointer"`:''}>
        <div class="feed-dot ${t.status}" style="margin-top:4px;flex-shrink:0"></div>
        <div class="tl-body">
          <div class="tl-goal">${esc(t.goal)}</div>
          <div class="tl-meta"><span class="tl-type">${esc((t.type||'').replace(/_/g,' '))}</span> · ${fmtDate(t.createdAt)}</div>
          ${t.error ? `<div style="color:var(--error);font-size:10px">${esc(t.error.substring(0,80))}</div>` : ''}
        </div>
        ${status==='pending'&&t.id?`<button class="act-btn cancel" onclick="doTaskAction('${t.id}','cancel',this)">✕</button>`:''}
        ${status==='running'&&t.id?`<button class="act-btn stop" onclick="doTaskAction('${t.id}','stop',this)">⏹</button>`:''}
        ${(status==='failed'||status==='cancelled')&&t.id?`<button class="act-btn resume" onclick="doTaskAction('${t.id}','resume',this)">↻</button>`:''}
      </div>`).join('') : '<div style="color:var(--m);font-size:11px;padding:8px">No tasks.</div>'}
    </div>`;
  document.getElementById('detail-overlay').classList.add('open');
}

function openTaskDetail(taskId) {
  const all = [...(TASK_STATS.recent||[]), ...(TASK_STATS.upcoming||[]), ...Object.values(ALL_BY_STATUS).flat()];
  const t = all.find(x => x.id === taskId); if (!t) return;
  const colors = { completed:'#34D399', running:'#22D3EE', failed:'#EF4444', pending:'#64748B', cancelled:'#6B7280' };
  document.getElementById('detail-content').innerHTML = `
    <div class="p-header">
      <div style="width:12px;height:12px;border-radius:50%;background:${colors[t.status]||'#64748B'};flex-shrink:0;margin-top:4px"></div>
      <div>
        <div class="p-title">${esc(t.status.toUpperCase())} — ${esc((t.type||'').replace(/_/g,' '))}</div>
        <div class="p-sub">${agentChip(t.type)} ${t.id ? t.id.substring(0,12) : ''}</div>
      </div>
    </div>
    <div class="p-section"><div class="p-label">Goal</div><div class="p-value">${esc(t.goal||'—')}</div></div>
    <div class="p-row">
      ${t.priority!=null?`<div class="p-stat"><div class="s-label">Priority</div><div class="s-value">P${t.priority}</div></div>`:''}
      ${t.createdAt?`<div class="p-stat"><div class="s-label">Created</div><div class="s-value" style="font-size:9px">${fmtDate(t.createdAt)}</div></div>`:''}
      ${t.updatedAt?`<div class="p-stat"><div class="s-label">Updated</div><div class="s-value" style="font-size:9px">${fmtDate(t.updatedAt)}</div></div>`:''}
      ${t.reviewScore!=null?`<div class="p-stat"><div class="s-label">Review</div><div class="s-value" style="color:var(--grn)">${t.reviewScore}/10</div></div>`:''}
    </div>
    ${t.result?`<div class="p-section"><div class="p-label">Result</div><div class="p-value" style="white-space:pre-wrap;font-size:11px">${esc(t.result.substring(0,500))}</div></div>`:''}
    ${t.error?`<div class="p-section"><div class="p-label" style="color:var(--error)">Error</div><div class="p-value" style="color:var(--error)">${esc(t.error)}</div></div>`:''}
    ${t.branch?`<div class="p-section"><div class="p-label">Branch</div><div class="p-value" style="font-family:monospace">${esc(t.branch)}</div></div>`:''}
    ${t.prUrl?`<div class="p-section"><div class="p-label">PR</div><div class="p-value"><a href="${esc(t.prUrl)}" target="_blank" rel="noopener" style="color:var(--acc)">${esc(t.prUrl)}</a></div></div>`:''}
    <div style="display:flex;gap:8px;margin-top:16px">
      ${t.status==='pending'?`<button class="act-btn cancel" onclick="doTaskAction('${t.id}','cancel',this)">✕ Cancel</button>`:''}
      ${t.status==='running'?`<button class="act-btn stop" onclick="doTaskAction('${t.id}','stop',this)">⏹ Stop</button>`:''}
      ${(t.status==='failed'||t.status==='cancelled')?`<button class="act-btn resume" onclick="doTaskAction('${t.id}','resume',this)">↻ Resume</button>`:''}
    </div>`;
  document.getElementById('detail-overlay').classList.add('open');
}

/* ═══════════════════════════════════════════════════════════
   ACTION HANDLERS
══════════════════════════════════════════════════════════════ */
async function doTaskAction(taskId, action, btn) {
  btn.disabled = true; const orig = btn.textContent; btn.textContent = '…';
  try {
    const r = await fetch(apiUrl(`/api/tasks/${taskId}/action`), {
      method:'POST', headers:{..._authHeaders(),'Content-Type':'application/json'}, body:JSON.stringify({action})
    });
    const j = await r.json();
    if (j.ok) { btn.textContent = '✓'; btn.style.color = '#34D399'; setTimeout(() => loadDashboard(), 800); }
    else { btn.textContent = j.error || 'ERR'; btn.style.color = 'var(--error)'; setTimeout(()=>{ btn.textContent=orig; btn.style.color=''; btn.disabled=false; }, 2000); }
  } catch { btn.textContent = 'ERR'; btn.style.color = 'var(--error)'; setTimeout(()=>{ btn.textContent=orig; btn.style.color=''; btn.disabled=false; }, 2000); }
}

async function toggleAgent(agentId, e) {
  if (e && e.stopPropagation) e.stopPropagation();
  const d = DETAIL_DATA[agentId]; const current = d ? d.enabled !== false : true;
  if (e && e.target) e.target.disabled = true;
  await fetch(apiUrl(`/api/agents/${agentId}/settings`), {
    method:'POST', headers:{..._authHeaders(),'Content-Type':'application/json'}, body:JSON.stringify({ enabled: !current })
  }).catch(()=>{});
  loadDashboard();
}

async function toggleSource(id, enabled) {
  const row = document.querySelector(`.src-row[data-id="${id}"]`);
  const dot = row?.querySelector('.src-toggle');
  if (dot) { dot.classList.toggle('on', enabled); dot.classList.toggle('off', !enabled); }
  await fetch(apiUrl(`/api/sources/${id}`), {
    method:'PATCH', headers:{..._authHeaders(),'Content-Type':'application/json'}, body:JSON.stringify({ enabled })
  }).catch(()=>{});
}

async function blockSource(id) {
  const reason = prompt('Block reason:', 'manually blocked'); if (!reason) return;
  const row = document.querySelector(`.src-row[data-id="${id}"]`); if (row) row.style.opacity = '0.3';
  await fetch(apiUrl(`/api/sources/${id}/block`), {
    method:'POST', headers:{..._authHeaders(),'Content-Type':'application/json'}, body:JSON.stringify({ reason })
  }).catch(()=>{});
  loadDashboard();
}

async function unblockSource(id) {
  if (!confirm('Unblock this source?')) return;
  await fetch(apiUrl(`/api/sources/${id}/unblock`), { method:'POST', headers:_authHeaders() }).catch(()=>{});
  loadDashboard();
}

async function inboxDone(id) {
  const row = document.querySelector(`[data-id="${id}"]`); if (row) row.style.opacity = '0.3';
  await fetch(apiUrl(`/api/inbox/${id}/done`), { method:'POST', headers:_authHeaders() }).catch(()=>{});
  row?.remove();
}

async function inboxIgnore(id) {
  if (!confirm('Dismiss without resolving?')) return;
  const row = document.querySelector(`[data-id="${id}"]`); if (row) row.style.opacity = '0.3';
  await fetch(apiUrl(`/api/inbox/${id}/ignore`), { method:'POST', headers:_authHeaders() }).catch(()=>{});
  row?.remove();
}

async function markMerged(id) {
  if (!confirm('Mark as merged?')) return;
  const res = await fetch(apiUrl(`/api/merges/${encodeURIComponent(id)}/mark-merged`), { method:'POST', headers:_authHeaders() });
  if (res.ok) { const row = document.querySelector(`[data-merge-id="${id}"]`); row?.remove(); }
}

async function dismissMerge(id) {
  if (!confirm('Dismiss this suggestion?')) return;
  const res = await fetch(apiUrl(`/api/merges/${encodeURIComponent(id)}/dismiss`), { method:'POST', headers:_authHeaders() });
  if (res.ok) { const row = document.querySelector(`[data-merge-id="${id}"]`); row?.remove(); }
}

async function researchFollowup(pageSlug, question, btn) {
  btn.disabled = true; btn.textContent = '…';
  const res = await fetch(apiUrl('/api/wiki/followup'), {
    method:'POST', headers:{..._authHeaders(),'Content-Type':'application/json'}, body:JSON.stringify({ pageSlug, question, mode:'queue' })
  });
  if (res.ok) { btn.textContent = '✓ Queued'; btn.closest('div').parentElement?.style.setProperty('opacity','0.4'); }
  else { btn.disabled = false; btn.textContent = '🔬 Research'; }
}

async function dismissFollowup(pageSlug, question, btn) {
  btn.disabled = true; btn.textContent = '…';
  const res = await fetch(apiUrl('/api/wiki/followup'), {
    method:'POST', headers:{..._authHeaders(),'Content-Type':'application/json'}, body:JSON.stringify({ pageSlug, question, mode:'dismiss' })
  });
  if (res.ok) btn.closest('div').parentElement?.remove();
  else { btn.disabled = false; btn.textContent = '✕'; }
}

async function deleteVault(id) {
  if (!confirm(`Remove vault "${id}"? GitHub repo is NOT deleted.`)) return;
  const res = await fetch(apiUrl(`/api/vaults/${encodeURIComponent(id)}`), { method:'DELETE', headers:_authHeaders() });
  if (res.ok) { const row = document.querySelector(`[data-vault-id="${id}"]`); row?.remove(); }
}

async function runBase(id) {
  const resEl = document.getElementById('baseResult-' + id); if (resEl) { resEl.style.display = 'block'; resEl.textContent = 'Running…'; }
  const res = await fetch(apiUrl(`/api/bases/${encodeURIComponent(id)}/run`), { method:'POST', headers:_authHeaders() }).catch(()=>null);
  if (!resEl) return;
  if (!res || !res.ok) { resEl.textContent = 'Run failed: ' + (res?.status || 'error'); return; }
  const data = await res.json().catch(()=>({}));
  resEl.textContent = JSON.stringify(data, null, 2);
}

async function deleteBase(id) {
  if (!confirm(`Delete base "${id}"?`)) return;
  const res = await fetch(apiUrl(`/api/bases/${encodeURIComponent(id)}`), { method:'DELETE', headers:_authHeaders() });
  if (res.ok) { const row = document.querySelector(`[data-base-slug="${id}"]`); row?.remove(); }
}

/* ═══════════════════════════════════════════════════════════
   BADGES (nav + mobile)
══════════════════════════════════════════════════════════════ */
function _renderBadges() {
  const pendingCount = (TASK_STATS.upcoming || []).length;
  const inboxCount = (window._inboxData?.pending || []).length;

  ['tasks-badge','mob-tasks-badge'].forEach(id => {
    const el = document.getElementById(id); if (!el) return;
    el.textContent = pendingCount || '';
    el.style.display = pendingCount > 0 ? '' : 'none';
  });
  ['inbox-badge','mob-inbox-badge'].forEach(id => {
    const el = document.getElementById(id); if (!el) return;
    el.textContent = inboxCount || '';
    el.style.display = inboxCount > 0 ? '' : 'none';
  });
}

/* ═══════════════════════════════════════════════════════════
   ANALYTICS CHARTS (canvas)
══════════════════════════════════════════════════════════════ */
let _chartMode = 'bar', _chartInited = false;
const _CD = { days:[], linesOn:{total:true,done:true,failed:true,flash:true,pro:true,cost:true}, hoverDay:null, maxV:1, costMax:0.01, flashFrac:.5, PL:32, PR:42, PT:14, PB:38, H:215, W:0 };
const _LINES = [
  {key:'total', color:'#60A5FA',width:2,   fill:true,  dash:null, dk:'total'},
  {key:'done',  color:'#34D399',width:1.5, fill:false, dash:null, dk:'completed'},
  {key:'failed',color:'#EF4444',width:1.5, fill:false, dash:null, dk:'failed'},
  {key:'flash', color:'#22D3EE',width:1,   fill:false, dash:[4,3],dk:'flash'},
  {key:'pro',   color:'#A78BFA',width:1,   fill:false, dash:[4,3],dk:'pro'},
  {key:'cost',  color:'#FBBF24',width:1.5, fill:false, dash:null, dk:'cost', axis:'right'},
];

function _initCharts() {
  if (!document.getElementById('cost-chart')) return;
  _buildDays();
  drawCostChart();
}

function _buildDays() {
  let ft = 0, pt = 0;
  for (const [type, cnt] of Object.entries(TASK_STATS.byType || {})) {
    if (TASK_MODEL_MAP[type] === 'flash') ft += cnt; else pt += cnt;
  }
  _CD.flashFrac = (ft+pt) > 0 ? ft/(ft+pt) : .5;
  _CD.days = [];
  for (let i = 6; i >= 0; i--) {
    const d = new Date(Date.now() - i*86400000);
    const key = d.toISOString().split('T')[0];
    const label = ['Su','Mo','Tu','We','Th','Fr','Sa'][d.getDay()];
    const co = TASK_STATS.byDay?.[key]?.completed||0, fa = TASK_STATS.byDay?.[key]?.failed||0, tot = co+fa;
    const cost = COST_BY_DAY?.[key] || 0;
    _CD.days.push({key,label,completed:co,failed:fa,total:tot,flash:Math.round(tot*_CD.flashFrac),pro:Math.round(tot*(1-_CD.flashFrac)),cost});
  }
  _CD.maxV = Math.max(1,..._CD.days.map(d=>d.total));
  _CD.costMax = Math.max(0.01,..._CD.days.map(d=>d.cost));
}

function _chartTheme() {
  const cs = getComputedStyle(document.documentElement), g = v => cs.getPropertyValue(v).trim();
  return { bg:g('--bg')||'#e7eaf1', grid:g('--div')||'#ccd3e0', axis:g('--m')||'#5c6478', label:g('--m2')||'#717b92', txt:g('--txt')||'#2b3350', warn:g('--yel')||'#f59e0b' };
}

function setCostTab(el, mode) {
  _chartMode = mode;
  document.querySelectorAll('.chart-tab[data-ctab]').forEach(t => t.classList.toggle('active', t === el));
  const lt = document.getElementById('line-toggles'); if (lt) lt.classList.toggle('hidden', mode !== 'line');
  if (mode === 'bar') drawCostChart();
  else if (mode === 'line') drawLineChart(null, null, null);
}

function drawCostChart() {
  const lc = document.getElementById('cost-chart'); if (!lc) return;
  const dpr = window.devicePixelRatio||1, par = lc.parentElement;
  const W = par ? par.clientWidth - 28 : 500, H = 160, PL=40, PR=12, PT=10, PB=30;
  lc.width = W*dpr; lc.height = H*dpr; lc.style.width = W+'px'; lc.style.height = H+'px';
  const ctx = lc.getContext('2d'); ctx.scale(dpr, dpr);
  const CT = _chartTheme();
  ctx.fillStyle = CT.bg; ctx.fillRect(0,0,W,H);
  const CW = W-PL-PR, CH = H-PT-PB;
  const days = _CD.days, n = days.length, barW = Math.max(4, CW/n*.6), gap = CW/n;
  const maxV = Math.max(1, ...days.map(d => d.total));
  days.forEach((d, i) => {
    const x = PL + i*gap + gap/2 - barW/2, bh = (d.total/maxV)*CH;
    ctx.fillStyle = '#60A5FA66'; ctx.fillRect(x, PT+CH-bh, barW, bh);
    const fh = (d.failed/maxV)*CH;
    if (fh > 0) { ctx.fillStyle = '#EF444466'; ctx.fillRect(x, PT+CH-fh, barW, fh); }
    const isH = d.key === _CD.hoverDay;
    ctx.fillStyle = isH ? CT.txt : CT.label; ctx.font = (isH ? 'bold ' : '') + '9px Courier New';
    ctx.textAlign = 'center'; ctx.fillText(d.label, x+barW/2, H-PB+13);
    if (d.total > 0) { ctx.fillStyle = CT.axis; ctx.font = '8px Courier New'; ctx.fillText(d.total, x+barW/2, PT+CH-bh-2); }
  });
  // Left axis
  [0,.5,1].forEach(r => {
    const y = PT+CH*(1-r); ctx.fillStyle = CT.label; ctx.font = '8px Courier New'; ctx.textAlign = 'right';
    ctx.fillText(Math.round(maxV*r), PL-3, y+3);
    ctx.strokeStyle = CT.grid; ctx.lineWidth = .5; ctx.beginPath(); ctx.moveTo(PL,y); ctx.lineTo(W-PR,y); ctx.stroke();
  });
}

function drawLineChart(hoverDay, cxX, hovLine) {
  const lc = document.getElementById('cost-chart'); if (!lc) return;
  const dpr = window.devicePixelRatio||1, par = lc.parentElement;
  const W = par ? par.clientWidth-28 : 500, H = _CD.H; _CD.W = W;
  lc.width = W*dpr; lc.height = H*dpr; lc.style.width = W+'px'; lc.style.height = H+'px';
  const ctx = lc.getContext('2d'); ctx.scale(dpr, dpr);
  const {PL,PR,PT,PB} = _CD, CW = W-PL-PR, CH = H-PT-PB, maxV = _CD.maxV;
  const CT = _chartTheme();
  ctx.fillStyle = CT.bg; ctx.fillRect(0,0,W,H);
  const hdi = hoverDay ? _CD.days.findIndex(d=>d.key===hoverDay) : -1;
  if (hdi >= 0) { ctx.fillStyle='rgba(128,128,128,.07)'; ctx.fillRect(PL+hdi*(CW/6)-CW/12,PT,CW/6,CH); }
  [0,.25,.5,.75,1].forEach(r => {
    const y = PT+CH*(1-r);
    ctx.strokeStyle = CT.grid; ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(PL,y); ctx.lineTo(W-PR,y); ctx.stroke();
    if (r > 0) { ctx.fillStyle = CT.axis; ctx.font = '9px Courier New'; ctx.textAlign = 'right'; ctx.fillText(Math.round(maxV*r), PL-3, y+3); }
  });
  _CD.days.forEach((d,i) => {
    const x = PL+i*(CW/6), isH = d.key === hoverDay;
    ctx.fillStyle = isH ? CT.txt : CT.label; ctx.font = (isH?'bold ':'')+'10px Courier New'; ctx.textAlign = 'center';
    ctx.fillText(d.label, x, H-PB+12);
  });
  _LINES.forEach(ls => {
    if (!_CD.linesOn[ls.key]) return;
    const scale = ls.axis === 'right' ? _CD.costMax : maxV; if (scale <= 0) return;
    const isHov = ls.key === hovLine;
    const pts = _CD.days.map((d,i) => ({x:PL+i*(CW/6), y:PT+CH*(1-(d[ls.dk]||0)/scale)}));
    ctx.strokeStyle = ls.color; ctx.lineWidth = isHov ? ls.width*2.5 : ls.width;
    ctx.globalAlpha = (hovLine && !isHov) ? .4 : 1;
    if (ls.dash) ctx.setLineDash(ls.dash); else ctx.setLineDash([]);
    ctx.beginPath();
    pts.forEach((p,i) => { if (i===0) ctx.moveTo(p.x,p.y); else { const prev=pts[i-1],mx=(prev.x+p.x)/2; ctx.bezierCurveTo(mx,prev.y,mx,p.y,p.x,p.y); } });
    ctx.stroke(); ctx.setLineDash([]);
    pts.forEach(p => { ctx.fillStyle=ls.color; ctx.beginPath(); ctx.arc(p.x,p.y,isHov?3.5:2.5,0,Math.PI*2); ctx.fill(); });
    ctx.globalAlpha = 1;
  });
}

window.addEventListener('themechange', () => { if (_chartMode==='bar') drawCostChart(); else drawLineChart(null,null,null); });

/* ═══════════════════════════════════════════════════════════
   DOCS VIEWER
══════════════════════════════════════════════════════════════ */
let _docsInited = false, _activeDoc = null;

function _renderDocsTree(sections) {
  const el = document.getElementById('docs-tree'); if (!el) return;
  if (!sections || !sections.length) { el.innerHTML = '<div class="docs-welcome" style="font-size:11px">No docs configured.</div>'; return; }
  el.innerHTML = sections.map(sec => `
    <div class="docs-section">
      <div class="docs-section-label">${esc(sec.label || 'General')}</div>
      ${(sec.docs || []).map(d => `<button class="docs-tree-item" data-doc-slug="${esc(d.slug||'')}" onclick="loadDoc(this,'${esc(d.slug||'')}','${esc(d.title||d.slug||'')}')">${esc(d.title||d.slug||'')}</button>`).join('')}
    </div>`).join('');
}

async function _initDocsIfNeeded() {
  if (_docsInited || !API_BASE) return;
  _docsInited = true;
  const el = document.getElementById('docs-tree');
  if (el) el.innerHTML = '<div class="docs-welcome" style="font-size:11px">Loading…</div>';
  try {
    const res = await fetch(apiUrl('/api/docs/list'), { headers: _authHeaders() });
    if (res.status === 401) { _handleUnauthorized(); return; }
    const data = await res.json();
    _renderDocsTree(data.sections || []);
  } catch (e) {
    if (el) el.innerHTML = `<div class="docs-welcome" style="font-size:11px;color:var(--error)">Failed to load docs</div>`;
  }
}

async function loadDoc(btn, path, label) {
  if (!path) return;
  document.querySelectorAll('.docs-tree-item').forEach(b => b.classList.toggle('active', b === btn));
  const reader = document.getElementById('docs-reader');
  reader.innerHTML = '<div class="docs-loading">Loading…</div>';
  try {
    const res = await fetch(apiUrl(`/api/docs/file?slug=${encodeURIComponent(path)}`), { headers: _authHeaders() });
    if (!res.ok) throw new Error(res.status);
    const data = await res.json();
    reader.innerHTML = `<div class="docs-content"><h1>${esc(label)}</h1>${_markdownToHtml(data.content || '')}</div>`;
    if (window.mermaid) {
      const nodes = reader.querySelectorAll('.mermaid');
      if (nodes.length) mermaid.run({ nodes }).catch(() => {});
    }
  } catch (e) {
    reader.innerHTML = `<div class="docs-welcome" style="color:var(--error)">Failed to load: ${esc(e.message)}</div>`;
  }
}

function _markdownToHtml(md) {
  // Extract fenced code/mermaid blocks before any escaping
  const blocks = [];
  md = md.replace(/```(\w*)\r?\n([\s\S]*?)```/g, (_, lang, code) => {
    const idx = blocks.length;
    const safe = code.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/\n$/,'');
    if (lang === 'mermaid') {
      blocks.push(`<div class="mermaid">${safe}</div>`);
    } else {
      const cls = lang ? ` class="language-${lang}"` : '';
      blocks.push(`<pre><code${cls}>${safe}</code></pre>`);
    }
    return `\x00BLK${idx}\x00`;
  });

  // HTML-escape remaining text
  md = md.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');

  const out = [], lines = md.split('\n');
  let inUl = false, inOl = false, inPara = false;
  const flush = () => {
    if (inUl)  { out.push('</ul>');  inUl  = false; }
    if (inOl)  { out.push('</ol>');  inOl  = false; }
    if (inPara){ out.push('</p>');   inPara = false; }
  };

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (/^\x00BLK\d+\x00$/.test(line.trim())) { flush(); out.push(line.trim()); continue; }
    if (!line.trim()) { flush(); continue; }

    // Headings
    const hm = line.match(/^(#{1,3}) (.+)$/);
    if (hm) { flush(); out.push(`<h${hm[1].length}>${_inline(hm[2])}</h${hm[1].length}>`); continue; }

    // Blockquote
    const bq = line.match(/^&gt; (.+)$/);
    if (bq) { flush(); out.push(`<blockquote>${_inline(bq[1])}</blockquote>`); continue; }

    // HR
    if (/^[-*_]{3,}$/.test(line.trim())) { flush(); out.push('<hr>'); continue; }

    // Unordered list
    const ul = line.match(/^\s*[-*+] (.+)$/);
    if (ul) {
      if (inPara) { out.push('</p>'); inPara = false; }
      if (inOl)   { out.push('</ol>'); inOl = false; }
      if (!inUl)  { out.push('<ul>'); inUl = true; }
      out.push(`<li>${_inline(ul[1])}</li>`); continue;
    }

    // Ordered list
    const ol = line.match(/^\s*\d+\. (.+)$/);
    if (ol) {
      if (inPara) { out.push('</p>'); inPara = false; }
      if (inUl)   { out.push('</ul>'); inUl = false; }
      if (!inOl)  { out.push('<ol>'); inOl = true; }
      out.push(`<li>${_inline(ol[1])}</li>`); continue;
    }

    // Table header row (followed by separator)
    if (line.startsWith('|') && (lines[i+1]||'').match(/^\|[-| :]+\|$/)) {
      flush();
      const cols = line.split('|').slice(1,-1);
      out.push(`<table><thead><tr>${cols.map(c=>`<th>${_inline(c.trim())}</th>`).join('')}</tr></thead><tbody>`);
      i++; continue; // skip separator line
    }
    // Table body row
    if (line.startsWith('|') && line.endsWith('|') && out.length && (out[out.length-1].endsWith('</tr>') || out[out.length-1].endsWith('<tbody>'))) {
      const cols = line.split('|').slice(1,-1);
      out.push(`<tr>${cols.map(c=>`<td>${_inline(c.trim())}</td>`).join('')}</tr>`);
      if (!(lines[i+1]||'').startsWith('|')) out.push('</tbody></table>');
      continue;
    }

    // Regular paragraph text
    if (inUl) { out.push('</ul>'); inUl = false; }
    if (inOl) { out.push('</ol>'); inOl = false; }
    if (!inPara) { out.push('<p>'); inPara = true; } else out.push('<br>');
    out.push(_inline(line));
  }
  flush();

  return out.join('').replace(/\x00BLK(\d+)\x00/g, (_, i) => blocks[+i]);
}

function _inline(text) {
  return text
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/\*(.+?)\*/g, '<em>$1</em>')
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2" target="_blank" rel="noopener">$1</a>');
}

/* ═══════════════════════════════════════════════════════════
   TELEMETRY
══════════════════════════════════════════════════════════════ */
(function initTelemetry() {
  const FLUSH_INTERVAL = 30000, MAX_BATCH = 50;
  let _buf = [], _lastActive = Date.now(), _idle = false, _timer = null;
  const _isIdle = () => _idle;

  document.addEventListener('click', e => {
    _lastActive = Date.now(); _idle = false;
    const tgt = e.target.closest('[data-panel-id]');
    if (tgt) push('click', { panelId:tgt.dataset.panelId });
  });
  ['mousemove','keydown','scroll'].forEach(ev => document.addEventListener(ev, () => { _lastActive = Date.now(); _idle = false; }, { passive:true }));

  setInterval(() => { if (Date.now() - _lastActive > 60000) _idle = true; }, 10000);

  function push(type, data) {
    _buf.push({ type, ...data, ts: Date.now() });
    if (_buf.length >= MAX_BATCH) flush();
  }

  function flush() {
    if (!_buf.length || _isIdle()) return;
    const batch = _buf.splice(0, MAX_BATCH);
    const payload = JSON.stringify({ events: batch });
    // sendBeacon doesn't support headers; use keepalive fetch with Bearer token instead
    fetch(apiUrl('/api/activity'), { method:'POST', keepalive:true, headers:{..._authHeaders(),'Content-Type':'application/json'}, body:payload }).catch(()=>{});
  }

  _timer = setInterval(() => { if (!_isIdle()) flush(); }, FLUSH_INTERVAL);
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') flush(); });

  // Panel dwell tracking
  const dwellStart = {};
  const obs = new IntersectionObserver(entries => {
    entries.forEach(en => {
      const id = en.target.dataset.panelId; if (!id) return;
      if (en.isIntersecting) { dwellStart[id] = Date.now(); push('panel_view', {panelId:id}); }
      else if (dwellStart[id]) { push('panel_dwell', {panelId:id, ms:Date.now()-dwellStart[id]}); delete dwellStart[id]; }
    });
  }, { threshold:0.2 });
  document.querySelectorAll('[data-panel-id]').forEach(el => obs.observe(el));
})();

/* ═══════════════════════════════════════════════════════════
   KEYBOARD / ESC
══════════════════════════════════════════════════════════════ */
document.addEventListener('keydown', e => {
  if (e.key === 'Escape') {
    closeDetail();
    document.getElementById('mob-more-sheet')?.classList.remove('open');
    document.querySelectorAll('.ndrop').forEach(d => d.classList.remove('open'));
  }
});

/* ═══════════════════════════════════════════════════════════
   INIT
══════════════════════════════════════════════════════════════ */
loadDashboard();
