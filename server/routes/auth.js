const express = require('express');

module.exports = ({ jwt, JWT_SECRET }) => {
  const router = express.Router();

  const handleLogin = (req, res) => {
    const { email, password, remember } = req.body || {};
    if (email === 'loorksy@gmail.com' && password === 'lork0009') {
      const token = jwt.sign({ email }, JWT_SECRET, { expiresIn: remember ? '30d' : '1d' });
      const cookieOpts = { httpOnly: true, sameSite: 'lax' };
      if (remember) cookieOpts.maxAge = 1000 * 60 * 60 * 24 * 30;
      res.cookie('token', token, cookieOpts);
      return res.json({ token });
    }
    return res.status(401).json({ error: 'invalid credentials' });
  };

  router.post('/login', handleLogin);
  router.post('/api/login', handleLogin);

  router.post('/logout', (_req, res) => {
    res.clearCookie('token');
    return res.json({ ok: true });
  });

  return router;
};
