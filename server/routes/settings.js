const express = require('express');
const { writeJson, readJson } = require('./utils');

module.exports = ({ bot }) => {
  const router = express.Router();

  router.post('/settings/save', (req, res) => {
    const payload = req.body || {};
    const settings = payload.settings || {};
    const clients = payload.clients || [];
    const groups = payload.selectedGroupIds || [];
    const bulk = payload.bulk || {};

    writeJson('settings.json', settings);
    writeJson('lists.json', clients);
    writeJson('groups.json', groups);
    writeJson('bulk.json', bulk);

    try { bot.setSettings(settings); } catch {}
    try { bot.setClients(clients); } catch {}
    try { bot.setSelectedGroups(groups); } catch {}

    res.json({ ok: true });
  });

  router.get('/settings/load', (_req, res) => {
    res.json({
      settings: readJson('settings.json', {}),
      clients: readJson('lists.json', []),
      selectedGroupIds: readJson('groups.json', []),
      bulk: readJson('bulk.json', {}),
    });
  });

  return router;
};
