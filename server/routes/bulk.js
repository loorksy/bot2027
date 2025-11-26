const express = require('express');
const { readJson, writeJson } = require('./utils');

module.exports = ({ bot }) => {
  const router = express.Router();

  let bulkState = Object.assign({
    running: false,
    paused: false,
    groupId: null,
    messages: [],
    index: 0,
    total: 0,
    delaySec: 3,
    rpm: 20,
    lastMinute: { ts: 0, count: 0 }
  }, readJson('bulk.json', {}));

  const saveBulk = () => writeJson('bulk.json', bulkState);

  const resetMinuteIfNeeded = () => {
    const now = Date.now();
    if (now - bulkState.lastMinute.ts > 60_000) {
      bulkState.lastMinute = { ts: now, count: 0 };
    }
  };

  async function loopSend() {
    if (!bot || !bot.isReady || !bulkState.running) return;
    resetMinuteIfNeeded();

    while (bulkState.running) {
      if (bulkState.paused) { await waitMs(500); continue; }
      if (bulkState.index >= bulkState.total) { bulkState.running = false; break; }

      resetMinuteIfNeeded();
      if (bulkState.lastMinute.count >= bulkState.rpm) {
        const toWait = 60_000 - (Date.now() - bulkState.lastMinute.ts);
        await waitMs(Math.max(500, toWait));
        continue;
      }

      const text = bulkState.messages[bulkState.index];
      try {
        await bot.sendTextMessage(bulkState.groupId, text);
        bulkState.index += 1;
        bulkState.lastMinute.count += 1;
        saveBulk();
        if (bulkState.delaySec > 0) await waitMs(bulkState.delaySec * 1000);
      } catch (e) {
        try { bot.log('⚠️ bulk send error: ' + (e.message || e)); } catch {}
        await waitMs(1500);
      }
    }

    bulkState.running = false;
    saveBulk();
    try { bot.log('✅ bulk finished'); } catch {}
  }

  const waitMs = (ms) => new Promise(r => setTimeout(r, ms));

  router.get('/bulk/groups', async (_req, res) => {
    try {
      const groups = (await (bot.listBulkGroups ? bot.listBulkGroups() : bot.fetchGroups())) || [];
      const shaped = groups.map((g) => ({ id: g.id, name: g.name || g.subject || 'مجموعة' }));
      try { bot.log(`📥 تم جلب المجموعات: ${shaped.length}`); } catch {}
      res.json({ success: true, groups: shaped });
    } catch (e) {
      res.status(400).json({ success: false, error: e.message || e });
    }
  });

  router.post('/bulk/start', async (req, res) => {
    const { groupId, messages, delaySec = 3, rpm = 20 } = req.body || {};
    if (!bot || !bot.isReady) return res.status(400).json({ error: 'WhatsApp not ready' });
    if (!groupId) return res.status(400).json({ error: 'groupId required' });
    if (!Array.isArray(messages) || !messages.length) return res.status(400).json({ error: 'messages required' });

    bulkState = {
      running: true,
      paused: false,
      groupId,
      messages,
      index: 0,
      total: messages.length,
      delaySec: Math.max(0, Number(delaySec)),
      rpm: Math.max(1, Number(rpm)),
      lastMinute: { ts: Date.now(), count: 0 }
    };
    saveBulk();
    loopSend().catch(() => {});
    res.json({ ok: true });
  });

  router.post('/bulk/pause', (_req, res) => { bulkState.paused = true; saveBulk(); res.json({ ok: true }); });
  router.post('/bulk/resume', (_req, res) => { bulkState.running = true; bulkState.paused = false; saveBulk(); loopSend().catch(() => {}); res.json({ ok: true }); });
  router.post('/bulk/cancel', (_req, res) => { bulkState.running = false; bulkState.paused = false; saveBulk(); res.json({ ok: true }); });

  router.get('/bulk/status', (_req, res) => {
    res.json({ ...bot.getStatus(), bulk: { running: bulkState.running, paused: bulkState.paused, index: bulkState.index, total: bulkState.total } });
  });

  router.post('/bulk/save-draft', (req, res) => { writeJson('bulk-draft.json', req.body || null); res.json({ ok: true }); });
  router.get('/bulk/load-draft', (_req, res) => res.json(readJson('bulk-draft.json', null)));
  router.post('/bulk/save-settings', (req, res) => { const data = Object.assign(readJson('bulk.json', {}), { delaySec: req.body?.delaySec, rpm: req.body?.rpm }); writeJson('bulk.json', data); bulkState.delaySec = data.delaySec ?? bulkState.delaySec; bulkState.rpm = data.rpm ?? bulkState.rpm; res.json({ ok: true }); });
  router.get('/bulk/load-settings', (_req, res) => res.json({ delaySec: bulkState.delaySec, rpm: bulkState.rpm }));

  return router;
};
