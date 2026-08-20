/**
 * officerAuth.service.js — per-officer dashboard logins (email + password),
 * layered on top of the credit_officers table. See supabase-schema.sql for
 * the password_hash / role / must_reset_password columns this depends on.
 */

'use strict';

const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const { supabase } = require('../models/supabase');

const TOKEN_TTL = '24h';
const SALT_ROUNDS = 10;

function generateTempPassword() {
  // Readable, unambiguous characters only — this gets typed off a phone screen.
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let out = '';
  for (let i = 0; i < 10; i++) out += alphabet[crypto.randomInt(alphabet.length)];
  return out;
}

function signToken(officer) {
  return jwt.sign(
    { sub: officer.id, role: officer.role, email: officer.email, name: officer.name },
    process.env.JWT_SECRET,
    { expiresIn: TOKEN_TTL }
  );
}

function verifyToken(token) {
  return jwt.verify(token, process.env.JWT_SECRET);
}

async function getById(officerId) {
  const { data } = await supabase.from('credit_officers').select('*').eq('id', officerId).single();
  return data || null;
}

async function verifyLogin(email, password) {
  const { data: officer } = await supabase
    .from('credit_officers')
    .select('*')
    .eq('email', email)
    .eq('active', true)
    .single();

  if (!officer || !officer.password_hash) return null;
  const ok = await bcrypt.compare(password, officer.password_hash);
  return ok ? officer : null;
}

async function createOfficerWithTempPassword({ name, email, branch, role }) {
  const tempPassword = generateTempPassword();
  const passwordHash = await bcrypt.hash(tempPassword, SALT_ROUNDS);

  const { data, error } = await supabase
    .from('credit_officers')
    .insert([{
      name,
      email,
      branch: branch || null,
      role: role === 'ADMIN' ? 'ADMIN' : 'STAFF',
      password_hash: passwordHash,
      must_reset_password: true,
      active: true,
    }])
    .select()
    .single();

  if (error) throw new Error(error.message);
  return { officer: data, tempPassword };
}

async function resetTempPassword(officerId) {
  const tempPassword = generateTempPassword();
  const passwordHash = await bcrypt.hash(tempPassword, SALT_ROUNDS);

  const { data, error } = await supabase
    .from('credit_officers')
    .update({ password_hash: passwordHash, must_reset_password: true, updated_at: new Date().toISOString() })
    .eq('id', officerId)
    .select()
    .single();

  if (error) throw new Error(error.message);
  return { officer: data, tempPassword };
}

async function setPassword(officerId, newPassword) {
  const passwordHash = await bcrypt.hash(newPassword, SALT_ROUNDS);
  const { error } = await supabase
    .from('credit_officers')
    .update({ password_hash: passwordHash, must_reset_password: false, updated_at: new Date().toISOString() })
    .eq('id', officerId);
  if (error) throw new Error(error.message);
}

module.exports = {
  generateTempPassword,
  signToken,
  verifyToken,
  getById,
  verifyLogin,
  createOfficerWithTempPassword,
  resetTempPassword,
  setPassword,
};
