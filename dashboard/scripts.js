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
  bulkLoadSettings(){ return this.request('/api/bulk/load-settings'); }
};

function $(id){ return document.getElementById(id); }
function fmtTs(ts){ if (!ts) return '—'; try { return new Date(ts).toLocaleString(); } catch { return '—'; } }
function ensureAuth(){ if (!api.token()) { clearToken(); window.location.href='/dashboard/login.html'; } }

function createLogger(box){
  return function(line, ts = Date.now()){
    if (!box) return;
    const row = document.createElement('div');
    row.className='log-entry';
    const tm = document.createElement('time');
    tm.textContent = new Date(ts).toLocaleTimeString();
    const text = document.createElement('div');
    text.textContent = line;
    row.append(tm, text);
    box.appendChild(row);
    box.scrollTop = box.scrollHeight;
  };
}

function saveLocal(key, data){ localStorage.setItem(key, JSON.stringify(data)); }
function loadLocal(key, fallback){ try { return JSON.parse(localStorage.getItem(key)) ?? fallback; } catch { return fallback; } }

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
  socket.on('log', ({ line, ts }) => logMain(line, ts));
  socket.on('qr', ({ qr }) => {
    const box = $('qr-box');
    if (box){
      box.style.display = 'block';
      box.innerHTML = `<img src="${qr}" alt="QR">`;
    }
  });
  socket.on('status', (s) => updateStatusPills(s));

  const savedUi = loadLocal('ui-state', {});
  restoreUI(savedUi);

  $('btn-logout').onclick = async ()=>{ await api.logout(); clearToken(); window.location.href='/dashboard/login.html'; };
  $('btn-clear-log').onclick = ()=>{ $('log').innerHTML=''; };
  $('btn-clear-session').onclick = async ()=>{ await api.clearSession(); logMain('تم مسح الجلسة'); };

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
  $('btn-check-backlog').onclick = async ()=>{ const res = await api.checkBacklog({ startAtMs: getBacklogStartTs() }); logMain(`نتيجة الفحص: ${res.total} رسالة`); (res.byGroup||[]).forEach(g=>logMain(`- ${g.name}: ${g.count}`)); };
  $('btn-backlog').onclick = async ()=>{ await api.processBacklog({ startAtMs: getBacklogStartTs() }); logMain('✓ تم دفع الأرشيف للطابور'); };

  $('btn-refresh-groups').onclick = ()=> fetchGroups(savedUi, true);
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
  refreshStatus();
  pollStatus();
}

function updateStatusPills(status){
  if (!status) return;
  const ready = $('pill-ready');
  const running = $('pill-running');
  const state = status.connectionStatus;
  const readyLabel = state === 'connected' ? 'متصل'
    : state === 'reconnecting' ? 'إعادة الاتصال...'
    : state === 'qr_ready' ? 'جاهز لمسح QR'
    : state === 'logged_out' ? 'مسجّل الخروج'
    : 'غير متصل';
  if (ready) ready.textContent = readyLabel;
  if (running) running.textContent = status.running ? 'شغّال' : 'متوقف';
  const runningBulk = status.bulk?.running;
  const runningElem = document.querySelector('#bulk #pill-running');
  if (runningElem) runningElem.textContent = runningBulk ? 'شغال (Bulk)' : 'متوقف';
  const readyBulk = document.querySelector('#bulk #pill-ready');
  if (readyBulk) readyBulk.textContent = readyLabel;
  if (status.bulk){ $('progress').textContent = `${status.bulk.index||0} / ${status.bulk.total||0}`; }
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
function applyBulkDraft(d){ if (!d) return; $('bulkInput').value = d.raw || ''; splitMode = d.splitMode || 'blank'; $('splitModeName').textContent = (splitMode === 'blank') ? 'تقسيم بالفراغات' : 'كل سطر رسالة'; if (d.groupId) { const opt = [...$('groupSelect').options].find(o=>o.value===d.groupId); if (opt) opt.selected = true; } $('btn-parse').click(); }
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
