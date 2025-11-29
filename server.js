const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const cors = require('cors');
const fs = require('fs-extra');
const path = require('path');
const WhatsAppBot = require('./bot');
const store = require('./store');

const PORT = process.env.PORT || 3000;

const app = express();
const server = http.createServer(app);
const io = socketIo(server, {
  cors: { origin: true, credentials: true },
});

app.use(cors({ origin: true, credentials: true }));
app.use(express.json({ limit: '2mb' }));
app.use(express.static(path.join(__dirname, 'public')));

const bot = new WhatsAppBot();
bot.init();

function handleWaNotReady(res, err) {
  if (err && (err.message === 'WA_NOT_READY' || err.code === 'WA_NOT_READY')) {
    return res.status(409).json({ error: 'WA_NOT_READY' });
  }
  return false;
}

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

app.post('/api/start', async (req, res) => {
  await bot.setRunning(true);
  res.json({ success: true });
});

app.post('/api/stop', async (req, res) => {
  await bot.setRunning(false);
  res.json({ success: true });
});

app.get('/api/qr', (req, res) => {
  res.json({ qr: bot.getLastQr() });
});

app.post('/api/session/clear', async (req, res) => {
  const sessionPath = path.join(store.dataDir, 'sessions');
  if (await fs.pathExists(sessionPath)) {
    await fs.remove(sessionPath);
  }
  res.json({ success: true });
});

app.get('/api/groups', async (req, res) => {
  try {
    const groups = await bot.refreshGroups();
    res.json(groups);
  } catch (err) {
    if (handleWaNotReady(res, err)) return;
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/groups', async (req, res) => {
  await bot.setSelectedGroups(req.body.ids || []);
  res.json({ success: true });
});

app.get('/api/clients', async (req, res) => {
  const clients = await store.read('clients.json');
  res.json(clients);
});

app.post('/api/clients', async (req, res) => {
  await bot.setClients(req.body.rawText || '');
  res.json({ success: true });
});

app.post('/api/clients/clear', async (req, res) => {
  await bot.setClients('');
  res.json({ success: true });
});

app.get('/api/settings', async (req, res) => {
  const settings = await store.read('settings.json');
  res.json(settings);
});

app.post('/api/settings', async (req, res) => {
  await bot.setSettings(req.body);
  res.json({ success: true });
});

app.post('/api/backlog/check', async (req, res) => {
  const { sinceTimestamp, hours, limitCap } = req.body || {};
  try {
    const result = await bot.checkBacklog({ sinceTimestamp, hours, limitCap });
    res.json(result);
  } catch (err) {
    if (handleWaNotReady(res, err)) return;
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/backlog/process', async (req, res) => {
  const { sinceTimestamp, hours, limitCap } = req.body || {};
  try {
    const result = await bot.processBacklog({ sinceTimestamp, hours, limitCap });
    res.json(result);
  } catch (err) {
    if (handleWaNotReady(res, err)) return;
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/bulk/start', async (req, res) => {
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

app.post('/api/bulk/pause', async (req, res) => {
  await bot.pauseBulk();
  res.json({ success: true });
});

app.post('/api/bulk/resume', async (req, res) => {
  await bot.resumeBulk();
  res.json({ success: true });
});

app.post('/api/bulk/stop', async (req, res) => {
  await bot.stopBulk();
  res.json({ success: true });
});

app.get('/api/bulk/status', (req, res) => {
  res.json(bot.getBulkPublicState());
});

app.get('/api/backlog/last', (req, res) => {
  res.json(bot.lastChecked || {});
});

app.get('/api/logs', (req, res) => {
  res.json(bot.getInteractionLogs());
});

app.post('/api/logs/clear', async (req, res) => {
  const { type } = req.body || {};
  await bot.clearInteractionLogs(type);
  res.json({ success: true });
});

app.get('/api/forward/state', (req, res) => {
  res.json(bot.getForwardState());
});

app.post('/api/forward/flush', async (req, res) => {
  await bot.flushForwardBatch(true);
  res.json({ success: true });
});

app.post('/api/forward/clear', async (req, res) => {
  await bot.clearForwardQueue();
  res.json({ success: true });
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
