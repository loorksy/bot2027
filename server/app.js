const path = require('path');
const fs = require('fs');
const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const bodyParser = require('body-parser');
const cookieParser = require('cookie-parser');
const jwt = require('jsonwebtoken');
const cors = require('cors');
const { Bot, getBotInstance } = require('../bot');
const botRoutes = require('./routes/bot');
const settingsRoutes = require('./routes/settings');
const authRoutes = require('./routes/auth');
const bulkRoutes = require('./routes/bulk');

const app = express();
const server = http.createServer(app);
const io = socketIo(server, { cors: { origin: '*', methods: ['GET', 'POST'] } });

const DATA_DIR = path.join(__dirname, '..', 'data');
const DASHBOARD_DIR = path.join(__dirname, '..', 'dashboard');
const JWT_SECRET = process.env.JWT_SECRET || 'super-secret-change-me';

if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

app.use(cors());
app.use(bodyParser.json({ limit: '2mb' }));
app.use(cookieParser());

const authMiddleware = (req, res, next) => {
  const publicPaths = ['/login', '/api/login', '/dashboard/login.html', '/dashboard/styles.css', '/dashboard/scripts.js'];
  if (publicPaths.includes(req.path) || req.path.startsWith('/socket.io')) return next();
  const token = req.cookies.token || (req.headers.authorization || '').replace('Bearer ', '');
  if (!token) {
    if (req.method === 'GET') return res.redirect('/dashboard/login.html');
    return res.status(401).json({ error: 'unauthorized' });
  }
  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    req.user = decoded;
    return next();
  } catch (e) {
    return res.status(401).json({ error: 'invalid token' });
  }
};

app.use(authMiddleware);

const bot = getBotInstance({ sessionsDir: path.join(__dirname, '..', 'sessions') });
(async () => {
  await bot.init();
  const saved = require('./routes/utils').loadSettings();
  if (saved.settings) bot.setSettings(saved.settings);
  if (saved.clients) bot.setClients(saved.clients);
  if (saved.selectedGroupIds) bot.setSelectedGroups(saved.selectedGroupIds);
})();

app.use('/api', botRoutes({ bot, io, jwt, JWT_SECRET }));
app.use('/api', settingsRoutes({ bot }));
app.use('/api', bulkRoutes({ bot }));
app.use('/', authRoutes({ jwt, JWT_SECRET }));

app.use('/dashboard', express.static(DASHBOARD_DIR));
app.get('/dashboard', (_req, res) => res.sendFile(path.join(DASHBOARD_DIR, 'index.html')));
app.get('/dashboard/*', (_req, res) => res.sendFile(path.join(DASHBOARD_DIR, 'index.html')));
app.get('/', (_req, res) => res.redirect('/dashboard/login.html'));

io.use((socket, next) => {
  const token = socket.handshake.auth?.token;
  try {
    jwt.verify(token, JWT_SECRET);
    next();
  } catch {
    next(new Error('unauthorized'));
  }
});

iobotAttach(bot, io);
io.on('connection', (socket) => {
  socket.emit('status', bot.getStatus());
  if (bot.qrDataUrl) socket.emit('qr', { qr: bot.qrDataUrl });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Server listening on http://localhost:${PORT}`);
});

function iobotAttach(botInstance, ioInstance) {
  botInstance.onLog((line) => ioInstance.emit('log', { line, ts: Date.now() }));
  botInstance.emitter.on('qr', (qr) => ioInstance.emit('qr', { qr }));
  botInstance.emitter.on('ready', () => ioInstance.emit('status', botInstance.getStatus()));
  botInstance.emitter.on('disconnected', () => ioInstance.emit('status', botInstance.getStatus()));
}

module.exports = app;
