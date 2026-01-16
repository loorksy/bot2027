const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const cors = require('cors');
const fs = require('fs-extra');
const path = require('path');
const cookieParser = require('cookie-parser');
const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const multer = require('multer');
const { parse: csvParse } = require('csv-parse/sync');
const WhatsAppBot = require('./bot');
const store = require('./store');
const aiAgent = require('./src/ai_agent_v1');
const customFields = require('./src/ai_agent_v1/customFields');

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

// Trust proxy for HTTPS behind reverse proxy (Kubernetes/Nginx)
app.set('trust proxy', 1);

app.use(cors({ origin: true, credentials: true }));
app.use(express.json({ limit: '2mb' }));
app.use(express.urlencoded({ extended: true }));
app.use(cookieParser());
app.use(express.static(path.join(__dirname, 'public')));

// Global error handlers to prevent server crash from WhatsApp/Puppeteer errors
process.on('uncaughtException', (err) => {
  console.error('[UNCAUGHT ERROR]', err.message);
  // Don't exit - keep server running
});

process.on('unhandledRejection', (reason, promise) => {
  console.error('[UNHANDLED REJECTION]', reason);
  // Don't exit - keep server running
});




// Multer setup for file uploads
const upload = multer({
  dest: path.join(__dirname, 'temp'),
  limits: { fileSize: 10 * 1024 * 1024 } // 10MB limit
});

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

// ⚠️ AUTH DISABLED TEMPORARILY - RESTORE LATER
async function authMiddleware(req, res, next) {
  // Set default admin user for all requests
  req.user = {
    email: 'loorksy@gmail.com',
    permissions: {
      can_scan_backlog: true,
      can_send_messages: true,
      can_manage_lists: true,
      can_manage_settings: true,
      can_control_bot: true,
      can_manage_forwarding: true,
      can_view_logs: true,
      is_admin: true
    }
  };
  return next();
}

/* ORIGINAL AUTH - RESTORE THIS LATER:
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
*/

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
  // Cookie settings for both HTTP and HTTPS
  const cookieOptions = { 
    httpOnly: true, 
    sameSite: 'lax',
    maxAge: 7 * 24 * 60 * 60 * 1000, // 7 days
    path: '/'
  };
  // Add secure flag if behind HTTPS proxy
  if (req.secure || req.headers['x-forwarded-proto'] === 'https') {
    cookieOptions.secure = true;
    cookieOptions.sameSite = 'none';
  }
  res.cookie(TOKEN_NAME, token, cookieOptions);
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
  // Cookie settings for both HTTP and HTTPS
  const cookieOptions = { 
    httpOnly: true, 
    sameSite: 'lax',
    maxAge: 7 * 24 * 60 * 60 * 1000, // 7 days
    path: '/'
  };
  // Add secure flag if behind HTTPS proxy
  if (req.secure || req.headers['x-forwarded-proto'] === 'https') {
    cookieOptions.secure = true;
    cookieOptions.sameSite = 'none';
  }
  res.cookie(TOKEN_NAME, token, cookieOptions);
  res.json({ success: true, user: sanitizeUser(user) });
});

app.use('/api', authMiddleware);

app.get('/api/me', (req, res) => {
  res.json({ user: req.user });
});

// Accounting Routes
const accountingApi = require('./src/accounting/routes/api');
app.use('/api/accounting', accountingApi);

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
  res.json({ qr: bot.lastQr });
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
  if (email === MASTER_EMAIL) {
    return res.status(403).json({ error: 'PROTECTED_USER' });
  }
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

// =====================================================
// AI Agent API Routes
// =====================================================

const aiModules = aiAgent.getModules();

// AI Settings - Unified Endpoint
app.get('/api/ai/settings', requireAdmin, async (req, res) => {
  try {
    const aiSettings = await aiModules.analyzer.getSettings();
    const botSettings = await settings.getSettings();
    // Merge both for frontend
    res.json({ ...aiSettings, ...botSettings });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/ai/settings', requireAdmin, async (req, res) => {
  try {
    const body = req.body;
    console.log('[API] Received settings update:', body); // DEBUG LOG

    const aiFields = ['enabled', 'openaiKey', 'modelChat', 'modelStt', 'modelTts', 'voiceTts', 'trustedSessionMinutes', 'agencyPercent'];
    const botFields = ['salaryTemplate', 'salaryCurrency', 'salaryFooter'];

    const aiUpdates = {};
    const botUpdates = {};

    // Separate fields
    Object.keys(body).forEach(key => {
      if (aiFields.includes(key)) aiUpdates[key] = body[key];
      if (botFields.includes(key)) botUpdates[key] = body[key];
    });

    console.log('[API] AI Updates:', aiUpdates); // DEBUG LOG
    console.log('[API] Bot Updates:', botUpdates); // DEBUG LOG

    // Update AI Settings
    if (Object.keys(aiUpdates).length > 0) {
      await aiModules.analyzer.updateSettings(aiUpdates);
    }

    // Update Bot Settings
    if (Object.keys(botUpdates).length > 0) {
      const updated = await settings.updateSettings(botUpdates);
      console.log('[API] Bot Settings saved:', updated); // DEBUG LOG
    }

    res.json({ success: true, message: 'Settings updated' });
  } catch (err) {
    console.error('[API] Settings save error:', err); // DEBUG LOG
    res.status(500).json({ error: err.message });
  }
});

// AI Clients
app.get('/api/ai/clients', requireAdmin, async (req, res) => {
  try {
    const clients = await aiModules.clients.getAllClients();
    res.json(clients);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Delete single linked client
app.delete('/api/ai/clients/:whatsappId', requireAdmin, async (req, res) => {
  try {
    const whatsappId = decodeURIComponent(req.params.whatsappId);
    await aiModules.clients.deleteClient(whatsappId);
    res.json({ success: true });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// Bulk delete linked clients
app.post('/api/ai/clients/bulk-delete', requireAdmin, async (req, res) => {
  try {
    const { ids } = req.body;
    if (!ids || !Array.isArray(ids) || ids.length === 0) {
      return res.status(400).json({ error: 'لم يتم تحديد عملاء للحذف' });
    }
    
    let deleted = 0;
    let failed = 0;
    
    for (const whatsappId of ids) {
      try {
        await aiModules.clients.deleteClient(whatsappId);
        deleted++;
      } catch (err) {
        failed++;
        console.error(`Failed to delete linked client ${whatsappId}:`, err.message);
      }
    }
    
    res.json({ success: true, deleted, failed });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// AI Usage
app.get('/api/ai/usage', requireAdmin, async (req, res) => {
  try {
    const summary = await aiModules.usage.getUsageSummary();
    res.json(summary);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/ai/usage/log', requireAdmin, async (req, res) => {
  try {
    const log = await aiModules.usage.getUsageLog();
    res.json(log);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/ai/usage/reset', requireAdmin, async (req, res) => {
  try {
    await aiModules.usage.resetUsage();
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Salary Periods
app.get('/api/ai/salary/periods', requireAdmin, async (req, res) => {
  try {
    const periods = await aiModules.salary.getPeriods();
    res.json(periods);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/ai/salary/upload', requireAdmin, upload.single('file'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'No file uploaded' });
    }

    const { name, idColumn, salaryColumn, agencyPercent } = req.body;

    if (!name || !idColumn || !salaryColumn) {
      await fs.remove(req.file.path);
      return res.status(400).json({ error: 'Missing required fields: name, idColumn, salaryColumn' });
    }

    // Read and parse file
    const fileContent = await fs.readFile(req.file.path, 'utf-8');
    let data;

    // Parse CSV
    try {
      data = csvParse(fileContent, {
        columns: true,
        skip_empty_lines: true,
        trim: true
      });
    } catch (parseErr) {
      await fs.remove(req.file.path);
      return res.status(400).json({ error: 'Failed to parse file: ' + parseErr.message });
    }

    if (!data || data.length === 0) {
      await fs.remove(req.file.path);
      return res.status(400).json({ error: 'No data found in file' });
    }

    // Validate columns exist
    const sampleRow = data[0];
    if (!(idColumn in sampleRow)) {
      await fs.remove(req.file.path);
      return res.status(400).json({ error: `ID column "${idColumn}" not found in file` });
    }
    if (!(salaryColumn in sampleRow)) {
      await fs.remove(req.file.path);
      return res.status(400).json({ error: `Salary column "${salaryColumn}" not found in file` });
    }

    // Create period
    const period = await aiModules.salary.createPeriod({
      name,
      idColumn,
      salaryColumn,
      agencyPercent: parseFloat(agencyPercent) || 0,
      data
    });

    // Clean up temp file
    await fs.remove(req.file.path);

    res.json({ success: true, period });

  } catch (err) {
    if (req.file) await fs.remove(req.file.path).catch(() => { });
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/ai/salary/upload/preview', requireAdmin, upload.single('file'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'No file uploaded' });
    }

    // Read and parse file
    const fileContent = await fs.readFile(req.file.path, 'utf-8');
    let data;

    try {
      data = csvParse(fileContent, {
        columns: true,
        skip_empty_lines: true,
        trim: true
      });
    } catch (parseErr) {
      await fs.remove(req.file.path);
      return res.status(400).json({ error: 'Failed to parse file: ' + parseErr.message });
    }

    if (!data || data.length === 0) {
      await fs.remove(req.file.path);
      return res.status(400).json({ error: 'No data found in file' });
    }

    // Get columns from first row
    const columns = Object.keys(data[0]);
    const sampleRows = data.slice(0, 5);

    // Clean up temp file
    await fs.remove(req.file.path);

    res.json({
      columns,
      sampleRows,
      totalRows: data.length
    });

  } catch (err) {
    if (req.file) await fs.remove(req.file.path).catch(() => { });
    res.status(500).json({ error: err.message });
  }
});

app.delete('/api/ai/salary/period/:id', requireAdmin, async (req, res) => {
  try {
    await aiModules.salary.deletePeriod(req.params.id);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/ai/salary/period/:id/current', requireAdmin, async (req, res) => {
  try {
    await aiModules.salary.setCurrentPeriod(req.params.id);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// =====================================================
// Registered Clients API (Admin-managed)
// =====================================================


// =====================================================
// Import / Export APIs (Must be before generic ID routes)
// =====================================================

// Helper to escape CSV fields
function escapeCsv(field) {
  if (field === null || field === undefined) return '';
  const stringField = String(field);
  if (stringField.includes(',') || stringField.includes('"') || stringField.includes('\n')) {
    return `"${stringField.replace(/"/g, '""')}"`;
  }
  return stringField;
}

// REGISTERED CLIENTS - Export CSV
app.get('/api/ai/registered-clients/export', requireAdmin, async (req, res) => {
  try {
    const clients = await registeredClients.getAllClients();
    const allFields = await customFields.getAllFields();

    const staticHeaders = ['ID', 'Full Name', 'Phone', 'Country', 'City', 'Address', 'Agency'];
    const customHeaders = allFields.map(f => f.name);
    const headers = [...staticHeaders, ...customHeaders];

    const rows = [headers.join(',')];

    Object.values(clients).forEach(client => {
      const staticData = [
        (client.ids || []).join('; '),
        client.fullName,
        client.phone,
        client.country,
        client.city,
        client.address,
        client.agencyName
      ];

      const customData = allFields.map(field => {
        const val = client.customFields ? client.customFields[field.id] : '';
        if (typeof val === 'object' && val !== null) {
          return `${val.value || ''}${val.subValue ? ` (${val.subValue})` : ''}`;
        }
        return val;
      });

      rows.push([...staticData, ...customData].map(escapeCsv).join(','));
    });

    const csvContent = '\uFEFF' + rows.join('\n');
    res.header('Content-Type', 'text/csv');
    res.header('Content-Disposition', 'attachment; filename="clients_export.csv"');
    res.send(csvContent);
  } catch (err) {
    console.error('Export error:', err);
    res.status(500).json({ error: err.message });
  }
});

// REGISTERED CLIENTS - Download Template
app.get('/api/ai/registered-clients/template', requireAdmin, async (req, res) => {
  try {
    const allFields = await customFields.getAllFields();

    const staticHeaders = ['ID', 'Full Name', 'Phone', 'Country', 'City', 'Address', 'Agency'];
    const customHeaders = allFields.map(f => f.name);
    const headers = [...staticHeaders, ...customHeaders];

    const rows = [headers.join(',')];
    const csvContent = '\uFEFF' + rows.join('\n');

    res.header('Content-Type', 'text/csv');
    res.header('Content-Disposition', 'attachment; filename="clients_template.csv"');
    res.send(csvContent);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// REGISTERED CLIENTS - Import CSV
app.post('/api/ai/registered-clients/import', requireAdmin, upload.single('file'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'No file uploaded' });

    const fileContent = await fs.readFile(req.file.path, 'utf8');
    const records = csvParse(fileContent, {
      columns: true,
      skip_empty_lines: true,
      trim: true,
      bom: true
    });

    const allFields = await customFields.getAllFields();
    let imported = 0;
    let updated = 0;
    let errors = [];

    for (const [index, row] of records.entries()) {
      try {
        const rawIds = row['ID'] || row['id'];
        const fullName = row['Full Name'] || row['Fullname'] || row['fullname'] || row['الاسم'];

        if (!rawIds || !fullName) {
          errors.push(`Row ${index + 1}: Missing ID or Full Name`);
          continue;
        }

        const ids = rawIds.split(/[;,]/).map(id => id.trim()).filter(Boolean);

        const clientData = {
          ids: ids,
          fullName: fullName,
          phone: row['Phone'] || row['phone'] || row['الهاتف'],
          country: row['Country'] || row['country'] || row['الدولة'],
          city: row['City'] || row['city'] || row['المدينة'],
          address: row['Address'] || row['address'] || row['العنوان'],
          agencyName: row['Agency'] || row['agency'] || row['الوكالة'],
          customFields: {}
        };

        allFields.forEach(field => {
          const val = row[field.name];
          if (val) clientData.customFields[field.id] = val;
        });

        let existingClient = null;
        for (const id of ids) {
          const found = await registeredClients.getClientById(id);
          if (found) {
            existingClient = found;
            break;
          }
        }

        if (existingClient) {
          await registeredClients.updateClient(existingClient.key, {
            ...clientData,
            ids: [...new Set([...(existingClient.ids || []), ...ids])]
          });
          updated++;
        } else {
          await registeredClients.addClient(clientData);
          imported++;
        }

      } catch (rowErr) {
        errors.push(`Row ${index + 1}: ${rowErr.message}`);
      }
    }

    await fs.remove(req.file.path);
    res.json({ success: true, imported, updated, errors });

  } catch (err) {
    if (req.file) await fs.remove(req.file.path);
    res.status(500).json({ error: err.message });
  }
});


const registeredClients = require('./src/ai_agent_v1/registeredClients');

// Get all registered clients
app.get('/api/ai/registered-clients', requireAdmin, async (req, res) => {
  try {
    const clients = await registeredClients.getAllClients();
    res.json(clients);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Get single client
app.get('/api/ai/registered-clients/:id', requireAdmin, async (req, res) => {
  try {
    const client = await registeredClients.getClientById(req.params.id);
    if (!client) {
      return res.status(404).json({ error: 'Client not found' });
    }
    res.json(client);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Add new client
app.post('/api/ai/registered-clients', requireAdmin, async (req, res) => {
  try {
    const client = await registeredClients.addClient(req.body);
    res.json({ success: true, client });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// Update client
app.put('/api/ai/registered-clients/:id', requireAdmin, async (req, res) => {
  try {
    const client = await registeredClients.updateClient(req.params.id, req.body);
    res.json({ success: true, client });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// Delete client
app.delete('/api/ai/registered-clients/:key', requireAdmin, async (req, res) => {
  try {
    await registeredClients.deleteClient(req.params.key);
    res.json({ success: true });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// Bulk delete registered clients
app.post('/api/ai/registered-clients/bulk-delete', requireAdmin, async (req, res) => {
  try {
    const { keys } = req.body;
    if (!keys || !Array.isArray(keys) || keys.length === 0) {
      return res.status(400).json({ error: 'لم يتم تحديد عملاء للحذف' });
    }
    
    let deleted = 0;
    let failed = 0;
    
    for (const key of keys) {
      try {
        await registeredClients.deleteClient(key);
        deleted++;
      } catch (err) {
        failed++;
        console.error(`Failed to delete client ${key}:`, err.message);
      }
    }
    
    res.json({ success: true, deleted, failed });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Import clients from Google Sheet
app.post('/api/ai/registered-clients/import-google-sheet', requireAdmin, async (req, res) => {
  try {
    const { url, sheetName } = req.body;
    
    if (!url) {
      return res.status(400).json({ error: 'الرجاء إدخال رابط Google Sheet' });
    }
    
    // Extract Sheet ID from URL
    const sheetIdMatch = url.match(/\/d\/([a-zA-Z0-9-_]+)/);
    if (!sheetIdMatch) {
      return res.status(400).json({ error: 'رابط Google Sheet غير صالح' });
    }
    
    const sheetId = sheetIdMatch[1];
    
    // Build export URL for CSV
    let exportUrl = `https://docs.google.com/spreadsheets/d/${sheetId}/export?format=csv`;
    if (sheetName) {
      exportUrl += `&sheet=${encodeURIComponent(sheetName)}`;
    }
    
    console.log('[Google Sheet Import] Fetching from:', exportUrl);
    
    // Fetch the CSV data
    const fetch = (await import('node-fetch')).default;
    const response = await fetch(exportUrl);
    
    if (!response.ok) {
      throw new Error('فشل جلب البيانات - تأكد أن الملف مشارك للعرض');
    }
    
    const csvContent = await response.text();
    
    // Check if it's actually CSV (not HTML error page)
    if (csvContent.trim().startsWith('<!DOCTYPE') || csvContent.trim().startsWith('<html')) {
      throw new Error('الملف غير متاح - تأكد أن الملف مشارك كـ "أي شخص لديه الرابط"');
    }
    
    // Parse CSV
    const data = csvParse(csvContent, {
      columns: true,
      skip_empty_lines: true,
      trim: true,
      relax_column_count: true
    });
    
    if (!data || data.length === 0) {
      return res.status(400).json({ error: 'الملف فارغ أو لا يحتوي على بيانات صالحة' });
    }
    
    console.log(`[Google Sheet Import] Parsed ${data.length} rows`);
    
    let imported = 0;
    let skipped = 0;
    let failed = 0;
    
    for (const row of data) {
      try {
        // Map columns (support both English and Arabic column names)
        const clientData = {
          ids: [],
          fullName: row.fullName || row['الاسم'] || row['الاسم الكامل'] || row.name || '',
          phone: row.phone || row['الهاتف'] || row['رقم الهاتف'] || '',
          country: row.country || row['الدولة'] || '',
          city: row.city || row['المدينة'] || '',
          address: row.address || row['العنوان'] || '',
          agencyName: row.agencyName || row['الوكالة'] || row.agency || ''
        };
        
        // Handle IDs (can be comma-separated or in 'id' column)
        const idValue = row.id || row.ids || row['رقم الهوية'] || row['ID'] || row['الرقم'] || '';
        if (idValue) {
          clientData.ids = idValue.toString().split(',').map(id => id.trim()).filter(id => id);
        }
        
        // Skip if no ID
        if (clientData.ids.length === 0) {
          failed++;
          continue;
        }
        
        // Check if client already exists
        const existingClient = await registeredClients.getClientById(clientData.ids[0]);
        if (existingClient) {
          skipped++;
          continue;
        }
        
        // Create client
        await registeredClients.createClient(clientData);
        imported++;
        
      } catch (err) {
        console.error('[Google Sheet Import] Row error:', err.message);
        failed++;
      }
    }
    
    console.log(`[Google Sheet Import] Done: imported=${imported}, skipped=${skipped}, failed=${failed}`);
    
    res.json({ 
      success: true, 
      imported, 
      skipped, 
      failed,
      total: data.length 
    });
    
  } catch (err) {
    console.error('[Google Sheet Import] Error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// Import clients from CSV
app.post('/api/ai/registered-clients/import', requireAdmin, upload.single('file'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'No file uploaded' });
    }

    const fileContent = await fs.readFile(req.file.path, 'utf-8');
    let data;

    try {
      data = csvParse(fileContent, {
        columns: true,
        skip_empty_lines: true,
        trim: true
      });
    } catch (parseErr) {
      await fs.remove(req.file.path);
      return res.status(400).json({ error: 'Failed to parse file: ' + parseErr.message });
    }

    const result = await registeredClients.importClients(data);
    await fs.remove(req.file.path);

    res.json({ success: true, ...result });

  } catch (err) {
    if (req.file) await fs.remove(req.file.path).catch(() => { });
    res.status(500).json({ error: err.message });
  }
});

// Get client count
app.get('/api/ai/registered-clients-count', requireAdmin, async (req, res) => {
  try {
    const count = await registeredClients.getClientCount();
    res.json({ count });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Add ID to existing client
app.post('/api/ai/registered-clients/:key/add-id', requireAdmin, async (req, res) => {
  try {
    const { newId } = req.body;
    if (!newId) {
      return res.status(400).json({ error: 'newId is required' });
    }
    const client = await registeredClients.addIdToClient(req.params.key, newId);
    res.json({ success: true, client });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// Update a client
app.put('/api/ai/registered-clients/:key', requireAdmin, async (req, res) => {
  try {
    const client = await registeredClients.updateClient(req.params.key, req.body);
    res.json({ success: true, client });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// Search clients
app.get('/api/ai/registered-clients/search/query', requireAdmin, async (req, res) => {
  try {
    const query = req.query.q;
    if (!query) return res.json([]);
    const results = await registeredClients.searchClients(query);
    res.json(results);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Send Custom Notification
app.post('/api/ai/notify/custom', requireAdmin, async (req, res) => {
  try {
    const { phone, message } = req.body;
    if (!phone || !message) {
      return res.status(400).json({ error: 'Phone and message are required' });
    }
    await aiAgent.notifyClient(phone, message);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Helper: Generate Salary Message
async function generateSalaryMessage(client, salaryInfo, settingsData) {
  const { salaryTemplate, salaryCurrency, salaryFooter } = settingsData;
  const currency = salaryCurrency || 'ل.س';

  let details = '';
  details += `📄 *الفترة:* ${salaryInfo.periodName}\n`;
  details += `────────────────\n`;
  salaryInfo.salaries.forEach(s => {
    details += `🆔 ID: ${s.id} | 💰 ${s.amount.toLocaleString()} ${currency}\n`;
  });
  details += `────────────────`;

  let net = salaryInfo.total;
  if (salaryInfo.agencyPercent > 0) {
    const agencyFee = salaryInfo.total * (salaryInfo.agencyPercent / 100);
    net = salaryInfo.total - agencyFee;
    details += `\n📉 الخصم (${salaryInfo.agencyPercent}%): -${agencyFee.toLocaleString()} ${currency}`;
  }

  const footer = salaryFooter || 'شكراً لجهودك!';

  return salaryTemplate
    .replace(/{الاسم}/g, client.fullName)
    .replace(/{الفترة}/g, salaryInfo.periodName)
    .replace(/{التفاصيل}/g, details)
    .replace(/{المجموع}/g, salaryInfo.total.toLocaleString())
    .replace(/{الصافي}/g, net.toLocaleString())
    .replace(/{العملة}/g, currency)
    .replace(/{الخاتمة}/g, footer);
}

// Send Salary Notification (Single)
app.post('/api/ai/notify/salary', requireAdmin, async (req, res) => {
  try {
    const { clientKey } = req.body;
    if (!clientKey) return res.status(400).json({ error: 'Client Key required' });

    const clients = await registeredClients.getAllClients();
    const client = clients[clientKey];

    if (!client) return res.status(404).json({ error: 'Client not found' });
    if (!client.phone) return res.status(400).json({ error: 'Client has no phone number registered' });

    // Lookup salary
    const salaryModule = aiAgent.getModules().salary;
    const salaryInfo = await salaryModule.lookupSalary(client.ids || []);

    if (!salaryInfo.found || salaryInfo.salaries.length === 0) {
      const msg = `مرحباً ${client.fullName}،\n\nلا توجد بيانات راتب مسجلة لمعرفاتك في الفترة الحالية (${salaryInfo.periodName || 'غير محددة'}).`;
      await aiAgent.notifyClient(client.phone, msg);
      return res.json({ success: true, message: msg });
    }

    // Generate Message
    const settingsData = await settings.getSettings();
    const msg = await generateSalaryMessage(client, salaryInfo, settingsData);

    await aiAgent.notifyClient(client.phone, msg);
    res.json({ success: true, message: msg });

  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Send Salary Notification (Bulk - All with Salary)
app.post('/api/ai/notify/salary-all', requireAdmin, async (req, res) => {
  try {
    const clients = await registeredClients.getAllClients();
    const salaryModule = aiAgent.getModules().salary;
    const settingsData = await settings.getSettings();

    let sentCount = 0;
    let skippedCount = 0;
    let errorCount = 0;

    const clientsArray = Object.values(clients);
    const validClients = clientsArray.filter(c => c.phone); // Must have phone

    for (const client of validClients) {
      try {
        const salaryInfo = await salaryModule.lookupSalary(client.ids || []);

        // Only send if salary exists for current period
        if (salaryInfo.found && salaryInfo.salaries.length > 0) {
          const msg = await generateSalaryMessage(client, salaryInfo, settingsData);
          await aiAgent.notifyClient(client.phone, msg);
          sentCount++;

          // Rate Limiting Delay (2 seconds)
          await new Promise(resolve => setTimeout(resolve, 2000));
        } else {
          skippedCount++;
        }
      } catch (innerErr) {
        console.error(`Failed to send salary to ${client.fullName}:`, innerErr);
        errorCount++;
      }
    }

    res.json({ success: true, sent: sentCount, skipped: skippedCount, errors: errorCount });

  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});


// Remove ID from client
app.post('/api/ai/registered-clients/:key/remove-id', requireAdmin, async (req, res) => {
  try {
    const { removeId } = req.body;
    if (!removeId) {
      return res.status(400).json({ error: 'removeId is required' });
    }
    const client = await registeredClients.removeIdFromClient(req.params.key, removeId);
    res.json({ success: true, client });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});



// =====================================================
// Custom Fields API
// =====================================================



// Get all custom fields
app.get('/api/ai/custom-fields', requireAdmin, async (req, res) => {
  try {
    const fields = await customFields.getAllFields();
    res.json(fields);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Add new field
app.post('/api/ai/custom-fields', requireAdmin, async (req, res) => {
  try {
    const field = await customFields.addField(req.body);
    res.json({ success: true, field });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// Update field
app.put('/api/ai/custom-fields/:id', requireAdmin, async (req, res) => {
  try {
    const field = await customFields.updateField(req.params.id, req.body);
    res.json({ success: true, field });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// Delete field
app.delete('/api/ai/custom-fields/:id', requireAdmin, async (req, res) => {
  try {
    await customFields.deleteField(req.params.id);
    res.json({ success: true });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// Add option to dropdown field
app.post('/api/ai/custom-fields/:id/options', requireAdmin, async (req, res) => {
  try {
    const { option } = req.body;
    const field = await customFields.addOption(req.params.id, option);
    res.json({ success: true, field });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// Remove option from dropdown field
app.delete('/api/ai/custom-fields/:id/options/:option', requireAdmin, async (req, res) => {
  try {
    const field = await customFields.removeOption(req.params.id, decodeURIComponent(req.params.option));
    res.json({ success: true, field });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// =====================================================
// Lookups API (Agencies, Countries, Cities)
// =====================================================
const lookups = require('./src/ai_agent_v1/lookups');

app.get('/api/ai/lookups', requireAdmin, async (req, res) => {
  try {
    const data = await lookups.getLookups();
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/ai/lookups/agency', requireAdmin, async (req, res) => {
  try {
    const agencies = await lookups.addAgency(req.body.name);
    res.json(agencies);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.delete('/api/ai/lookups/agency/:name', requireAdmin, async (req, res) => {
  try {
    const agencies = await lookups.removeAgency(decodeURIComponent(req.params.name));
    res.json(agencies);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/ai/lookups/country', requireAdmin, async (req, res) => {
  try {
    const countries = await lookups.addCountry(req.body.name);
    res.json(countries);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.delete('/api/ai/lookups/country/:name', requireAdmin, async (req, res) => {
  try {
    const countries = await lookups.removeCountry(decodeURIComponent(req.params.name));
    res.json(countries);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/ai/lookups/city', requireAdmin, async (req, res) => {
  try {
    const countries = await lookups.addCity(req.body.country, req.body.city);
    res.json(countries);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.delete('/api/ai/lookups/city/:country/:city', requireAdmin, async (req, res) => {
  try {
    const countries = await lookups.removeCity(decodeURIComponent(req.params.country), decodeURIComponent(req.params.city));
    res.json(countries);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// =====================================================
// Accounting API (Soulchill ERP)
// =====================================================
const accountingRoutes = require('./src/accounting/routes/api');
app.use('/api/accounting', requireAdmin, accountingRoutes);

// =====================================================
// Custom Fields API
// =====================================================
// ... (Custom Fields logic)

// =====================================================
// Settings & Broadcast API
// =====================================================
const settings = require('./src/ai_agent_v1/settings');
const notificationQueue = require('./src/ai_agent_v1/notificationQueue');

// Get Settings
app.get('/api/ai/settings', requireAdmin, async (req, res) => {
  try {
    const data = await settings.getSettings();
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Update Settings
app.post('/api/ai/settings', requireAdmin, async (req, res) => {
  try {
    const updated = await settings.updateSettings(req.body);
    res.json(updated);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Broadcast Message
app.post('/api/ai/notify/broadcast', requireAdmin, async (req, res) => {
  try {
    const { clients: targetClients, message } = req.body;

    if (!targetClients || !Array.isArray(targetClients) || targetClients.length === 0) {
      return res.status(400).json({ error: 'No targets selected' });
    }
    if (!message) {
      return res.status(400).json({ error: 'Message is required' });
    }

    let sentCount = 0;
    targetClients.forEach(client => {
      if (client.phone) {
        notificationQueue.enqueue(client.phone, message, async (phone, msg) => {
          await aiAgent.notifyClient(phone, msg);
        });
        sentCount++;
      }
    });

    res.json({ success: true, queued: sentCount });

  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Get Queue Status
app.get('/api/ai/notify/status', requireAdmin, (req, res) => {
  res.json(notificationQueue.getStatus());
});

// ------------------------------
// Socket IO & Server Listen
// ------------------------------
// ⚠️ AUTH DISABLED TEMPORARILY
io.use((socket, next) => {
  // Skip authentication - allow all connections
  socket.user = {
    email: 'loorksy@gmail.com',
    permissions: {
      can_scan_backlog: true,
      can_send_messages: true,
      can_manage_lists: true,
      can_manage_settings: true,
      can_control_bot: true,
      can_manage_forwarding: true,
      can_view_logs: true,
      is_admin: true
    }
  };
  return next();
});

/* ORIGINAL SOCKET AUTH - RESTORE LATER:
io.use((socket, next) => {
  // ...
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
*/

// ==========================================================
// CLIENT PORTAL APIs
// ==========================================================
const portal = require('./src/ai_agent_v1/portal');
const receipts = require('./src/ai_agent_v1/receipts');

// Configure multer for receipt uploads
const receiptStorage = multer.memoryStorage();
const receiptUpload = multer({ 
  storage: receiptStorage,
  limits: { fileSize: 10 * 1024 * 1024 }, // 10MB max
  fileFilter: (req, file, cb) => {
    const allowed = ['image/jpeg', 'image/png', 'image/gif', 'image/webp', 'application/pdf'];
    if (allowed.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error('نوع الملف غير مدعوم'));
    }
  }
});

// Serve portal page
app.get('/portal/:token', async (req, res) => {
  const { token } = req.params;
  const isValid = await portal.isValidToken(token);
  
  if (!isValid) {
    // Still serve the page - it will show error state
    return res.sendFile(path.join(__dirname, 'public', 'portal.html'));
  }
  
  res.sendFile(path.join(__dirname, 'public', 'portal.html'));
});

// Get client profile by portal token
app.get('/api/portal/:token/profile', async (req, res) => {
  try {
    const { token } = req.params;
    const clientKey = await portal.getClientKeyByToken(token);
    
    if (!clientKey) {
      return res.status(404).json({ error: 'رابط غير صالح' });
    }
    
    const registeredClients = require('./src/ai_agent_v1/registeredClients');
    const client = await registeredClients.getClientByKey(clientKey);
    
    if (!client) {
      return res.status(404).json({ error: 'العميل غير موجود' });
    }
    
    // Return client data (excluding sensitive fields)
    res.json({
      fullName: client.fullName,
      phone: client.phone,
      country: client.country,
      city: client.city,
      address: client.address,
      agencyName: client.agencyName,
      ids: client.ids || []
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Update client profile by portal token
app.put('/api/portal/:token/profile', async (req, res) => {
  try {
    const { token } = req.params;
    const clientKey = await portal.getClientKeyByToken(token);
    
    if (!clientKey) {
      return res.status(404).json({ error: 'رابط غير صالح' });
    }
    
    const registeredClients = require('./src/ai_agent_v1/registeredClients');
    
    // Only allow certain fields to be updated
    const allowedFields = ['fullName', 'phone', 'city', 'address'];
    const updates = {};
    
    for (const field of allowedFields) {
      if (req.body[field] !== undefined) {
        updates[field] = req.body[field];
      }
    }
    
    if (Object.keys(updates).length === 0) {
      return res.status(400).json({ error: 'لا توجد بيانات للتحديث' });
    }
    
    const updated = await registeredClients.updateClient(clientKey, updates);
    
    res.json({
      success: true,
      fullName: updated.fullName,
      phone: updated.phone,
      country: updated.country,
      city: updated.city,
      address: updated.address
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Get client salaries by portal token
app.get('/api/portal/:token/salaries', async (req, res) => {
  try {
    const { token } = req.params;
    const clientKey = await portal.getClientKeyByToken(token);
    
    if (!clientKey) {
      return res.status(404).json({ error: 'رابط غير صالح' });
    }
    
    const registeredClients = require('./src/ai_agent_v1/registeredClients');
    const client = await registeredClients.getClientByKey(clientKey);
    
    if (!client) {
      return res.status(404).json({ error: 'العميل غير موجود' });
    }
    
    // Get salaries from salary module
    const salary = require('./src/ai_agent_v1/salary');
    const clientIds = client.ids || [];
    
    if (clientIds.length === 0) {
      return res.json([]);
    }
    
    // Get all salaries for this client
    const salariesData = await salary.getAllSalariesForClient(clientIds);
    
    // Add receipt info to each salary
    for (const sal of salariesData) {
      const receipt = await receipts.getReceipt(sal.clientId, sal.periodId);
      sal.receipt = receipt;
    }
    
    res.json(salariesData);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Regenerate portal token
app.post('/api/portal/:token/regenerate', async (req, res) => {
  try {
    const { token } = req.params;
    const clientKey = await portal.getClientKeyByToken(token);
    
    if (!clientKey) {
      return res.status(404).json({ error: 'رابط غير صالح' });
    }
    
    const registeredClients = require('./src/ai_agent_v1/registeredClients');
    const client = await registeredClients.getClientByKey(clientKey);
    
    if (!client) {
      return res.status(404).json({ error: 'العميل غير موجود' });
    }
    
    const newToken = await portal.regenerateToken(clientKey, client.agencyName);
    
    if (!newToken) {
      return res.status(403).json({ error: 'غير مسموح بتوليد رابط جديد' });
    }
    
    res.json({ success: true, newToken });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Admin: Generate portal link for a client
app.post('/api/admin/portal/generate/:clientKey', requireAdmin, async (req, res) => {
  try {
    const { clientKey } = req.params;
    const registeredClients = require('./src/ai_agent_v1/registeredClients');
    const client = await registeredClients.getClientByKey(clientKey);
    
    if (!client) {
      return res.status(404).json({ error: 'العميل غير موجود' });
    }
    
    if (!portal.isMainAgency(client.agencyName)) {
      return res.status(403).json({ error: 'هذا العميل تابع لوكالة فرعية - البوابة متاحة فقط للوكالة الرئيسية' });
    }
    
    const token = await portal.getOrCreateToken(clientKey, client.agencyName);
    
    res.json({ 
      success: true, 
      token,
      url: `/portal/${token}`
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Admin: Send portal links to all Main agency clients
app.post('/api/admin/portal/send-all', requireAdmin, async (req, res) => {
  try {
    const allClients = await registeredClients.getAllClients();
    const results = { sent: 0, failed: 0, skipped: 0, details: [] };
    
    for (const [key, client] of Object.entries(allClients)) {
      // Only Main agency clients
      if (!portal.isMainAgency(client.agencyName)) {
        results.skipped++;
        continue;
      }
      
      // Must have phone
      if (!client.phone) {
        results.skipped++;
        continue;
      }
      
      try {
        const token = await portal.getOrCreateToken(key, client.agencyName);
        if (!token) {
          results.skipped++;
          continue;
        }
        
        const portalUrl = `${req.protocol}://${req.get('host')}/portal/${token}`;
        const message = `🔗 *رابط البوابة الخاصة بك*\n\nمرحباً ${client.fullName}،\n\nيمكنك الدخول لبوابتك الشخصية من الرابط التالي:\n\n${portalUrl}\n\nمن خلال البوابة يمكنك:\n• عرض معلوماتك الشخصية\n• متابعة سجل الرواتب\n• تعديل بياناتك`;
        
        await aiAgent.notifyClient(client.phone, message);
        results.sent++;
        results.details.push({ name: client.fullName, status: 'sent' });
      } catch (err) {
        results.failed++;
        results.details.push({ name: client.fullName, status: 'failed', error: err.message });
      }
    }
    
    res.json({ success: true, results });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Admin: Upload receipt for a client
app.post('/api/admin/receipt/upload', requireAdmin, receiptUpload.single('receipt'), async (req, res) => {
  try {
    const { clientId, periodId, transferDate } = req.body;
    
    if (!req.file) {
      return res.status(400).json({ error: 'الرجاء اختيار صورة الوصل' });
    }
    
    if (!clientId || !periodId) {
      return res.status(400).json({ error: 'بيانات ناقصة' });
    }
    
    const receipt = await receipts.uploadReceipt(
      clientId,
      periodId,
      req.file.buffer,
      req.file.originalname,
      transferDate
    );
    
    res.json({ success: true, receipt });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Admin: Delete receipt
app.delete('/api/admin/receipt/:clientId/:periodId', requireAdmin, async (req, res) => {
  try {
    const { clientId, periodId } = req.params;
    await receipts.deleteReceipt(clientId, periodId);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Serve receipt images
app.use('/uploads/receipts', express.static(path.join(__dirname, 'uploads/receipts')));

// =====================================================
// Admin: Reset Client PIN
// =====================================================
const pin = require('./src/ai_agent_v1/pin');

app.post('/api/admin/clients/:clientKey/reset-pin', requireAdmin, async (req, res) => {
  try {
    const { clientKey } = req.params;
    
    // Get the registered client
    const client = await registeredClients.getClientByKey(clientKey);
    
    if (!client) {
      return res.status(404).json({ error: 'العميل غير موجود' });
    }
    
    if (!client.phone) {
      return res.status(400).json({ error: 'العميل ليس لديه رقم هاتف مسجل' });
    }
    
    // Generate new PIN
    const newPin = pin.generatePin();
    const hashedPin = pin.hashPin(newPin);
    
    // Find the linked WhatsApp client and update their PIN
    const allLinkedClients = await aiModules.clients.getAllClients();
    let linkedWhatsappId = null;
    
    // Normalize phone number for comparison
    const normalizedPhone = client.phone.replace(/\D/g, '');
    
    // Find the WhatsApp client linked to this registered client (by ID or phone)
    for (const [whatsappId, linkedClient] of Object.entries(allLinkedClients)) {
      // Check by linkedClientId
      const matchById = linkedClient.linkedClientId && client.ids.includes(linkedClient.linkedClientId);
      // Check by phone number in WhatsApp ID
      const matchByPhone = whatsappId.replace('@c.us', '').replace('@lid', '') === normalizedPhone;
      
      if (matchById || matchByPhone) {
        linkedWhatsappId = whatsappId;
        // Update the PIN hash in linked client record
        await aiModules.clients.upsertClient(whatsappId, { pinHash: hashedPin });
        console.log(`[Admin] Updated PIN for WhatsApp client: ${whatsappId}`);
        break;
      }
    }
    
    // Send WhatsApp notification with new PIN
    const message = `🔐 *تجديد رمز PIN*\n\nمرحباً ${client.fullName}،\n\nتم تجديد رمز الحماية الخاص بك.\n\n📌 الرمز الجديد: *${newPin}*\n\n⚠️ يرجى حفظ هذا الرمز بمكان آمن ولا تشاركيه مع أحد.`;
    
    try {
      await aiAgent.notifyClient(client.phone, message);
      console.log(`[Admin] PIN reset for client ${client.fullName} (${clientKey})`);
      
      res.json({ 
        success: true, 
        message: 'تم تجديد PIN وإرسال رسالة للعميل',
        clientName: client.fullName,
        linkedWhatsappId: linkedWhatsappId ? 'مربوط' : 'غير مربوط بعد'
      });
    } catch (waError) {
      // WhatsApp might not be connected - still return success but note the issue
      console.error('[Admin] WhatsApp notification failed:', waError.message);
      res.json({ 
        success: true, 
        warning: 'تم تجديد PIN لكن فشل إرسال الرسالة - تأكد من اتصال واتساب',
        clientName: client.fullName,
        newPin: newPin, // Return PIN so admin can manually share it
        linkedWhatsappId: linkedWhatsappId ? 'مربوط' : 'غير مربوط بعد'
      });
    }
    
  } catch (err) {
    console.error('[Admin] Reset PIN error:', err);
    res.status(500).json({ error: err.message || 'فشل تجديد PIN' });
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
