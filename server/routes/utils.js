const fs = require('fs');
const path = require('path');

const DATA_DIR = path.join(__dirname, '..', '..', 'data');
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

function readJson(file, def = {}) {
  const p = path.join(DATA_DIR, file);
  try {
    if (!fs.existsSync(p)) return def;
    return JSON.parse(fs.readFileSync(p, 'utf8'));
  } catch {
    return def;
  }
}

function writeJson(file, data) {
  const p = path.join(DATA_DIR, file);
  fs.writeFileSync(p, JSON.stringify(data, null, 2));
}

function loadSettings() {
  return {
    settings: readJson('settings.json', {}),
    clients: readJson('lists.json', []),
    selectedGroupIds: readJson('groups.json', []),
    bulk: readJson('bulk.json', {}),
  };
}

module.exports = { readJson, writeJson, loadSettings };
