const express = require('express');

module.exports = ({ bot }) => {
  const router = express.Router();

  router.get('/archives', async (_req, res) => {
    try {
      const archives = await bot.fetchArchives();
      res.json({ success: true, archives });
    } catch (e) {
      res.status(400).json({ success: false, error: e.message || e });
    }
  });

  return router;
};
