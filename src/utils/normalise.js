/**
 * normalise.js — light cleanup + sanity checks for free-text answers coming
 * off WhatsApp, so what lands in the database is consistent (e.g.
 * "MICHELLE chinodya" -> "Michelle Chinodya").
 */

'use strict';

const TITLES = { mr: 'Mr', mrs: 'Mrs', ms: 'Ms', miss: 'Miss', dr: 'Dr', prof: 'Prof', rev: 'Rev', mx: 'Mx' };

function titleCasePart(part) {
  if (!part) return part;
  return part.charAt(0).toUpperCase() + part.slice(1).toLowerCase();
}

/** "  MRS   michelle  CHINODYA " -> "Mrs Michelle Chinodya"
 *  ("o'brien-smith" -> "O'Brien-Smith"). */
function normaliseName(raw) {
  const s = String(raw == null ? '' : raw).replace(/\s+/g, ' ').trim();
  if (!s) return s;
  return s.split(' ').map((tok, i) => {
    const key = tok.toLowerCase().replace(/\.+$/, '');
    if (i === 0 && TITLES[key]) return TITLES[key];
    // keep hyphens / apostrophes, title-case each sub-part
    return tok.split(/([-'])/).map(p => (p === '-' || p === "'" ? p : titleCasePart(p))).join('');
  }).join(' ');
}

/** Generic tidy for a free-text line: collapse whitespace, trim stray commas. */
function tidyLine(raw) {
  return String(raw == null ? '' : raw)
    .replace(/\s+/g, ' ')
    .replace(/\s*,\s*/g, ', ')
    .replace(/(?:,\s*){2,}/g, ', ')
    .trim()
    .replace(/^[,;:\s-]+|[,;:\s-]+$/g, '');
}

const DIGITS = s => String(s || '').replace(/\D/g, '');

/** Returns an error string if the value looks wrong, else null. */
function checkNationalId(v) {
  const digits = DIGITS(v);
  if (digits.length < 6) return 'That does not look like a full ID number. Please send it like 63-114872-A63.';
  if (!/[A-Za-z]/.test(String(v))) return 'A national ID has a letter in it (e.g. 63-114872-A63). Please check and resend.';
  return null;
}

function checkContactLine(v) {
  // Expect at least one phone-length digit run somewhere in the line.
  if (!/(?:\+?\d[\d\s\-]{7,})/.test(String(v || ''))) {
    return 'I could not find a phone number in that. Please include your phone number.';
  }
  return null;
}

function checkAmount(n) {
  if (!(Number(n) >= 10)) return 'Please enter an amount of at least $10.';
  if (Number(n) > 1000000) return 'That amount looks too large. Please check and resend.';
  return null;
}

module.exports = { normaliseName, tidyLine, checkNationalId, checkContactLine, checkAmount };
