const TOKEN_KEY = 'token';
const LOGIN_FLAG_KEY = 'loggedIn';

function getStoredToken(){
  return sessionStorage.getItem(TOKEN_KEY) || localStorage.getItem(TOKEN_KEY);
}

function persistToken(token, remember){
  clearToken();
  const storage = remember ? localStorage : sessionStorage;
  storage.setItem(TOKEN_KEY, token);
  storage.setItem(LOGIN_FLAG_KEY, 'true');
}

function clearToken(){
  [localStorage, sessionStorage].forEach((store)=>{
    store.removeItem(TOKEN_KEY);
    store.removeItem(LOGIN_FLAG_KEY);
  });
}

const api = {
  token: () => getStoredToken(),
  headers() {
    const h = { 'Content-Type': 'application/json' };
    const t = this.token();
    if (t) h['Authorization'] = `Bearer ${t}`;
    return h;
  },
  async request(path, options = {}) {
    const res = await fetch(path, { ...options, headers: { ...(options.headers || {}), ...this.headers() } });
    if (res.status === 401) {
      clearToken();
      window.location.href = '/dashboard/login.html';
      return null;
    }
    if (!res.ok) throw new Error((await res.json()).error || 'خطأ في الطلب');
    return res.json();
  },
  login(email, password, remember) { return this.request('/login', { method:'POST', body: JSON.stringify({ email, password, remember }) }); },
  logout() { return this.request('/logout', { method:'POST' }); },
  status() { return this.request('/api/bot/status'); },
  showQR() { return this.request('/api/bot/qr'); },
  fetchGroups() { return this.request('/api/bot/groups'); },
  startBot() { return this.request('/api/bot/start', { method:'POST' }); },
  stopBot() { return this.request('/api/bot/stop', { method:'POST' }); },
  restartBot() { return this.request('/api/bot/restart', { method:'POST' }); },
  clearSession() { return this.request('/api/bot/clear-session', { method:'POST' }); },
  getQR() { return this.request('/api/bot/status'); },
  processBacklog(opts) { return this.request('/api/bot/process-backlog', { method:'POST', body: JSON.stringify(opts||{}) }); },
  checkBacklog(opts) { return this.request('/api/bot/check-backlog', { method:'POST', body: JSON.stringify(opts||{}) }); },
  archives() { return this.request('/api/archives'); },
  saveSettings(payload) { return this.request('/api/settings/save', { method:'POST', body: JSON.stringify(payload) }); },
  loadSettings() { return this.request('/api/settings/load'); },
  bulkStart(data){ return this.request('/api/bulk/start', { method:'POST', body: JSON.stringify(data||{}) }); },
  bulkPause(){ return this.request('/api/bulk/pause', { method:'POST' }); },
  bulkResume(){ return this.request('/api/bulk/resume', { method:'POST' }); },
  bulkCancel(){ return this.request('/api/bulk/cancel', { method:'POST' }); },
  bulkStatus(){ return this.request('/api/bulk/status'); },
  bulkSaveDraft(d){ return this.request('/api/bulk/save-draft', { method:'POST', body: JSON.stringify(d||{}) }); },
  bulkLoadDraft(){ return this.request('/api/bulk/load-draft'); },
  bulkSaveSettings(d){ return this.request('/api/bulk/save-settings', { method:'POST', body: JSON.stringify(d||{}) }); },
  bulkLoadSettings(){ return this.request('/api/bulk/load-settings'); },
  bulkGroups(){ return this.request('/api/bulk/groups'); },
  queueStatus(){ return this.request('/api/queue/status'); }
};

function $(id){ return document.getElementById(id); }
function fmtTs(ts){ if (!ts) return '—'; try { return new Date(ts).toLocaleString(); } catch { return '—'; } }
function ensureAuth(){ if (!api.token()) { clearToken(); window.location.href='/dashboard/login.html'; } }

function createLogger(box){
  return function(payload, tsOverride){
    if (!box) return;
    const data = typeof payload === 'string' ? { line: payload, ts: Date.now(), level: 'info' } : (payload || {});
    const ts = tsOverride || data.ts || Date.now();
    const row = document.createElement('div');
    row.className = `log-entry level-${data.level || 'info'}`;
    const tm = document.createElement('time');
    tm.textContent = new Date(ts).toLocaleTimeString();
    const badge = document.createElement('span');
    badge.className = 'log-level';
    badge.textContent = (data.level || 'info').toUpperCase();
    const text = document.createElement('div');
    text.className = 'log-text';
    text.textContent = data.line || '';
    row.append(tm, badge, text);
    box.appendChild(row);
    box.scrollTop = box.scrollHeight;
  };
}

function saveLocal(key, data){ localStorage.setItem(key, JSON.stringify(data)); }
function loadLocal(key, fallback){ try { return JSON.parse(localStorage.getItem(key)) ?? fallback; } catch { return fallback; } }

let lastConnectionStatus = null;
let bulkGroupsLoaded = false;
let queueBoxInitialized = false;

async function initLogin(){
  const btn = $('btn-login');
  const err = $('login-error');
  btn.onclick = async ()=>{
    try{
      const email = $('login-email').value.trim();
      const password = $('login-password').value.trim();
      const remember = $('login-remember')?.checked;
      const r = await api.login(email, password, remember);
      if (r?.token){
        persistToken(r.token, remember);
        window.location.href = '/dashboard/index.html';
      }
    }catch(e){ err.textContent = e.message || 'خطأ'; }
  };
}

async function initDashboard(){
  ensureAuth();
  const logMain = createLogger($('log'));
  const logBulk = createLogger($('log-bulk'));

  const socket = io({ auth: { token: api.token() } });
  socket.on('log', (entry) => logMain(entry));
  socket.on('qr', ({ qr }) => {
    const box = $('qr-box');
    if (box){
      box.style.display = 'block';
      box.innerHTML = `<img src="${qr}" alt="QR">`;
    }
  });
  socket.on('status', (s) => updateStatusPills(s));
  socket.on('bulk:groups', (payload = {}) => {
    const list = Array.isArray(payload) ? payload : (payload.groups || []);
    console.log('Groups from socket:', list);
    renderBulkGroups(list, $('groupSelect')?.value || $('groupSelect')?.dataset?.pendingSelection || '');
  });
  socket.on('archives', (payload = {}) => {
    const list = payload?.archives || [];
    logMain(`تم جلب الأرشيف: ${list.length}`);
    renderArchives(list);
  });
  socket.on('queue:update', (payload = {}) => {
    renderQueueStatus({ length: payload.length || 0, running: !!payload.running });
  });

  const savedUi = loadLocal('ui-state', {});
  const savedBulkId = savedUi?.bulk?.draft?.groupId || savedUi?.bulk?.groupId || '';
  restoreUI(savedUi);

  $('btn-logout').onclick = async ()=>{ await api.logout(); clearToken(); window.location.href='/dashboard/login.html'; };
  $('btn-clear-log').onclick = ()=>{ $('log').innerHTML=''; };
  $('btn-clear-session').onclick = async ()=>{ await api.clearSession(); logMain({ line:'تم مسح الجلسة', level:'warning' }); refreshStatus(); };

  $('btn-show-qr').onclick = async () => {
    const r = await api.showQR();
    const box = $('qr-box');
    if (r.qr){ box.style.display='block'; box.innerHTML = `<img src="${r.qr}" alt="QR">`; }
    else { box.style.display='block'; box.innerHTML = `<div class="muted">${r.message || r.error || 'QR غير جاهز'}</div>`; }
  };
  $('btn-fetch-groups').onclick = async ()=>{ await fetchGroups(savedUi); };
  $('btn-save-groups').onclick = async ()=>{ await saveAll(); logMain('حُفظت المجموعات'); };
  $('btn-save-clients').onclick = async ()=>{ await saveAll(); logMain('حُفظ العملاء'); };
  $('btn-load-clients').onclick = ()=>{ loadClients(savedUi); logMain('تم تحميل العملاء'); };
  $('btn-save-settings').onclick = async ()=>{ await saveAll(); logMain('حُفظت الإعدادات'); };
  $('btn-save-all').onclick = async ()=>{ await saveAll(); logMain('حُفظت جميع البيانات'); };

  $('btn-start').onclick = async ()=>{ await api.startBot(); const s = await api.status(); updateStatusPills(s); logMain('بدء التفاعل'); };
  $('btn-stop').onclick  = async ()=>{ await api.stopBot();  const s = await api.status(); updateStatusPills(s); logMain('إيقاف التفاعل'); };
  $('btn-check-backlog').onclick = async ()=>{
    await refreshArchives(logMain);
    const res = await api.checkBacklog({ startAtMs: getBacklogStartTs() });
    logMain(`نتيجة الفحص: ${res.total} رسالة`);
    (res.byGroup||[]).forEach(g=>logMain(`- ${g.name}: ${g.count}`));
  };
  $('btn-backlog').onclick = async ()=>{ await api.processBacklog({ startAtMs: getBacklogStartTs() }); logMain('✓ تم دفع الأرشيف للطابور'); };

  $('btn-refresh-groups').onclick = ()=> { fetchGroups(savedUi, true); loadBulkGroups({ savedId: $('groupSelect').value, force: true }); };
  $('btn-save-bulk-settings').onclick = async ()=>{ await api.bulkSaveSettings(getBulkSettings()); await saveAll(); logBulk('حُفظت إعدادات الإرسال الجماعي'); };
  $('btn-save-draft').onclick = async ()=>{ await api.bulkSaveDraft(getBulkDraft()); logBulk('حُفظت المسودة'); await saveAll(); };
  $('btn-load-draft').onclick = async ()=>{ const d = await api.bulkLoadDraft(); if (d){ applyBulkDraft(d); logBulk('تم تحميل المسودة'); await saveAll(); } else { logBulk('لا توجد مسودة'); } };
  $('btn-parse').onclick = ()=>{ parsed = parseInput($('bulkInput').value); renderPreview(parsed); $('progress').textContent = `0 / ${parsed.length}`; logBulk(`تم التحليل: ${parsed.length} رسالة`); saveLocalState(); };
  $('btn-toggle-split').onclick = ()=>{ splitMode = (splitMode === 'blank' ? 'line' : 'blank'); $('splitModeName').textContent = (splitMode === 'blank') ? 'تقسيم بالفراغات' : 'كل سطر رسالة'; $('btn-parse').click(); saveLocalState(); };

  $('btn-start-bulk').onclick = async ()=>{ if (!parsed.length) $('btn-parse').click(); if (!parsed.length) { logBulk('لا توجد رسائل'); return; } const groupId = $('groupSelect').value; if (!groupId){ logBulk('اختر مجموعة'); return; } const s = getBulkSettings(); await api.bulkStart({ groupId, messages: parsed, delaySec: s.delaySec, rpm: s.rpm }); logBulk('تم بدء الإرسال…'); pollStatus(); await saveAll(); };
  $('btn-pause').onclick  = async ()=>{ await api.bulkPause(); logBulk('إيقاف مؤقت'); };
  $('btn-resume').onclick = async ()=>{ await api.bulkResume(); logBulk('استئناف'); pollStatus(); };
  $('btn-cancel').onclick = async ()=>{ await api.bulkCancel(); logBulk('تم الإلغاء'); };

  await loadRemoteState();
  fetchGroups(savedUi, false);
  loadBulkGroups({ savedId: savedBulkId });
  refreshStatus();
  pollStatus();
  refreshQueueStatus();
}

function updateStatusPills(status){
  if (!status) return;
  const prev = lastConnectionStatus;
  lastConnectionStatus = status.connectionStatus;
  const ready = $('pill-ready');
  const running = $('pill-running');
  const map = {
    connected: 'متصل',
    reconnecting: 'إعادة الاتصال...',
    connecting: 'جاري الاتصال...',
    qr: 'في انتظار QR',
    logged_out: 'مسجّل الخروج',
    loggedOut: 'مسجّل الخروج',
    disconnected: 'غير متصل'
  };
  const readyLabel = map[status.connectionStatus] || 'غير متصل';
  if (ready) ready.textContent = readyLabel;
  if (running) running.textContent = status.running ? 'شغّال' : 'متوقف';
  const runningBulk = status.bulk?.running;
  const runningElem = document.querySelector('#bulk #pill-running');
  if (runningElem) runningElem.textContent = runningBulk ? 'شغال (Bulk)' : 'متوقف';
  const readyBulk = document.querySelector('#bulk #pill-ready');
  if (readyBulk) readyBulk.textContent = readyLabel;
  if (status.bulk){ $('progress').textContent = `${status.bulk.index||0} / ${status.bulk.total||0}`; }
  if (status.connectionStatus === 'connected' && prev !== 'connected'){
    const saved = loadLocal('ui-state', {})?.bulk?.draft?.groupId || '';
    loadBulkGroups({ savedId: saved, force: true });
  }
  if (typeof status.queueSize !== 'undefined') {
    renderQueueStatus({ length: status.queueSize, running: status.running });
  }
}

function renderGroups(list, selectedSet, lastMap){
  const box = $('groups'); if (!box) return; box.innerHTML = '';
  list.forEach(g=>{
    const row = document.createElement('div'); row.className='group';
    const cb = document.createElement('input'); cb.type='checkbox'; cb.value = g.id; cb.checked = selectedSet.has(g.id);
    const name = document.createElement('div'); name.style.flex='1'; name.innerHTML = `<strong>${g.name}</strong> <span class="muted">(${g.count||0})</span>`;
    const last = document.createElement('div'); last.className='muted last-col'; last.textContent = `آخر معالجة: ${fmtTs(lastMap[g.id])}`;
    row.append(cb,name,last); box.append(row);
  });
}

async function fetchGroups(savedUi = {}, force = false){
  try{
    const list = await api.fetchGroups();
    const local = loadLocal('ui-state', {});
    const saved = (savedUi.selectedGroupIds && savedUi.selectedGroupIds.length ? savedUi.selectedGroupIds : local.selectedGroupIds) || [];
    const lastMap = savedUi.lastChecked || local.lastChecked || {};
    renderGroups(list, new Set(saved), lastMap);
  }catch(e){ const box=$('groups'); if(box) box.innerHTML='تعذر الجلب'; }
}

function getBulkGroupsMessageBox(select){
  if (!select || !select.parentElement) return null;
  let box = document.getElementById('bulk-groups-message');
  if (!box){
    box = document.createElement('div');
    box.id = 'bulk-groups-message';
    box.className = 'muted';
    box.style.marginTop = '6px';
    select.parentElement.appendChild(box);
  }
  return box;
}

function renderBulkGroups(list = [], preferredId){
  const select = $('groupSelect');
  if (!select) return;
  select.innerHTML = '';
  const messageBox = getBulkGroupsMessageBox(select);
  if (!list.length){
    const opt = document.createElement('option');
    opt.value = '';
    opt.disabled = true;
    opt.selected = true;
    opt.textContent = 'لا توجد مجموعات متاحة حالياً';
    select.appendChild(opt);
    if (messageBox) messageBox.textContent = 'لا توجد مجموعات متاحة حالياً.';
    return;
  }

  if (messageBox) messageBox.textContent = '';
  list.forEach((g) => {
    const opt = document.createElement('option');
    opt.value = g.id;
    opt.textContent = g.name || g.subject || g.id;
    select.appendChild(opt);
  });

  const targetId = preferredId || select.dataset.pendingSelection;
  if (targetId){
    const found = [...select.options].find((o) => o.value === targetId);
    if (found) found.selected = true;
  }
  select.dataset.pendingSelection = '';
}

async function loadBulkGroups({ savedId = '', force = false } = {}){
  const select = $('groupSelect');
  if (!select) return;
  if (!force && bulkGroupsLoaded && select.options.length) return;
  const preferred = savedId || select.value || select.dataset.pendingSelection || '';
  select.dataset.pendingSelection = preferred;
  try {
    const response = await api.bulkGroups();
    const list = Array.isArray(response) ? response : (response?.groups || []);
    console.log("Groups from API:", list);
    bulkGroupsLoaded = true;
    renderBulkGroups(list, preferred);
  } catch (e) {
    select.innerHTML = '';
    const opt = document.createElement('option');
    opt.value = '';
    opt.disabled = true;
    opt.selected = true;
    opt.textContent = 'تعذر جلب المجموعات (تأكد من الاتصال)';
    select.appendChild(opt);
    const messageBox = getBulkGroupsMessageBox(select);
    if (messageBox) messageBox.textContent = 'لا توجد مجموعات متاحة حالياً.';
  }
}

function ensureQueueBox(){
  if (queueBoxInitialized) return $('queue-info');
  const status = document.querySelector('.status');
  if (!status) return null;
  const box = document.createElement('div');
  box.id = 'queue-info';
  box.className = 'muted';
  box.style.marginTop = '6px';
  status.appendChild(box);
  queueBoxInitialized = true;
  return box;
}

function renderQueueStatus({ length = 0, running = false } = {}){
  const box = ensureQueueBox();
  if (!box) return;
  if (!length) {
    box.textContent = 'الطابور فارغ';
    return;
  }
  box.textContent = running ? `الطابور يعمل (${length})` : `الطابور متوقف (${length})`;
}

async function refreshQueueStatus(){
  try {
    const q = await api.queueStatus();
    renderQueueStatus({ length: q.length || 0, running: !!q.running });
  } catch {}
}

function ensureArchivesBox(){
  let box = $('archives-list');
  if (box) return box;
  const logCard = $('log')?.parentElement;
  if (!logCard) return null;
  const title = document.createElement('div');
  title.id = 'archives-title';
  title.className = 'muted';
  title.style.marginTop = '8px';
  title.textContent = 'المحادثات المؤرشفة';
  box = document.createElement('div');
  box.id = 'archives-list';
  box.className = 'list';
  box.style.marginTop = '6px';
  logCard.insertBefore(box, $('log'));
  logCard.insertBefore(title, box);
  return box;
}

function renderArchives(list = []){
  const box = ensureArchivesBox();
  if (!box) return;
  box.innerHTML = '';
  if (!list.length){
    const empty = document.createElement('div');
    empty.className = 'muted';
    empty.textContent = 'لا توجد محادثات مؤرشفة.';
    box.appendChild(empty);
    return;
  }
  list.forEach((item) => {
    const row = document.createElement('div');
    row.className = 'group';
    row.textContent = `${item.name || item.id} (${item.id})`;
    box.appendChild(row);
  });
}

async function refreshArchives(logger){
  try {
    const res = await api.archives();
    const list = res?.archives || [];
    renderArchives(list);
    if (logger) logger(`تم جلب الأرشيف: ${list.length}`);
  } catch (e) {
    if (logger) logger('تعذر جلب الأرشيف');
  }
}

function parseClients(raw, fallbackEmoji){
  const lines = String(raw||'').split(/\r?\n/).map(l=>l.trim()).filter(Boolean);
  const arr = []; const seen = new Set();
  for (const line of lines){
    const [n,e] = line.split('|'); const name = (n||'').trim(); const emoji = (e||'').trim() || fallbackEmoji;
    if (!name) continue; const key = name+'|'+emoji; if (seen.has(key)) continue; seen.add(key); arr.push({ name, emoji });
  }
  return arr;
}

async function saveAll(){
  const settings = {
    emoji: $('emoji').value.trim() || '✅',
    ratePerMinute: Number($('rpm').value || 20),
    cooldownSec: Number($('cooldown').value || 3),
    normalizeArabic: $('normalize').checked,
    mode: $('modeText').checked ? 'text' : 'emoji',
    replyText: 'تم ✅'
  };
  const clients = parseClients($('clients').value, settings.emoji);
  const selectedGroupIds = [...document.querySelectorAll('#groups input[type=checkbox]:checked')].map(i=>i.value);
  const bulk = Object.assign({}, getBulkSettings(), { draft: getBulkDraft() });
  saveLocal('ui-state', { settings, clients, selectedGroupIds, bulk, backlogDate: $('backlogDate').value, bulkInput: $('bulkInput').value, splitMode, lastChecked: {} });
  await api.saveSettings({ settings, clients, selectedGroupIds, bulk });
}

async function loadRemoteState(){
  try{
    const data = await api.loadSettings();
    applySettings(data.settings || {});
    applyClients(data.clients || []);
    applyGroups(data.selectedGroupIds || []);
    if (data.bulk) applyBulkSettings(data.bulk);
    saveLocal('ui-state', { ...loadLocal('ui-state', {}), ...data });
  }catch{}
}

function applySettings(s){
  $('emoji').value = s.emoji || '✅';
  $('rpm').value = s.ratePerMinute ?? 20;
  $('cooldown').value = s.cooldownSec ?? 3;
  $('normalize').checked = !!s.normalizeArabic;
  $('modeText').checked = s.mode === 'text';
}
function applyClients(arr){ $('clients').value = (arr||[]).map(c => (c.emoji ? `${c.name}|${c.emoji}` : c.name)).join('\n'); }
function applyGroups(ids){ const current = document.querySelectorAll('#groups input[type=checkbox]'); current.forEach(cb => cb.checked = ids.includes(cb.value)); }

function getBacklogStartTs(){ const v = $('backlogDate')?.value || ''; if (!v) return null; const d = new Date(v); return isNaN(d.getTime()) ? null : d.getTime(); }

let splitMode = 'blank';
let parsed = [];

function parseInput(txt){ txt = (txt||'').replace(/\r/g,'').trim(); if (!txt) return []; if (splitMode === 'line'){ return txt.split('\n').map(s=>s.trim()).filter(Boolean); } return txt.split(/\n{2,}/).map(b=>b.trim()).filter(Boolean); }
function renderPreview(items){ const preview = $('preview'); if(!preview) return; preview.innerHTML=''; if (!items.length){ preview.innerHTML='<div class="muted">المعاينة فارغة</div>'; return; } items.forEach((t,i)=>{ const div=document.createElement('div'); div.style.borderBottom='1px dashed #1e293b'; div.style.padding='6px'; div.innerHTML = `<strong>#${i+1}</strong><br>${t.replace(/\n/g,'<br>')}`; preview.appendChild(div); }); }
function getBulkSettings(){ return { delaySec: Math.max(0, Number($('delaySec').value || 0)), rpm: Math.max(1, Number($('rpmBulk').value || 1)) }; }
function getBulkDraft(){ return { groupId: $('groupSelect').value || '', raw: $('bulkInput').value || '', splitMode }; }
function applyBulkDraft(d){
  if (!d) return;
  $('bulkInput').value = d.raw || '';
  splitMode = d.splitMode || 'blank';
  $('splitModeName').textContent = (splitMode === 'blank') ? 'تقسيم بالفراغات' : 'كل سطر رسالة';
  if (d.groupId) {
    const select = $('groupSelect');
    if (select){
      const opt = [...select.options].find(o=>o.value===d.groupId);
      if (opt) opt.selected = true;
      else select.dataset.pendingSelection = d.groupId;
    }
  }
  $('btn-parse').click();
}
function applyBulkSettings(b){ if (!b) return; if (typeof b.delaySec !== 'undefined') $('delaySec').value = b.delaySec; if (typeof b.rpm !== 'undefined') $('rpmBulk').value = b.rpm; if (b.draft) applyBulkDraft(b.draft); }
function loadClients(saved){ if (!saved?.clients) return; applyClients(saved.clients); }
function restoreUI(saved){ if (!saved) return; if (saved.settings) applySettings(saved.settings); if (saved.clients) applyClients(saved.clients); if (saved.selectedGroupIds) applyGroups(saved.selectedGroupIds); if (saved.bulk) applyBulkSettings(saved.bulk); if (saved.bulkInput) $('bulkInput').value = saved.bulkInput; if (saved.backlogDate) $('backlogDate').value = saved.backlogDate; if (saved.splitMode) { splitMode = saved.splitMode; $('splitModeName').textContent = (splitMode === 'blank') ? 'تقسيم بالفراغات' : 'كل سطر رسالة'; }
}
function saveLocalState(){ const saved = loadLocal('ui-state', {}); saved.bulkInput = $('bulkInput').value; saved.splitMode = splitMode; saveLocal('ui-state', saved); }

async function refreshStatus(){ try { const s = await api.status(); updateStatusPills(s); } catch {} }
async function pollStatus(){ for (let i=0;i<200;i++){ try { const st = await api.bulkStatus(); updateStatusPills(st); if (!st.bulk?.running) break; await new Promise(r=>setTimeout(r,2000)); } catch { break; } } }

(function(){
  const page = document.body?.dataset?.page;
  if (page === 'login') initLogin();
  if (page === 'dashboard') initDashboard();
})();
