/**
 * auth.routes.js — login (public) and self-service password reset
 * (requires an active session). Mounted at /api/auth, separately from
 * /api/admin so /login isn't itself behind the auth gate it issues tokens for.
 */

'use strict';

const express = require('express');
const router = express.Router();

const { authenticate, getEffectivePassword } = require('../middleware/auth');
const officerAuth = require('../services/officerAuth.service');

router.post('/login', async (req, res) => {
  try {
    const { email, password } = req.body;
    if (!password) return res.status(400).json({ error: 'password is required' });

    if (!email) {
      // Legacy shared-password login — the password itself is the token.
      const effectivePassword = await getEffectivePassword();
      if (!effectivePassword || password !== effectivePassword) {
        return res.status(401).json({ error: 'Invalid credentials' });
      }
      return res.json({
        token: password,
        user: { role: 'ADMIN', name: 'System Administrator', email: null, mustResetPassword: false },
      });
    }

    const officer = await officerAuth.verifyLogin(email.trim().toLowerCase(), password);
    if (!officer) return res.status(401).json({ error: 'Invalid credentials' });

    const token = officerAuth.signToken(officer);
    res.json({
      token,
      user: { role: officer.role, name: officer.name, email: officer.email, mustResetPassword: officer.must_reset_password },
    });
  } catch (err) {
    console.error('POST /auth/login error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

router.post('/reset-password', authenticate, async (req, res) => {
  try {
    if (!req.user.id) {
      return res.status(400).json({ error: 'This account uses the shared admin password — change it from Profile instead.' });
    }
    const { currentPassword, newPassword } = req.body;
    if (!newPassword || newPassword.length < 8) {
      return res.status(400).json({ error: 'New password must be at least 8 characters' });
    }

    const officer = await officerAuth.getById(req.user.id);
    if (!officer) return res.status(404).json({ error: 'Not found' });

    // The forced first-login reset (must_reset_password) doesn't need the
    // temp password re-entered — they just authenticated with it. A
    // voluntary change of an already-set password does.
    if (!officer.must_reset_password) {
      if (!currentPassword) return res.status(400).json({ error: 'currentPassword is required' });
      const ok = await officerAuth.verifyLogin(officer.email, currentPassword);
      if (!ok) return res.status(401).json({ error: 'Current password is incorrect' });
    }

    await officerAuth.setPassword(req.user.id, newPassword);
    res.json({ ok: true });
  } catch (err) {
    console.error('POST /auth/reset-password error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
