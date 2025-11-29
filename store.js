const fs = require('fs-extra');
const path = require('path');

const dataDir = path.join(__dirname, 'data');
const defaultFiles = {
  'settings.json': { rpm: 20, cooldownSeconds: 3, normalizeArabicEnabled: true, replyMode: false, defaultEmoji: '✅' },
  'clients.json': [],
  'groups.json': [],
  'processed.json': [],
  'lastChecked.json': {},
  'bulkState.json': { state: 'idle', sent: 0, total: 0, groupId: null },
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
  return fs.readJSON(filePath(name));
}

async function write(name, data) {
  await ensure();
  return fs.writeJSON(filePath(name), data, { spaces: 2 });
}

async function ensure() {
  ensureDataDir();
}

module.exports = {
  dataDir,
  ensure,
  read,
  write,
};
