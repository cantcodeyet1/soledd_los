/**
 * businessHours.js — Soledd office hours: Mon-Fri 08:30-17:00, Zimbabwe time (CAT, UTC+2).
 */

'use strict';

function catParts(now = new Date()) {
  const catMs = now.getTime() + 2 * 3600000;
  const cat = new Date(catMs);
  return { day: cat.getUTCDay(), hour: cat.getUTCHours(), minute: cat.getUTCMinutes() };
}

function isBusinessHours(now = new Date()) {
  const { day, hour, minute } = catParts(now);
  if (day === 0 || day === 6) return false; // Sun/Sat
  const minutesNow = hour * 60 + minute;
  return minutesNow >= 8 * 60 + 30 && minutesNow < 17 * 60;
}

/** Copy for the applicant-facing confirmation message. */
function verificationPromiseText(now = new Date()) {
  if (isBusinessHours(now)) {
    return 'A credit officer will verify your application within 2 hours (business hours: Mon-Fri, 8:30am-5pm).';
  }
  return "A credit officer will verify your application within 2 hours of the next business day (Mon-Fri, 8:30am-5pm).";
}

module.exports = { isBusinessHours, verificationPromiseText };
