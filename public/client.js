const api = {
  async request(path, options = {}) {
    const res = await fetch(path, {
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      ...options,
    });
    let data = {};
    try {
      data = await res.json();
    } catch (err) {
      data = {};
    }
    if (!res.ok) {
      return { error: data.error || 'فشل الطلب', status: res.status };
    }
    return data;
  },
};

const socket = io('/', { withCredentials: true, autoConnect: false });
const isDashboard = window.location.pathname.includes('index.html') || window.location.pathname === '/';
const isBulk = window.location.pathname.includes('bulk.html');
let statusState = { connected: false, running: false, linkState: 'not_linked', bulk: {}, lastChecked: {}, forward: {} };
let savingForward = false;

const PENDING_KEY = 'wa_pending_names';
const INTERACTED_KEY = 'wa_interacted_names';
const INTERACTION_IDS_KEY = 'wa_interaction_ids';
let pendingNames = new Set();
let interactedEntries = [];
let seenInteractionIds = new Set();

function persistNameLists() {
  localStorage.setItem(PENDING_KEY, JSON.stringify([...pendingNames]));
  localStorage.setItem(INTERACTED_KEY, JSON.stringify(interactedEntries));
  localStorage.setItem(INTERACTION_IDS_KEY, JSON.stringify([...seenInteractionIds]));
}

function loadNameLists(clients) {
  const storedPending = JSON.parse(localStorage.getItem(PENDING_KEY) || '[]');
  const storedInteracted = JSON.parse(localStorage.getItem(INTERACTED_KEY) || '[]');
  const storedIds = JSON.parse(localStorage.getItem(INTERACTION_IDS_KEY) || '[]');
  pendingNames = new Set(storedPending || []);
  interactedEntries = storedInteracted || [];
  seenInteractionIds = new Set(storedIds || []);

  const clientNames = (clients || []).map((c) => c.name).filter(Boolean);
  if (pendingNames.size === 0 && interactedEntries.length === 0 && clientNames.length) {
    pendingNames = new Set(clientNames);
  } else {
    clientNames.forEach((name) => {
      if (!pendingNames.has(name) && !interactedEntries.includes(name)) {
        pendingNames.add(name);
      }
    });
  }
  persistNameLists();
  renderNameLists();
}

function resetNameLists() {
  pendingNames = new Set();
  interactedEntries = [];
  seenInteractionIds = new Set();
  persistNameLists();
  renderNameLists();
}

function renderNameLists() {
  const pendingEl = document.getElementById('pending-log');
  const interactedEl = document.getElementById('interacted-log');
  const pendingCount = document.getElementById('pending-count');
  const interactedCount = document.getElementById('interacted-count');
  if (pendingEl) {
    pendingEl.innerHTML = [...pendingNames].map((n) => `<span class="pill-item">${n}</span>`).join('');
  }
  if (interactedEl) {
    interactedEl.innerHTML = interactedEntries.map((n) => `<span class="pill-item">${n}</span>`).join('');
  }
  if (pendingCount) pendingCount.textContent = pendingNames.size;
  if (interactedCount) interactedCount.textContent = interactedEntries.length;
}

function handleInteractionEntry(entry) {
  const name = entry?.match || entry?.name || entry?.clientName;
  const id = entry?.id;
  if (!name || (id && seenInteractionIds.has(id))) return;
  if (id) seenInteractionIds.add(id);
  if (pendingNames.has(name)) pendingNames.delete(name);
  interactedEntries.push(name);
  persistNameLists();
  renderNameLists();
}

function handleApiError(data, context) {
  if (!data || typeof data !== 'object') return false;
  if (data.error === 'WA_NOT_READY') {
    addLog(`واتساب غير جاهز${context ? `: ${context}` : ''}`);
    return true;
  }
  if (data.error) {
    addLog(`فشل الطلب${context ? ` (${context})` : ''}: ${data.error}`);
    return true;
  }
  return false;
}

function setStatusPill(id, text, cls) {
  const el = document.getElementById(id);
  if (el) {
    el.textContent = text;
    el.className = `status-pill ${cls}`;
  }
}

function formatTs(ts) {
  if (!ts) return 'غير متوفر';
  const d = new Date(ts);
  return isNaN(d.getTime()) ? 'غير متوفر' : d.toLocaleString();
}

function renderStatus(status) {
  statusState = { ...statusState, ...status };
  const linkLabelMap = {
    ready: 'جاهز داخل واتساب',
    qr: 'غير مرتبط / يحتاج QR',
    linking: 'جاري الربط',
    disconnected: 'منفصل',
    not_linked: 'غير مرتبط',
  };
  const linkClassMap = {
    ready: 'ok',
    qr: 'warn',
    linking: 'warn',
    disconnected: 'bad',
    not_linked: 'bad',
  };
  setStatusPill('connected-pill', statusState.connected ? 'متصل' : 'غير متصل', statusState.connected ? 'ok' : 'bad');
  setStatusPill('running-pill', statusState.running ? 'يعمل' : 'متوقف', statusState.running ? 'ok' : 'bad');
  setStatusPill('link-pill', linkLabelMap[statusState.linkState] || 'غير مرتبط', linkClassMap[statusState.linkState] || 'bad');
  const qrBtn = document.getElementById('qr-btn');
  if (qrBtn) {
    const disableQr = statusState.linkState === 'ready';
    qrBtn.disabled = disableQr;
    if (disableQr) document.getElementById('qr-modal')?.classList.add('hidden');
  }
  renderForwardState(statusState.forward || {});
  renderCheckpoints(statusState.lastChecked || {});
  if (statusState.bulk) renderBulkStatus(statusState.bulk);
}

function addLog(line, target = 'logs') {
  const el = document.getElementById(target);
  if (!el) return;
  el.textContent += `${line}\n`;
  el.scrollTop = el.scrollHeight;
}

function renderInteractionLogs(payload) {
  const interacted = payload?.interacted || [];
  interacted.forEach((e) => handleInteractionEntry(e));
}

function renderCheckpoints(map) {
  const el = document.getElementById('backlog-checkpoints');
  if (!el) return;
  const entries = Object.entries(map || {});
  if (!entries.length) {
    el.textContent = 'لا توجد نقاط تحقق بعد.';
    return;
  }
  el.innerHTML = entries
    .map(([id, ts]) => `<div>${id}: ${formatTs(ts)}</div>`)
    .join('');
}

function renderForwardState(forward) {
  const queueEl = document.getElementById('forward-queue');
  const lastEl = document.getElementById('forward-last');
  if (queueEl) queueEl.textContent = forward.queueLength ?? 0;
  if (lastEl) lastEl.textContent = formatTs(forward.lastForwardedAt);
  const enabled = document.getElementById('forward-enabled');
  if (enabled) enabled.checked = !!forward.enabled;
  const batch = document.getElementById('forward-batch');
  if (batch && forward.batchSize != null) batch.value = forward.batchSize;
  const flushIdle = document.getElementById('forward-flush-idle');
  if (flushIdle && forward.flushOnIdle != null) flushIdle.checked = forward.flushOnIdle;
  const target = document.getElementById('forward-target');
  if (target && forward.targetChatId && target.value !== forward.targetChatId) {
    const match = Array.from(target.options).find((o) => o.value === forward.targetChatId);
    if (match) target.value = forward.targetChatId;
  }
  const forwardLabel = document.getElementById('forward-enabled-label');
  if (forwardLabel) forwardLabel.textContent = forward.enabled ? 'مفعّل' : 'معطل';
  const forwardTargetLabel = document.getElementById('forward-target-label');
  if (forwardTargetLabel) forwardTargetLabel.textContent = forward.targetChatId || 'غير محدد';
}

async function saveForwardSettings() {
  if (savingForward) return;
  savingForward = true;
  try {
    const payload = {
      forwardEnabled: document.getElementById('forward-enabled')?.checked || false,
      forwardTargetChatId: document.getElementById('forward-target')?.value || '',
      forwardBatchSize: Number(document.getElementById('forward-batch')?.value) || 10,
      forwardFlushOnIdle: document.getElementById('forward-flush-idle')?.checked || false,
    };
    const res = await api.request('/api/settings', { method: 'POST', body: JSON.stringify(payload) });
    if (!handleApiError(res, 'save forwarding settings')) {
      addLog('Forwarding settings saved');
    }
  } catch (err) {
    console.error('Failed to save forwarding settings', err);
  } finally {
    savingForward = false;
  }
}

function initSocket() {
  socket.on('status', renderStatus);
  socket.on('log', (msg) => addLog(msg));
  socket.on('qr', (qr) => {
    const modal = document.getElementById('qr-modal');
    const img = document.getElementById('qr-image');
    if (img) img.src = qr;
    if (modal && statusState.linkState !== 'ready') modal.classList.remove('hidden');
  });
  socket.on('bulk:update', renderBulkStatus);
  socket.on('backlog:update', renderBacklog);
  socket.on('interaction:log', renderInteractionLogs);
}

function bindCommon() {
  document.getElementById('qr-close')?.addEventListener('click', () => document.getElementById('qr-modal').classList.add('hidden'));
}

async function init() {
  try {
    bindCommon();
    initSocket();
    socket.connect();
    const initialStatus = await api.request('/api/status');
    renderStatus(initialStatus);
    if (isDashboard) {
      await initDashboard();
    }
    if (isBulk) {
      await initBulk();
    }
    const logs = await api.request('/api/logs');
    renderInteractionLogs(logs);
  } catch (err) {
    console.error('Initialization failed', err);
  }
}

async function loadClients() {
  const clients = await api.request('/api/clients');
  const text = clients.map((c) => `${c.name || ''}${c.emoji ? `|${c.emoji}` : ''}`).join('\n');
  const textarea = document.getElementById('clients-text');
  if (textarea) textarea.value = text;
  loadNameLists(clients);
}

async function loadSettings() {
  const settings = await api.request('/api/settings');
  if (document.getElementById('rpm')) document.getElementById('rpm').value = settings.rpm;
  if (document.getElementById('cooldown')) document.getElementById('cooldown').value = settings.cooldownSeconds;
  if (document.getElementById('normalize')) document.getElementById('normalize').checked = settings.normalizeArabicEnabled;
  if (document.getElementById('replyMode')) document.getElementById('replyMode').checked = settings.replyMode;
  if (document.getElementById('defaultEmoji')) document.getElementById('defaultEmoji').value = settings.defaultEmoji || '';
  const forwardEnabled = document.getElementById('forward-enabled');
  if (forwardEnabled) forwardEnabled.checked = !!settings.forwardEnabled;
  const forwardBatch = document.getElementById('forward-batch');
  if (forwardBatch) forwardBatch.value = settings.forwardBatchSize || 10;
  const forwardFlush = document.getElementById('forward-flush-idle');
  if (forwardFlush) forwardFlush.checked = settings.forwardFlushOnIdle;
  const forwardTarget = document.getElementById('forward-target');
  if (forwardTarget) forwardTarget.value = settings.forwardTargetChatId || '';
}

async function loadForwardGroups() {
  const groups = await api.request('/api/groups');
  if (handleApiError(groups, 'fetch groups')) return;
  updateForwardTargetOptions(groups);
}

async function initDashboard() {
  bindDashboard();
  bindForwardingControls();
  await loadForwardGroups();
  await loadClients();
  await loadSettings();
  updateHoursLabel();
}

function bindDashboard() {
  document.getElementById('start-btn').addEventListener('click', () => api.request('/api/start', { method: 'POST' }));
  document.getElementById('stop-btn').addEventListener('click', () => api.request('/api/stop', { method: 'POST' }));

  const qrBtn = document.getElementById('qr-btn');
  if (qrBtn) {
    qrBtn.addEventListener('click', async () => {
      if (statusState.linkState === 'ready') return;
      const res = await api.request('/api/qr');
      if (res.qr) {
        const modal = document.getElementById('qr-modal');
        const img = document.getElementById('qr-image');
        if (img) img.src = res.qr;
        if (modal) modal.classList.remove('hidden');
      } else {
        addLog('No QR available yet');
      }
    });
  }

  document.getElementById('save-clients').addEventListener('click', async () => {
    const rawText = document.getElementById('clients-text').value;
    await api.request('/api/clients', { method: 'POST', body: JSON.stringify({ rawText }) });
    loadNameLists(
      rawText
        .split(/\n+/)
        .map((l) => l.trim())
        .filter(Boolean)
        .map((line) => ({ name: line.split('|')[0].trim() }))
    );
    addLog('Clients saved');
  });
  document.getElementById('clear-clients').addEventListener('click', async () => {
    await api.request('/api/clients/clear', { method: 'POST' });
    resetNameLists();
    await loadClients();
    addLog('Clients cleared');
  });

  document.getElementById('save-settings').addEventListener('click', async () => {
    const payload = {
      rpm: Number(document.getElementById('rpm').value) || 20,
      cooldownSeconds: Number(document.getElementById('cooldown').value) || 3,
      normalizeArabicEnabled: document.getElementById('normalize').checked,
      replyMode: document.getElementById('replyMode').checked,
      defaultEmoji: document.getElementById('defaultEmoji').value || '✅',
      forwardEnabled: document.getElementById('forward-enabled')?.checked || false,
      forwardTargetChatId: document.getElementById('forward-target')?.value || '',
      forwardBatchSize: Number(document.getElementById('forward-batch')?.value) || 10,
      forwardFlushOnIdle: document.getElementById('forward-flush-idle')?.checked || false,
    };
    await api.request('/api/settings', { method: 'POST', body: JSON.stringify(payload) });
    addLog('Settings saved');
  });

  document.getElementById('fetch-groups').addEventListener('click', async () => {
    const groups = await api.request('/api/groups');
    if (handleApiError(groups, 'fetch groups')) return;
    renderGroups(groups);
  });

  document.getElementById('save-groups').addEventListener('click', async () => {
    const ids = Array.from(document.querySelectorAll('.group-item input:checked')).map((i) => i.value);
    await api.request('/api/groups', { method: 'POST', body: JSON.stringify({ ids }) });
    addLog('Groups saved');
  });

  document.getElementById('backlog-check').addEventListener('click', async () => {
    const payload = buildBacklogPayload();
    const result = await api.request('/api/backlog/check', { method: 'POST', body: JSON.stringify(payload) });
    if (handleApiError(result, 'backlog check')) return;
    renderBacklog(result);
  });

  document.getElementById('backlog-process').addEventListener('click', async () => {
    const payload = buildBacklogPayload();
    const result = await api.request('/api/backlog/process', { method: 'POST', body: JSON.stringify(payload) });
    if (handleApiError(result, 'backlog process')) return;
    renderBacklog(result);
  });

  document.getElementById('copy-pending').addEventListener('click', () => copyList([...pendingNames]));
  document.getElementById('copy-interacted').addEventListener('click', () => copyList(interactedEntries));
  document.getElementById('copy-skipped').addEventListener('click', () => copyLog('logs'));
  document.getElementById('clear-skipped').addEventListener('click', () => clearLog());

  const hoursRange = document.getElementById('backlog-hours');
  if (hoursRange) hoursRange.addEventListener('input', updateHoursLabel);
}

function bindForwardingControls() {
  document.getElementById('forward-flush')?.addEventListener('click', async () => {
    await api.request('/api/forward/flush', { method: 'POST' });
  });
  document.getElementById('forward-clear')?.addEventListener('click', async () => {
    await api.request('/api/forward/clear', { method: 'POST' });
    addLog('Forward queue cleared');
  });
  document.getElementById('forward-enabled')?.addEventListener('change', saveForwardSettings);
  document.getElementById('forward-target')?.addEventListener('change', saveForwardSettings);
  document.getElementById('forward-batch')?.addEventListener('change', saveForwardSettings);
  document.getElementById('forward-flush-idle')?.addEventListener('change', saveForwardSettings);
}

function copyList(list) {
  if (!Array.isArray(list)) return;
  navigator.clipboard.writeText(list.join('\n'));
}

function copyLog(id) {
  const el = document.getElementById(id);
  if (!el) return;
  navigator.clipboard.writeText(el.textContent || '');
}

async function clearLog(type) {
  if (!type) {
    await api.request('/api/logs/clear', { method: 'POST', body: JSON.stringify({ type: 'interacted' }) });
    await api.request('/api/logs/clear', { method: 'POST', body: JSON.stringify({ type: 'skipped' }) });
  } else {
    await api.request('/api/logs/clear', { method: 'POST', body: JSON.stringify({ type }) });
  }
  const logs = await api.request('/api/logs');
  renderInteractionLogs(logs);
}

function buildBacklogPayload() {
  const hoursVal = Number(document.getElementById('backlog-hours').value) || 0;
  const sinceVal = document.getElementById('backlog-since').value;
  const sinceTimestamp = sinceVal ? new Date(sinceVal).getTime() : undefined;
  return {
    hours: hoursVal > 0 ? hoursVal : undefined,
    sinceTimestamp: sinceTimestamp || undefined,
    limitCap: Number(document.getElementById('backlog-limit').value) || 500,
  };
}

function renderGroups(groups) {
  const container = document.getElementById('groups-list');
  if (!container) return;
  container.innerHTML = '';
  if (!Array.isArray(groups)) return;
  groups.forEach((g) => {
    const item = document.createElement('div');
    item.className = 'group-item';
    item.innerHTML = `<label>${g.name}</label><label class="switch"><input type="checkbox" value="${g.id}" ${
      g.selected ? 'checked' : ''
    }/><span class="slider"></span></label>`;
    container.appendChild(item);
  });
  updateForwardTargetOptions(groups);
}

function updateForwardTargetOptions(groups) {
  const select = document.getElementById('forward-target');
  if (!select) return;
  select.innerHTML = '<option value="">-- اختر المجموعة المستهدفة --</option>';
  (groups || []).forEach((g) => {
    const opt = document.createElement('option');
    opt.value = g.id;
    opt.textContent = g.name;
    select.appendChild(opt);
  });
  if (statusState.forward?.targetChatId) {
    select.value = statusState.forward.targetChatId;
  }
}

function renderBacklog(data) {
  const container = document.getElementById('backlog-output');
  if (!container) return;
  container.innerHTML = '';
  if (!Array.isArray(data)) return;
  (data || []).forEach((row) => {
    const div = document.createElement('div');
    div.textContent = `${row.groupName || row.groupId}: ${row.found || 0} رسائل مرشحة${row.processed ? ` | تمت جدولة ${row.processed}` : ''}`;
    container.appendChild(div);
  });
}

function renderBulkStatus(state) {
  const status = document.getElementById('bulk-status');
  const progress = document.getElementById('bulk-progress');
  if (status) status.textContent = `${state.state}${state.paused ? ' (متوقف مؤقتًا)' : ''}`;
  if (progress) {
    const pct = state.total ? Math.min(100, Math.round((state.sent / state.total) * 100)) : 0;
    progress.style.width = `${pct}%`;
  }
}

async function initBulk() {
  bindBulk();
  bindForwardingControls();
  await loadForwardGroups();
  await loadSettings();
  await loadBulkGroups();
}

async function loadBulkGroups() {
  const groups = await api.request('/api/groups');
  if (handleApiError(groups, 'fetch groups')) return;
  const select = document.getElementById('bulk-group');
  select.innerHTML = '';
  groups.forEach((g) => {
    const option = document.createElement('option');
    option.value = g.id;
    option.textContent = g.name;
    select.appendChild(option);
  });
  updateForwardTargetOptions(groups);
}

function parseNotifications(rawText, mode) {
  if (mode === 'fixed3') {
    const lines = rawText.split('\n').map((l) => l.trim()).filter(Boolean);
    const blocks = [];
    for (let i = 0; i < lines.length; i += 3) {
      const slice = lines.slice(i, i + 3);
      if (slice.length) blocks.push(slice.join('\n'));
    }
    return blocks;
  }
  const chunks = rawText
    .split(/\n\s*\n+/)
    .map((c) => c.trim())
    .filter(Boolean);
  return chunks;
}

function analyzeNotifications() {
  const rawText = document.getElementById('bulk-messages').value;
  const mode = document.getElementById('bulk-parse-mode').value;
  const messages = parseNotifications(rawText, mode);
  const analysis = document.getElementById('bulk-analysis');
  analysis.textContent = `عدد الإشعارات: ${messages.length}`;
  return messages;
}

function bindBulk() {
  const qrBtn = document.getElementById('qr-btn');
  if (qrBtn) {
    qrBtn.addEventListener('click', async () => {
      if (statusState.linkState === 'ready') return;
      const res = await api.request('/api/qr');
      if (res.qr) {
        const modal = document.getElementById('qr-modal');
        const img = document.getElementById('qr-image');
        if (img) img.src = res.qr;
        if (modal) modal.classList.remove('hidden');
      }
    });
  }

  document.getElementById('bulk-analyze').addEventListener('click', analyzeNotifications);

  document.getElementById('bulk-start').addEventListener('click', async () => {
    const mode = document.getElementById('bulk-parse-mode').value;
    const messages = parseNotifications(document.getElementById('bulk-messages').value, mode);
    const groupId = document.getElementById('bulk-group').value;
    const delaySeconds = Number(document.getElementById('bulk-delay').value) || 2;
    const rpm = Number(document.getElementById('bulk-rpm').value) || 10;
    await api.request('/api/bulk/start', { method: 'POST', body: JSON.stringify({ groupId, messages, delaySeconds, rpm }) });
  });

  document.getElementById('bulk-pause').addEventListener('click', () => api.request('/api/bulk/pause', { method: 'POST' }));
  document.getElementById('bulk-resume').addEventListener('click', () => api.request('/api/bulk/resume', { method: 'POST' }));
  document.getElementById('bulk-stop').addEventListener('click', () => api.request('/api/bulk/stop', { method: 'POST' }));
}

function updateHoursLabel() {
  const hoursRange = document.getElementById('backlog-hours');
  const label = document.getElementById('backlog-hours-value');
  if (hoursRange && label) {
    label.textContent = `${hoursRange.value}س`;
  }
}

init();
