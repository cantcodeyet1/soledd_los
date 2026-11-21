/**
 * notificationSettings.service.js — what the system emails staff about and
 * when the weekly summary goes out. Stored in the `settings` table under the
 * key `notification_settings`; editable from Settings → Notifications.
 *
 * All times are Zimbabwe time (Africa/Harare, UTC+2, no daylight saving).
 */

'use strict';

const settingsService = require('./settings.service');

const KEY = 'notification_settings';
const TIMEZONE = 'Africa/Harare';

// Day numbers follow JS getDay(): 0 = Sunday ... 6 = Saturday.
const DEFAULTS = {
  weeklySummary: { enabled: true, day: 1, time: '08:00' },
  events: {
    newApplication: true,      // a customer submits a loan application
    documentsReceived: true,   // applicant finished uploading documents
    applicationDecision: true, // application approved / rejected
    applicationChanged: true,  // details or loan terms edited, or sent back to review
    newAgentApplication: true, // someone applies to be a field agent
    agentDecision: true,       // field agent application approved / rejected
  },
};

const EVENT_LABELS = {
  newApplication: 'New loan application submitted',
  documentsReceived: 'Applicant finished uploading documents',
  applicationDecision: 'Application approved or rejected',
  applicationChanged: 'Application edited or sent back to review',
  newAgentApplication: 'New field agent application',
  agentDecision: 'Field agent application approved or rejected',
};

function normalise(stored) {
  const s = stored && typeof stored === 'object' ? stored : {};
  const ws = s.weeklySummary || {};
  const day = Number.isInteger(Number(ws.day)) && Number(ws.day) >= 0 && Number(ws.day) <= 6 ? Number(ws.day) : DEFAULTS.weeklySummary.day;
  const time = /^([01]\d|2[0-3]):[0-5]\d$/.test(ws.time || '') ? ws.time : DEFAULTS.weeklySummary.time;
  const events = {};
  for (const k of Object.keys(DEFAULTS.events)) {
    events[k] = s.events && typeof s.events[k] === 'boolean' ? s.events[k] : DEFAULTS.events[k];
  }
  return {
    weeklySummary: {
      enabled: typeof ws.enabled === 'boolean' ? ws.enabled : DEFAULTS.weeklySummary.enabled,
      day,
      time,
    },
    events,
  };
}

async function getNotificationSettings() {
  let stored = null;
  try { stored = await settingsService.getSetting(KEY); } catch { /* use defaults */ }
  return normalise(stored);
}

async function saveNotificationSettings(input) {
  const next = normalise(input);
  await settingsService.setSetting(KEY, next);
  return next;
}

/** Whether a given event type should currently send email. */
async function isEventEnabled(event) {
  const s = await getNotificationSettings();
  return s.events[event] !== false;
}

module.exports = {
  TIMEZONE, DEFAULTS, EVENT_LABELS,
  getNotificationSettings, saveNotificationSettings, isEventEnabled,
};
