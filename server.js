const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const cors = require('cors');
const fs = require('fs-extra');
const path = require('path');
const cookieParser = require('cookie-parser');
const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const WhatsAppBot = require('./bot');
const store = require('./store');

const PORT = process.env.PORT || 3000;
const JWT_SECRET = process.env.JWT_SECRET || 'CHANGE_ME_SECRET';
const TOKEN_NAME = 'token';

const MASTER_EMAIL = 'loorksy@gmail.com';
const MASTER_PASSWORD = 'Ahmetlork@29cb';

const DEFAULT_PERMISSIONS = {
  can_scan_backlog: false,
  can_send_messages: false,
  can_manage_lists: false,
  can_manage_settings: false,
  can_control_bot: false,
  can_manage_forwarding: false,
  can_view_logs: false,
  is_admin: false,
};

const app = express();
const server = http.createServer(app);
const io = socketIo(server, {
  cors: { origin: true, credentials: true },
});

app.use(cors({ origin: true, credentials: true }));
app.use(express.json({ limit: '2mb' }));
app.use(express.urlencoded({ extended: true }));
app.use(cookieParser());
app.use(express.static(path.join(__dirname, 'public')));

function hashPassword(password) {
  return crypto.createHash('sha256').update(password).digest('hex');
}

function mergePermissions(perms = {}, forceAll = false) {
  const merged = { ...DEFAULT_PERMISSIONS, ...(perms || {}) };
  if (forceAll) {
    Object.keys(DEFAULT_PERMISSIONS).forEach((k) => {
      merged[k] = true;
    });
  }
  return merged;
}

async function ensureMasterUser() {
  await store.ensure();
  const users = (await store.read('users.json')) || [];
  const idx = users.findIndex((u) => u.email === MASTER_EMAIL);
  if (idx === -1) {
    const master = {
      email: MASTER_EMAIL,
      password: hashPassword(MASTER_PASSWORD),
      permissions: mergePermissions({}, true),
    };
    users.push(master);
    await store.write('users.json', users);
    console.log('Master admin user created');
    return;
  }
  const existing = users[idx];
  const mergedPerms = mergePermissions(existing.permissions, true);
  if (JSON.stringify(existing.permissions || {}) !== JSON.stringify(mergedPerms)) {
    users[idx] = { ...existing, permissions: mergedPerms };
    await store.write('users.json', users);
    console.log('Master admin permissions updated');
  }
}

function sanitizeUser(user) {
  if (!user) return null;
  const { password, ...rest } = user;
  return { ...rest, permissions: mergePermissions(user.permissions || {}) };
}

function signToken(user) {
  const payload = { email: user.email, permissions: mergePermissions(user.permissions || {}) };
  return jwt.sign(payload, JWT_SECRET, { expiresIn: '7d' });
}

async function findUserByEmail(email) {
  const users = (await store.read('users.json')) || [];
  return users.find((u) => u.email === email);
}

async function authMiddleware(req, res, next) {
  const token = req.cookies[TOKEN_NAME] || (req.headers.authorization || '').replace('Bearer ', '');
  if (!token) return res.status(401).json({ error: 'UNAUTHORIZED' });
  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    req.user = decoded;
    return next();
  } catch (err) {
    return res.status(401).json({ error: 'UNAUTHORIZED' });
  }
}

function requirePermission(key) {
  return (req, res, next) => {
    if (req.user?.permissions?.is_admin) return next();
    if (!req.user || !req.user.permissions || !req.user.permissions[key]) {
      return res.status(403).json({ error: 'FORBIDDEN' });
    }
    return next();
  };
}

const requireAdmin = requirePermission('is_admin');

function requireAny(keys = []) {
  return (req, res, next) => {
    const perms = req.user?.permissions || {};
    if (keys.some((k) => perms[k])) return next();
    return res.status(403).json({ error: 'FORBIDDEN' });
  };
}

function requireAnyPermission(keys = []) {
  return (req, res, next) => {
    const perms = req.user?.permissions || {};
    if (perms.is_admin) return next();
    if (keys.some((k) => perms[k])) return next();
    return res.status(403).json({ error: 'FORBIDDEN' });
  };
}

const bot = new WhatsAppBot();
bot.init();
ensureMasterUser();

app.get('/login', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'login.html'));
});

app.post('/login', async (req, res) => {
  const { email, password } = req.body || {};
  if (!email || !password) {
    return res.redirect('/login?error=missing_credentials');
  }
  const user = await findUserByEmail(email);
  if (!user) {
    return res.redirect('/login?error=invalid_credentials');
  }
  const hashed = hashPassword(password);
  if (hashed !== user.password) {
    return res.redirect('/login?error=invalid_credentials');
  }
  const token = signToken(user);
  res.cookie(TOKEN_NAME, token, { httpOnly: true, sameSite: 'lax' });
  return res.redirect('/');
});

function handleWaNotReady(res, err) {
  if (err && (err.message === 'WA_NOT_READY' || err.code === 'WA_NOT_READY')) {
    return res.status(409).json({ error: 'WA_NOT_READY' });
  }
  return false;
}

app.post('/api/login', async (req, res) => {
  const { email, password } = req.body || {};
  if (!email || !password) return res.status(400).json({ error: 'MISSING_CREDENTIALS' });
  const user = await findUserByEmail(email);
  if (!user) return res.status(401).json({ error: 'INVALID_CREDENTIALS' });
  const hashed = hashPassword(password);
  if (hashed !== user.password) return res.status(401).json({ error: 'INVALID_CREDENTIALS' });
  const token = signToken(user);
  res.cookie(TOKEN_NAME, token, { httpOnly: true, sameSite: 'lax' });
  res.json({ success: true, user: sanitizeUser(user) });
});

app.use('/api', authMiddleware);

app.get('/api/me', (req, res) => {
  res.json({ user: req.user });
});

app.get('/api/status', (req, res) => {
  res.json({
    connected: bot.connected,
    running: bot.running,
    linkState: bot.linkState,
    bulk: bot.getBulkPublicState(),
    lastChecked: bot.lastChecked,
    forward: bot.getForwardState(),
  });
});

app.post('/api/start', requireAny(['is_admin', 'can_control_bot']), async (req, res) => {
  await bot.setRunning(true);
  res.json({ success: true });
});

app.post('/api/stop', requireAny(['is_admin', 'can_control_bot']), async (req, res) => {
  await bot.setRunning(false);
  res.json({ success: true });
});

app.get('/api/qr', (req, res) => {
  res.json({ qr: bot.getLastQr() });
});

app.post('/api/session/clear', requireAny(['is_admin', 'can_control_bot']), async (req, res) => {
  const sessionPath = path.join(store.dataDir, 'sessions');
  if (await fs.pathExists(sessionPath)) {
    await fs.remove(sessionPath);
  }
  res.json({ success: true });
});

app.get('/api/groups', requireAnyPermission(['can_manage_lists', 'can_send_messages', 'can_manage_forwarding']), async (req, res) => {
  try {
    const groups = await bot.refreshGroups();
    res.json(groups);
  } catch (err) {
    if (handleWaNotReady(res, err)) return;
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/groups', requirePermission('can_manage_lists'), async (req, res) => {
  await bot.setSelectedGroups(req.body.ids || []);
  res.json({ success: true });
});

app.get('/api/clients', requirePermission('can_manage_lists'), async (req, res) => {
  const clients = await store.read('clients.json');
  res.json(clients);
});

app.post('/api/clients', requirePermission('can_manage_lists'), async (req, res) => {
  await bot.setClients(req.body.rawText || '');
  res.json({ success: true });
});

app.post('/api/clients/clear', requirePermission('can_manage_lists'), async (req, res) => {
  await bot.setClients('');
  res.json({ success: true });
});

app.get('/api/settings', requireAnyPermission(['can_manage_settings', 'can_manage_lists', 'can_manage_forwarding']), async (req, res) => {
  const settings = await store.read('settings.json');
  res.json(settings);
});

app.post('/api/settings', requireAny(['is_admin', 'can_manage_settings', 'can_manage_lists', 'can_manage_forwarding']), async (req, res) => {
  try {
    await bot.setSettings(req.body);
    res.json({ success: true });
  } catch (err) {
    bot.emitLog(`Settings save failed: ${err.message}`);
    res.status(500).json({ error: err.message || 'Failed to save settings' });
  }
});

app.post('/api/backlog/check', requirePermission('can_scan_backlog'), async (req, res) => {
  const { sinceTimestamp, hours, limitCap } = req.body || {};
  try {
    const result = await bot.checkBacklog({ sinceTimestamp, hours, limitCap });
    res.json(result);
  } catch (err) {
    if (handleWaNotReady(res, err)) return;
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/backlog/process', requirePermission('can_scan_backlog'), async (req, res) => {
  const { sinceTimestamp, hours, limitCap } = req.body || {};
  try {
    const result = await bot.processBacklog({ sinceTimestamp, hours, limitCap });
    res.json(result);
  } catch (err) {
    if (handleWaNotReady(res, err)) return;
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/bulk/start', requirePermission('can_send_messages'), async (req, res) => {
  try {
    const { groupId, messages, delaySeconds, rpm } = req.body;
    const parsedMessages = (messages || []).filter((m) => typeof m === 'string' && m.trim() !== '');
    await bot.startBulk({ groupId, messages: parsedMessages, delaySeconds, rpm });
    res.json({ success: true });
  } catch (err) {
    if (handleWaNotReady(res, err)) return;
    res.status(400).json({ error: err.message });
  }
});

app.post('/api/bulk/pause', requirePermission('can_send_messages'), async (req, res) => {
  await bot.pauseBulk();
  res.json({ success: true });
});

app.post('/api/bulk/resume', requirePermission('can_send_messages'), async (req, res) => {
  await bot.resumeBulk();
  res.json({ success: true });
});

app.post('/api/bulk/stop', requirePermission('can_send_messages'), async (req, res) => {
  await bot.stopBulk();
  res.json({ success: true });
});

app.get('/api/bulk/status', requirePermission('can_send_messages'), (req, res) => {
  res.json(bot.getBulkPublicState());
});

app.get('/api/backlog/last', requirePermission('can_scan_backlog'), (req, res) => {
  res.json(bot.lastChecked || {});
});

app.get('/api/logs', requirePermission('can_view_logs'), (req, res) => {
  res.json(bot.getInteractionLogs());
});

app.post('/api/logs/clear', requireAdmin, async (req, res) => {
  const { type } = req.body || {};
  await bot.clearInteractionLogs(type);
  res.json({ success: true });
});

app.get('/api/users', requireAdmin, async (req, res) => {
  const users = (await store.read('users.json')) || [];
  res.json(users.map((u) => sanitizeUser(u)));
});

app.post('/api/users', requireAdmin, async (req, res) => {
  const { email, password, permissions = {} } = req.body || {};
  if (!email || !password) return res.status(400).json({ error: 'MISSING_FIELDS' });
  const users = (await store.read('users.json')) || [];
  if (users.some((u) => u.email === email)) return res.status(409).json({ error: 'EXISTS' });
  const user = {
    email,
    password: hashPassword(password),
    permissions: mergePermissions({ ...permissions }),
  };
  users.push(user);
  await store.write('users.json', users);
  res.json({ success: true, user: sanitizeUser(user) });
});

app.put('/api/users/:email', requireAdmin, async (req, res) => {
  const { email } = req.params;
  const { password, permissions = {} } = req.body || {};
  const users = (await store.read('users.json')) || [];
  const idx = users.findIndex((u) => u.email === email);
  if (idx === -1) return res.status(404).json({ error: 'NOT_FOUND' });
  const updated = { ...users[idx] };
  if (password) updated.password = hashPassword(password);
  updated.permissions = mergePermissions(permissions);
  users[idx] = updated;
  await store.write('users.json', users);
  res.json({ success: true, user: sanitizeUser(updated) });
});

app.delete('/api/users/:email', requireAdmin, async (req, res) => {
  const { email } = req.params;
  let users = (await store.read('users.json')) || [];
  users = users.filter((u) => u.email !== email);
  await store.write('users.json', users);
  res.json({ success: true });
});

app.get('/api/forward/state', requireAnyPermission(['can_manage_forwarding', 'can_manage_lists', 'can_send_messages']), (req, res) => {
  res.json(bot.getForwardState());
});

app.post('/api/forward/flush', requireAny(['can_manage_forwarding', 'can_send_messages']), async (req, res) => {
  await bot.flushForwardBatch(true);
  res.json({ success: true });
});

app.post('/api/forward/clear', requireAny(['can_manage_forwarding', 'can_send_messages']), async (req, res) => {
  await bot.clearForwardQueue();
  res.json({ success: true });
});

io.use((socket, next) => {
  const cookieHeader = socket.handshake.headers.cookie || '';
  const cookieMap = Object.fromEntries(
    cookieHeader
      .split(';')
      .map((c) => c.trim())
      .filter(Boolean)
      .map((c) => c.split('='))
      .map(([k, v]) => [k, decodeURIComponent(v || '')])
  );
  const token = cookieMap[TOKEN_NAME];
  if (!token) return next(new Error('UNAUTHORIZED'));
  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    socket.user = decoded;
    return next();
  } catch (err) {
    return next(new Error('UNAUTHORIZED'));
  }
});

io.on('connection', (socket) => {
  const logHandler = (msg) => socket.emit('log', msg);
  const qrHandler = (qr) => socket.emit('qr', qr);
  const statusHandler = (status) => socket.emit('status', status);
  const bulkHandler = (state) => socket.emit('bulk:update', state);
  const backlogHandler = (payload) => socket.emit('backlog:update', payload);
  const interactionHandler = (payload) => socket.emit('interaction:log', payload);

  bot.on('log', logHandler);
  bot.on('qr', qrHandler);
  bot.on('status', statusHandler);
  bot.on('bulk:update', bulkHandler);
  bot.on('backlog:update', backlogHandler);
  bot.on('interaction:log', interactionHandler);

  socket.emit('status', {
    connected: bot.connected,
    running: bot.running,
    linkState: bot.linkState,
    bulk: bot.getBulkPublicState(),
    lastChecked: bot.lastChecked,
    forward: bot.getForwardState(),
  });
  socket.emit('interaction:log', bot.getInteractionLogs());

  socket.on('disconnect', () => {
    bot.off('log', logHandler);
    bot.off('qr', qrHandler);
    bot.off('status', statusHandler);
    bot.off('bulk:update', bulkHandler);
    bot.off('backlog:update', backlogHandler);
    bot.off('interaction:log', interactionHandler);
  });
});

server.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
