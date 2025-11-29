const api = {
  async request(path, options = {}) {
    const res = await fetch(path, { credentials: 'include', headers: { 'Content-Type': 'application/json' }, ...options });
    if (res.status === 401) {
      showLogin();
      throw new Error('Unauthorized');
    }
    return res.json();
  },
};

const socket = io('/', { withCredentials: true, autoConnect: false });

let isDashboard = window.location.pathname.includes('index.html') || window.location.pathname === '/';
let isBulk = window.location.pathname.includes('bulk.html');

function showLogin() {
  document.getElementById('login-overlay').classList.remove('hidden');
}

async function login() {
  const username = document.getElementById('login-user').value;
  const password = document.getElementById('login-pass').value;
  const res = await fetch('/api/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username, password }),
  });
  if (res.ok) {
    document.getElementById('login-overlay').classList.add('hidden');
    socket.connect();
    init();
  } else {
    const data = await res.json();
    document.getElementById('login-error').textContent = data.error || 'Login failed';
  }
}

function setupLogin() {
  const overlay = document.getElementById('login-overlay');
  if (!overlay) return;
  document.getElementById('login-btn').addEventListener('click', login);
}

async function init() {
  try {
    await api.request('/api/status');
    socket.connect();
    if (isDashboard) initDashboard();
    if (isBulk) initBulk();
  } catch (err) {
    showLogin();
  }
}

function updateStatus(status) {
  const connected = document.getElementById('connected-pill');
  const running = document.getElementById('running-pill');
  if (connected) {
    connected.textContent = status.connected ? 'Connected' : 'Disconnected';
    connected.className = `status-pill ${status.connected ? 'ok' : 'bad'}`;
  }
  if (running) {
    running.textContent = status.running ? 'Running' : 'Stopped';
    running.className = `status-pill ${status.running ? 'ok' : 'bad'}`;
  }
  if (status.bulk) renderBulkStatus(status.bulk);
}

function addLog(line, target = 'logs') {
  const el = document.getElementById(target);
  if (!el) return;
  el.textContent += `${line}\n`;
  el.scrollTop = el.scrollHeight;
}

function initSocket() {
  socket.on('connect_error', showLogin);
  socket.on('status', updateStatus);
  socket.on('log', (msg) => addLog(msg));
  socket.on('qr', (qr) => {
    const modal = document.getElementById('qr-modal');
    const img = document.getElementById('qr-image');
    if (img) img.src = qr;
    if (modal) modal.classList.remove('hidden');
  });
  socket.on('bulk:update', renderBulkStatus);
  socket.on('backlog:update', renderBacklog);
}

async function initDashboard() {
  initSocket();
  bindDashboard();
  await loadClients();
  await loadSettings();
}

async function loadClients() {
  const clients = await api.request('/api/clients');
  const text = clients.map((c) => `${c.name || ''}${c.emoji ? `|${c.emoji}` : ''}`).join('\n');
  document.getElementById('clients-text').value = text;
}

async function loadSettings() {
  const settings = await api.request('/api/settings');
  document.getElementById('rpm').value = settings.rpm;
  document.getElementById('cooldown').value = settings.cooldownSeconds;
  document.getElementById('normalize').checked = settings.normalizeArabicEnabled;
  document.getElementById('replyMode').checked = settings.replyMode;
  document.getElementById('defaultEmoji').value = settings.defaultEmoji || '';
}

function bindDashboard() {
  document.getElementById('start-btn').addEventListener('click', () => api.request('/api/start', { method: 'POST' }));
  document.getElementById('stop-btn').addEventListener('click', () => api.request('/api/stop', { method: 'POST' }));

  document.getElementById('qr-btn').addEventListener('click', async () => {
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

  document.getElementById('save-clients').addEventListener('click', async () => {
    const rawText = document.getElementById('clients-text').value;
    await api.request('/api/clients', { method: 'POST', body: JSON.stringify({ rawText }) });
    addLog('Clients saved');
  });

  document.getElementById('save-settings').addEventListener('click', async () => {
    const payload = {
      rpm: Number(document.getElementById('rpm').value) || 20,
      cooldownSeconds: Number(document.getElementById('cooldown').value) || 3,
      normalizeArabicEnabled: document.getElementById('normalize').checked,
      replyMode: document.getElementById('replyMode').checked,
      defaultEmoji: document.getElementById('defaultEmoji').value || '✅',
    };
    await api.request('/api/settings', { method: 'POST', body: JSON.stringify(payload) });
    addLog('Settings saved');
  });

  document.getElementById('fetch-groups').addEventListener('click', async () => {
    const groups = await api.request('/api/groups');
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
    renderBacklog(result);
  });

  document.getElementById('backlog-process').addEventListener('click', async () => {
    const payload = buildBacklogPayload();
    const result = await api.request('/api/backlog/process', { method: 'POST', body: JSON.stringify(payload) });
    renderBacklog(result);
  });

  document.getElementById('qr-close').addEventListener('click', () => document.getElementById('qr-modal').classList.add('hidden'));
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
  groups.forEach((g) => {
    const item = document.createElement('div');
    item.className = 'group-item';
    item.innerHTML = `<label><input type="checkbox" value="${g.id}" ${g.selected ? 'checked' : ''}/> ${g.name}</label>`;
    container.appendChild(item);
  });
}

function renderBacklog(data) {
  const container = document.getElementById('backlog-output');
  if (!container) return;
  container.innerHTML = '';
  data.forEach((row) => {
    const div = document.createElement('div');
    div.textContent = `${row.groupId}: ${row.found} messages${row.processed ? ` | queued ${row.processed}` : ''}`;
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
  initSocket();
  bindBulk();
  await loadBulkGroups();
}

async function loadBulkGroups() {
  const groups = await api.request('/api/groups');
  const select = document.getElementById('bulk-group');
  select.innerHTML = '';
  groups.forEach((g) => {
    const option = document.createElement('option');
    option.value = g.id;
    option.textContent = g.name;
    select.appendChild(option);
  });
}

function bindBulk() {
  document.getElementById('bulk-start').addEventListener('click', async () => {
    const messages = document.getElementById('bulk-messages').value.split('\n').filter(Boolean);
    const groupId = document.getElementById('bulk-group').value;
    const delaySeconds = Number(document.getElementById('bulk-delay').value) || 2;
    const rpm = Number(document.getElementById('bulk-rpm').value) || 10;
    await api.request('/api/bulk/start', { method: 'POST', body: JSON.stringify({ groupId, messages, delaySeconds, rpm }) });
  });

  document.getElementById('bulk-pause').addEventListener('click', () => api.request('/api/bulk/pause', { method: 'POST' }));
  document.getElementById('bulk-resume').addEventListener('click', () => api.request('/api/bulk/resume', { method: 'POST' }));
  document.getElementById('bulk-stop').addEventListener('click', () => api.request('/api/bulk/stop', { method: 'POST' }));
}

setupLogin();
init();
