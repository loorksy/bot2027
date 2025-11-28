const express = require('express');
const { writeJson, readJson } = require('./utils');

module.exports = ({ bot, io }) => {
  const router = express.Router();

  router.get('/bot/status', async (_req, res) => {
    const status = bot.getStatus();
    const bulk = readJson('bulk.json', {});
    res.json({ ...status, bulk });
  });

  router.post('/bot/start', async (_req, res) => {
    try {
      await bot.start();
      res.json(bot.getStatus());
    } catch (e) {
      res.status(400).json({ error: e.message || e });
    }
  });

  router.post('/bot/stop', async (_req, res) => {
    try {
      await bot.stop();
      res.json(bot.getStatus());
    } catch (e) {
      res.status(400).json({ error: e.message || e });
    }
  });

  router.post('/bot/restart', async (_req, res) => {
    try {
      await bot.restart();
      res.json(bot.getStatus());
    } catch (e) {
      res.status(400).json({ error: e.message || e });
    }
  });

  router.post('/bot/clear-session', async (_req, res) => {
    try {
      await bot.clearSession();
      res.json({ ok: true });
    } catch (e) {
      res.status(400).json({ error: e.message || e });
    }
  });

  router.post('/bot/send', async (req, res) => {
    const { to, message } = req.body || {};
    try {
      await bot.init();
      const id = await bot.sendTextMessage(to, message);
      res.json({ ok: true, id });
    } catch (e) {
      res.status(400).json({ error: e.message || e });
    }
  });

  router.get('/bot/groups', async (_req, res) => {
    try {
      const groups = await bot.fetchGroups();
      res.json(groups);
    } catch (e) {
      res.status(400).json({ error: e.message || e });
    }
  });

  router.get('/bot/qr', async (_req, res) => {
    try {
      const qr = await bot.getQR();
      res.json(qr);
    } catch (e) {
      res.status(400).json({ error: e.message || e });
    }
  });

  router.post('/bot/process-backlog', async (req, res) => {
    try {
      await bot.processBacklog(req.body || {});
      res.json({ ok: true });
    } catch (e) {
      res.status(400).json({ error: e.message || e });
    }
  });

  router.post('/bot/check-backlog', async (req, res) => {
    try {
      const data = await bot.countBacklog(req.body || {});
      res.json(data);
    } catch (e) {
      res.status(400).json({ error: e.message || e });
    }
  });

  router.get('/logs/stream', (req, res) => {
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
    });
    const handler = (line) => {
      res.write(`data: ${JSON.stringify({ line, ts: Date.now() })}\n\n`);
    };
    bot.onLog(handler);
    req.on('close', () => {
      bot.emitter.removeListener('log', handler);
    });
  });

  return router;
};
