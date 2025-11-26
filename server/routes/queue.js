const express = require('express');

module.exports = ({ bot }) => {
  const router = express.Router();

  router.get('/queue/status', (_req, res) => {
    try {
      const status = bot.getQueueStatus();
      res.json({ success: true, ...status });
    } catch (e) {
      res.status(400).json({ success: false, error: e.message || e });
    }
  });

  router.get('/queue/config', (_req, res) => {
    try {
      res.json({ success: true, config: bot.getQueueConfig() });
    } catch (e) {
      res.status(400).json({ success: false, error: e.message || e });
    }
  });

  router.post('/queue/config', (req, res) => {
    try {
      const cfg = bot.updateQueueConfig(req.body || {});
      res.json({ success: true, config: cfg });
    } catch (e) {
      res.status(400).json({ success: false, error: e.message || e });
    }
  });

  router.post('/queue/pause', (_req, res) => {
    try {
      bot.pauseQueue();
      res.json({ success: true, status: bot.getQueueStatus() });
    } catch (e) {
      res.status(400).json({ success: false, error: e.message || e });
    }
  });

  router.post('/queue/resume', (_req, res) => {
    try {
      bot.resumeQueue();
      res.json({ success: true, status: bot.getQueueStatus() });
    } catch (e) {
      res.status(400).json({ success: false, error: e.message || e });
    }
  });

  router.post('/queue/clear', (_req, res) => {
    try {
      bot.clearQueue();
      res.json({ success: true, status: bot.getQueueStatus() });
    } catch (e) {
      res.status(400).json({ success: false, error: e.message || e });
    }
  });

  router.get('/queue/history', (_req, res) => {
    try {
      res.json({ success: true, history: bot.getQueueHistory() });
    } catch (e) {
      res.status(400).json({ success: false, error: e.message || e });
    }
  });

  return router;
};
