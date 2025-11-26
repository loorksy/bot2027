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

  return router;
};
