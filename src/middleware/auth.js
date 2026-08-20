/**
 * auth.js — two ways in, one req.user shape.
 *
 * 1. Legacy: the bearer token IS the shared admin password (the
 *    `admin_password_override` setting, or ADMIN_PASSWORD from env). Maps to
 *    role ADMIN. This is the original MVP auth and still works unchanged.
 * 2. Officer accounts: the bearer token is a JWT issued at /api/auth/login
 *    for a credit_officers row, carrying that officer's role (STAFF|ADMIN).
 *
 * requireAdmin gates the routes reserved for ADMIN: calculator rates and
 * managing other officer accounts (per the 2-tier role model — STAFF gets
 * full application + agent access, ADMIN additionally gets settings/user
 * management).
 */

'use strict';

const settingsService = require('../services/settings.service');
const officerAuth = require('../services/officerAuth.service');

async function getEffectivePassword() {
  try {
    const override = await settingsService.getSetting('admin_password_override');
    if (override && String(override).trim()) return String(override).trim();
  } catch {
    // settings lookup failed — fall through to env var
  }
  return process.env.ADMIN_PASSWORD;
}

async function authenticate(req, res, next) {
  const authHeader = req.headers.authorization || '';
  const token = authHeader.replace(/^Bearer\s+/i, '').trim();

  if (!token) return res.status(401).json({ error: 'Invalid credentials' });

  const effectivePassword = await getEffectivePassword();
  if (!effectivePassword) {
    console.warn('⚠️ ADMIN_PASSWORD not set — refusing all admin requests');
    return res.status(500).json({ error: 'Admin auth not configured' });
  }

  if (token === effectivePassword) {
    req.user = { id: null, role: 'ADMIN', email: null, name: 'System Administrator', legacy: true };
    return next();
  }

  try {
    const payload = officerAuth.verifyToken(token);
    req.user = { id: payload.sub, role: payload.role, email: payload.email, name: payload.name, legacy: false };
    return next();
  } catch {
    return res.status(401).json({ error: 'Invalid credentials' });
  }
}

function requireAdmin(req, res, next) {
  if (req.user?.role !== 'ADMIN') return res.status(403).json({ error: 'Admin access required' });
  next();
}

module.exports = { authenticate, requireAdmin, getEffectivePassword };
