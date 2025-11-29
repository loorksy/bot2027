const fs = require('fs-extra');
const path = require('path');

const dataDir = path.join(__dirname, 'data');
const defaultFiles = {
  'settings.json': {
    rpm: 20,
    cooldownSeconds: 3,
    normalizeArabicEnabled: true,
    replyMode: false,
    defaultEmoji: '✅',
    forwardEnabled: false,
    forwardTargetChatId: '',
    forwardBatchSize: 10,
    forwardFlushOnIdle: true,
  },
  'clients.json': [],
  'groups.json': [],
  'processed.json': [],
  'lastChecked.json': {},
  'bulkState.json': { state: 'idle', sent: 0, total: 0, groupId: null },
  'interactedLogs.json': [],
  'skippedLogs.json': [],
  'forwardQueue.json': [],
  'forwardMeta.json': { lastForwardedAt: null },
};

function ensureDataDir() {
  fs.ensureDirSync(dataDir);
  for (const [file, content] of Object.entries(defaultFiles)) {
    const filePath = path.join(dataDir, file);
    if (!fs.existsSync(filePath)) {
      fs.writeJSONSync(filePath, content, { spaces: 2 });
    }
  }
}

function filePath(name) {
  return path.join(dataDir, name);
}

async function read(name) {
  await ensure();
  const target = filePath(name);
  const fallback = defaultFiles[name] !== undefined ? defaultFiles[name] : {};
  try {
    return await fs.readJSON(target);
  } catch (err) {
    if (err && (err.code === 'ENOENT' || err.name === 'SyntaxError')) {
      const safeFallback = JSON.parse(JSON.stringify(fallback));
      await fs.writeJSON(target, safeFallback, { spaces: 2 });
      return safeFallback;
    }
    throw err;
  }
}

async function write(name, data) {
  await ensure();
  return fs.writeJSON(filePath(name), data, { spaces: 2 });
}

async function appendLimited(name, entry, maxSize = 2000) {
  await ensure();
  const current = await read(name);
  current.push(entry);
  if (current.length > maxSize) {
    current.splice(0, current.length - maxSize);
  }
  await write(name, current);
  return current;
}

async function ensure() {
  ensureDataDir();
}

module.exports = {
  dataDir,
  ensure,
  read,
  write,
  filePath,
  appendLimited,
};
