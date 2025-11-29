const api = {
  async request(path, options = {}) {
    const res = await fetch(path, { credentials: 'include', headers: { 'Content-Type': 'application/json' }, ...options });
    let data = {};
    try {
      data = await res.json();
    } catch (err) {
      data = {};
    }
    if (!res.ok) {
      return { error: data.error || 'Request failed', status: res.status };
    }
    return data;
  },
};

const socket = io('/', { withCredentials: true, autoConnect: false });
let statusState = { connected: false, running: false, linkState: 'not_linked', bulk: {}, lastChecked: {}, forward: {} };
const isDashboard = window.location.pathname.includes('index.html') || window.location.pathname === '/';
const isBulk = window.location.pathname.includes('bulk.html');

function handleApiError(data, context) {
  if (!data || typeof data !== 'object') return false;
  if (data.error === 'WA_NOT_READY') {
    addLog(`WhatsApp not ready${context ? `: ${context}` : ''}`);
    return true;
  }
  if (data.error) {
    addLog(`${context || 'Request'} failed: ${data.error}`);
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
  if (!ts) return 'N/A';
  const d = new Date(ts);
  return isNaN(d.getTime()) ? 'N/A' : d.toLocaleString();
}

function renderStatus(status) {
  statusState = { ...statusState, ...status };
  const linkLabelMap = {
    ready: 'Ready (in WhatsApp)',
    qr: 'Not linked / QR needed',
    linking: 'Linking',
    disconnected: 'Disconnected',
    not_linked: 'Not linked',
  };
  const linkClassMap = {
    ready: 'ok',
    qr: 'warn',
    linking: 'warn',
    disconnected: 'bad',
    not_linked: 'bad',
  };
  setStatusPill('connected-pill', statusState.connected ? 'Connected' : 'Disconnected', statusState.connected ? 'ok' : 'bad');
  setStatusPill('running-pill', statusState.running ? 'Running' : 'Stopped', statusState.running ? 'ok' : 'bad');
  setStatusPill('link-pill', linkLabelMap[statusState.linkState] || 'Not linked', linkClassMap[statusState.linkState] || 'bad');
  const qrBtn = document.getElementById('qr-btn');
  if (qrBtn) {
    const disableQr = statusState.linkState === 'ready';
    qrBtn.disabled = disableQr;
    if (disableQr) {
      document.getElementById('qr-modal')?.classList.add('hidden');
    }
  }
  if (statusState.bulk) renderBulkStatus(statusState.bulk);
  renderCheckpoints(statusState.lastChecked || {});
  renderForwardState(statusState.forward || {});
}

function addLog(line, target = 'logs') {
  const el = document.getElementById(target);
  if (!el) return;
  el.textContent += `${line}\n`;
  el.scrollTop = el.scrollHeight;
}

function renderInteractionLogs(payload) {
  const interacted = document.getElementById('interacted-log');
  const skipped = document.getElementById('skipped-log');
  if (interacted) {
    interacted.textContent = (payload.interacted || []).map((e) => `${formatTs(e.ts)} | ${e.groupName || e.groupId} | ${e.match || ''} | ${e.action || ''} | ${e.snippet || ''} | ${e.id || ''}`).join('\n');
  }
  if (skipped) {
    skipped.textContent = (payload.skipped || []).map((e) => `${formatTs(e.ts)} | ${e.groupName || e.groupId} | ${e.reason || ''} | ${e.snippet || ''} | ${e.id || ''}`).join('\n');
  }
}

function renderCheckpoints(map) {
  const el = document.getElementById('backlog-checkpoints');
  if (!el) return;
  const entries = Object.entries(map || {});
  if (!entries.length) {
    el.textContent = 'No checkpoints yet.';
    return;
  }
  el.innerHTML = entries.map(([id, ts]) => `<div>${id}: ${formatTs(ts)}</div>`).join('');
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
  document.getElementById('clients-text').value = text;
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
    addLog('Clients saved');
  });
  document.getElementById('clear-clients').addEventListener('click', async () => {
    await api.request('/api/clients/clear', { method: 'POST' });
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

  document.getElementById('qr-close')?.addEventListener('click', () => document.getElementById('qr-modal').classList.add('hidden'));

  document.getElementById('copy-interacted').addEventListener('click', () => copyLog('interacted-log'));
  document.getElementById('copy-skipped').addEventListener('click', () => copyLog('skipped-log'));
  document.getElementById('clear-interacted').addEventListener('click', () => clearLog('interacted'));
  document.getElementById('clear-skipped').addEventListener('click', () => clearLog('skipped'));
}

function bindForwardingControls() {
  document.getElementById('forward-flush')?.addEventListener('click', async () => {
    await api.request('/api/forward/flush', { method: 'POST' });
  });
  document.getElementById('forward-clear')?.addEventListener('click', async () => {
    await api.request('/api/forward/clear', { method: 'POST' });
    addLog('Forward queue cleared');
  });
}

function copyLog(id) {
  const el = document.getElementById(id);
  if (!el) return;
  navigator.clipboard.writeText(el.textContent || '');
}

async function clearLog(type) {
  await api.request('/api/logs/clear', { method: 'POST', body: JSON.stringify({ type }) });
  const logs = await api.request('/api/logs');
  renderInteractionLogs(logs);
}

function buildBacklogPayload() {
  return {
    hours: Number(document.getElementById('backlog-hours').value) || undefined,
    sinceTimestamp: Number(document.getElementById('backlog-since').value) || undefined,
    limitCap: Number(document.getElementById('backlog-limit').value) || 500,
  };
}

function renderGroups(groups) {
  const container = document.getElementById('groups-list');
  container.innerHTML = '';
  if (!Array.isArray(groups)) return;
  groups.forEach((g) => {
    const item = document.createElement('div');
    item.className = 'group-item';
    item.innerHTML = `<label><input type="checkbox" value="${g.id}" ${g.selected ? 'checked' : ''}/> ${g.name}</label>`;
    container.appendChild(item);
  });
  updateForwardTargetOptions(groups);
}

function updateForwardTargetOptions(groups) {
  const select = document.getElementById('forward-target');
  if (!select) return;
  select.innerHTML = '<option value="">-- Select target group --</option>';
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
    div.textContent = `${row.groupId}: ${row.found || 0} messages${row.processed ? ` | queued ${row.processed}` : ''} | last ${formatTs(row.lastChecked)}`;
    container.appendChild(div);
  });
}

function renderBulkStatus(state) {
  const status = document.getElementById('bulk-status');
  const progress = document.getElementById('bulk-progress');
  if (status) status.textContent = `${state.state}${state.paused ? ' (paused)' : ''}`;
  if (progress) progress.textContent = `${state.sent} / ${state.total}`;
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
  const lines = rawText.split('\n');
  const messages = parseNotifications(rawText, mode);
  const preview = messages.slice(0, 3).map((m, idx) => `${idx + 1}) ${m}`).join('\n---\n');
  const analysis = document.getElementById('bulk-analysis');
  analysis.textContent = `Total lines: ${lines.filter((l) => l.trim() !== '').length}\nNotifications: ${messages.length}\nPreview:\n${preview || 'N/A'}`;
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

init();
