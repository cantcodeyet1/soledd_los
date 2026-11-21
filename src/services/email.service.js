/**
 * email.service.js — all outbound email, sent through Mailjet's Send API
 * (v3.1) from a single sender address (EMAIL_FROM, e.g. management@soledd.co.zw).
 *
 * Mail types sharing that one sender:
 *   - credit officer login invites (sendOfficerInvite)
 *   - staff notifications, each switchable in Settings → Notifications:
 *       newApplication, documentsReceived, applicationDecision,
 *       applicationChanged, newAgentApplication, agentDecision
 *   - the weekly summary (see weeklySummary.service.js, which reuses the
 *     layout helpers exported here)
 *
 * Everything is best-effort. If MAILJET_API_KEY / MAILJET_SECRET_KEY /
 * EMAIL_FROM aren't set the senders no-op and return sent:false, and no
 * failure here ever blocks the WhatsApp bot or an API response.
 */

'use strict';

const axios = require('axios');
const { supabase } = require('../models/supabase');
const notificationSettings = require('./notificationSettings.service');

const MAILJET_URL = 'https://api.mailjet.com/v3.1/send';
const TIMEOUT_MS = 12000;

const BRAND = '#0f5c4d';
const MUTED = '#7a8481';

function isConfigured() {
  return !!(process.env.MAILJET_API_KEY && process.env.MAILJET_SECRET_KEY && process.env.EMAIL_FROM);
}

function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function dashboardUrl() {
  return (process.env.DASHBOARD_URL || '').replace(/\/$/, '');
}

function money(n) {
  return `$${Number(n || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

/**
 * Sends one email per recipient (so recipients never see each other's
 * addresses). @returns { sent, reason? }
 */
async function sendMail({ to, subject, html, text }) {
  if (!isConfigured()) return { sent: false, reason: 'Mailjet not configured' };

  const recipients = [...new Set([].concat(to || []).map(a => String(a).trim().toLowerCase()).filter(Boolean))];
  if (recipients.length === 0) return { sent: false, reason: 'no recipients' };

  try {
    await axios.post(
      MAILJET_URL,
      {
        Messages: recipients.map(email => ({
          From: { Email: process.env.EMAIL_FROM, Name: process.env.EMAIL_FROM_NAME || 'Soledd Finance' },
          To: [{ Email: email }],
          Subject: subject,
          TextPart: text || undefined,
          HTMLPart: html,
        })),
      },
      {
        auth: { username: process.env.MAILJET_API_KEY, password: process.env.MAILJET_SECRET_KEY },
        timeout: TIMEOUT_MS,
      }
    );
    return { sent: true };
  } catch (err) {
    const detail = err.response?.data?.Messages?.[0]?.Errors?.[0]?.ErrorMessage
      || err.response?.data?.ErrorMessage
      || err.message;
    console.error('[EMAIL] Mailjet send failed:', detail);
    return { sent: false, reason: detail };
  }
}

// ─── Layout helpers (shared with the weekly summary) ────────────────────────

const PILL_COLORS = {
  green: ['#e3f3ec', '#12633f'],
  red: ['#fbe7e5', '#a02a20'],
  amber: ['#fdf1d9', '#8a5a07'],
  blue: ['#e4eefb', '#1d4f91'],
  grey: ['#eceeed', '#46504d'],
};

function pill(text, color = 'grey') {
  const [bg, fg] = PILL_COLORS[color] || PILL_COLORS.grey;
  return `<span style="display:inline-block;background:${bg};color:${fg};font-size:12px;font-weight:700;padding:3px 10px;border-radius:999px;letter-spacing:.2px">${esc(text)}</span>`;
}

/** Layout shared by every email: heading, body, optional dashboard button. */
function layout(heading, bodyHtml, { button, badge, banner } = {}) {
  const url = dashboardUrl();
  const cta = button && url
    ? `<p style="margin:26px 0 0"><a href="${esc(url)}" style="background:${BRAND};color:#fff;text-decoration:none;padding:10px 18px;border-radius:6px;font-weight:600;display:inline-block">${esc(button)}</a></p>`
    : '';
  const bannerHtml = banner
    ? `<div style="background:#fdf1d9;color:#8a5a07;border-radius:6px;padding:8px 12px;font-size:12.5px;margin:0 0 18px">${esc(banner)}</div>`
    : '';
  return `<div style="font-family:Arial,Helvetica,sans-serif;font-size:14px;line-height:1.55;color:#1c2321;max-width:580px;padding:4px">
    ${bannerHtml}
    ${badge ? `<div style="margin:0 0 10px">${badge}</div>` : ''}
    <h2 style="font-size:18px;margin:0 0 14px">${esc(heading)}</h2>
    ${bodyHtml}
    ${cta}
    <p style="color:${MUTED};font-size:12px;margin-top:30px;border-top:1px solid #e3e7e5;padding-top:12px">Soledd Finance · sent automatically, please don't reply to this email. Notification preferences can be changed in the dashboard under Settings → Notifications.</p>
  </div>`;
}

function detailTable(rows) {
  const body = rows
    .filter(([, v]) => v !== undefined && v !== null && String(v) !== '')
    .map(([k, v]) => `<tr><td style="padding:3px 18px 3px 0;color:${MUTED};vertical-align:top">${esc(k)}</td><td style="padding:3px 0"><strong>${esc(v)}</strong></td></tr>`)
    .join('');
  return `<table style="border-collapse:collapse">${body}</table>`;
}

// ─── Officer invites ────────────────────────────────────────────────────────

function renderOfficerInvite({ to, name, tempPassword, loginUrl }) {
  const url = loginUrl || dashboardUrl();
  const first = esc(String(name || '').split(' ')[0] || 'there');
  return {
    subject: 'Your Soledd Loans dashboard login',
    html: layout(
      'Your Soledd Loans dashboard login',
      `<p>Hi ${first},</p>
       <p>You've been added as a credit officer on the Soledd Loans dashboard. Here's your temporary login:</p>
       ${detailTable([['Email', to], ['Temporary password', tempPassword]])}
       <p>${url ? `Sign in at <a href="${esc(url)}">${esc(url)}</a>.` : 'Sign in with the dashboard link your admin gave you.'} You'll be asked to set your own password the first time you log in.</p>
       <p style="color:${MUTED}">This password is temporary - please don't share it.</p>`
    ),
  };
}

async function sendOfficerInvite(args) {
  const { subject, html } = renderOfficerInvite(args);
  return sendMail({ to: args.to, subject, html });
}

// ─── Staff notification content ─────────────────────────────────────────────

const CATEGORY_LABEL = {
  SSB: 'SSB (civil servant)',
  GOVT_PENSIONER: 'Government pensioner',
  PRIVATE_SECTOR: 'Private sector',
  SME: 'SME',
};

function appRows(app) {
  return [
    ['Reference', app.reference_number],
    ['Applicant', app.full_name],
    ['Category', CATEGORY_LABEL[app.category] || app.category],
    ['Amount', app.loan_amount != null ? money(app.loan_amount) : ''],
    ['Period', app.repayment_months ? `${app.repayment_months} months` : ''],
    ['Employer', app.employer_name],
    ['Phone', app.applicant_phone],
  ];
}

const RENDER = {
  newApplication(app) {
    const ref = app.reference_number || 'New application';
    return {
      subject: `New loan application ${ref}`,
      heading: `New loan application ${ref}`,
      badge: pill('NEW APPLICATION', 'blue'),
      body: `<p>A customer has just applied on WhatsApp.</p>` + detailTable([
        ...appRows(app).filter(([k]) => k !== 'Reference'),
        ['Via field agent', app.agent_phone],
      ]),
    };
  },

  documentsReceived({ referenceNumber, agentApplication, name, phone }) {
    const what = agentApplication ? 'field agent application' : `application ${referenceNumber || ''}`.trim();
    return {
      subject: `Documents received for ${what}`,
      heading: 'Documents received',
      badge: pill('READY TO REVIEW', 'blue'),
      body: `<p>The applicant has finished sending their documents. The ${esc(what)} is ready to review.</p>` + detailTable([
        ['Reference', referenceNumber],
        ['Applicant', name],
        ['Phone', phone],
      ]),
    };
  },

  applicationDecision(app, status, { note, actor } = {}) {
    const approved = status === 'APPROVED';
    return {
      subject: `Application ${app.reference_number} ${approved ? 'approved' : 'rejected'}`,
      heading: `Application ${app.reference_number} ${approved ? 'approved' : 'rejected'}`,
      badge: pill(approved ? 'APPROVED' : 'REJECTED', approved ? 'green' : 'red'),
      body: detailTable([
        ...appRows(app).filter(([k]) => k !== 'Reference'),
        [approved ? 'Approved by' : 'Rejected by', actor],
        ['Note', note],
      ]),
    };
  },

  applicationChanged(app, summary, { actor } = {}) {
    return {
      subject: `Application ${app.reference_number} updated`,
      heading: `Application ${app.reference_number} updated`,
      badge: pill('UPDATED', 'amber'),
      body: detailTable([
        ['What changed', summary],
        ['Changed by', actor],
        ...appRows(app).filter(([k]) => k !== 'Reference'),
      ]),
    };
  },

  newAgentApplication(app) {
    return {
      subject: `New field agent application: ${app.full_name || 'applicant'}`,
      heading: 'New field agent application',
      badge: pill('FIELD AGENT', 'blue'),
      body: `<p>Someone has applied to become a field agent.</p>` + detailTable([
        ['Applicant', app.full_name],
        ['Area', app.area],
        ['Phone', app.applicant_phone],
      ]),
    };
  },

  agentDecision(app, status, { actor } = {}) {
    const approved = status === 'APPROVED';
    return {
      subject: `Field agent application ${approved ? 'approved' : 'rejected'}: ${app.full_name || ''}`.trim(),
      heading: `Field agent application ${approved ? 'approved' : 'rejected'}`,
      badge: pill(approved ? 'AGENT APPROVED' : 'AGENT REJECTED', approved ? 'green' : 'red'),
      body: detailTable([
        ['Applicant', app.full_name],
        ['Area', app.area],
        ['Phone', app.applicant_phone],
        [approved ? 'Approved by' : 'Rejected by', actor],
      ]),
    };
  },
};

// ─── Staff notification delivery ────────────────────────────────────────────

/** Active credit officers with an email on file, plus NOTIFY_EMAILS (comma separated). */
async function staffRecipients() {
  const extra = (process.env.NOTIFY_EMAILS || '').split(',').map(s => s.trim()).filter(Boolean);
  let officers = [];
  try {
    const { data } = await supabase.from('credit_officers').select('email').eq('active', true).not('email', 'is', null);
    officers = (data || []).map(o => o.email);
  } catch (err) {
    console.error('[EMAIL] could not load officers:', err.message);
  }
  return [...new Set([...officers, ...extra].map(e => String(e).trim().toLowerCase()).filter(Boolean))];
}

/**
 * @param event        key from notificationSettings.DEFAULTS.events - skipped
 *                     if that notification is switched off in settings.
 * @param content      { subject, heading, body, badge } from RENDER.*
 * @param excludeEmail don't email the person who just made the change.
 */
async function notifyStaff(event, content, { excludeEmail } = {}) {
  if (!isConfigured()) return { sent: false, reason: 'Mailjet not configured' };
  if (!(await notificationSettings.isEventEnabled(event))) return { sent: false, reason: `${event} notifications are switched off` };

  const skip = excludeEmail ? String(excludeEmail).trim().toLowerCase() : null;
  const to = (await staffRecipients()).filter(e => e !== skip);
  if (to.length === 0) return { sent: false, reason: 'no staff recipients' };

  return sendMail({
    to,
    subject: content.subject,
    html: layout(content.heading, content.body, { button: 'Open dashboard', badge: content.badge }),
  });
}

const notifyNewApplication = app => notifyStaff('newApplication', RENDER.newApplication(app));
const notifyNewAgentApplication = app => notifyStaff('newAgentApplication', RENDER.newAgentApplication(app));

async function notifyDocumentsReceived({ applicationId, agentApplicationId, referenceNumber }) {
  const agentApplication = !!agentApplicationId;
  let name = '';
  let phone = '';
  try {
    const { data } = await supabase
      .from(agentApplication ? 'agent_applications' : 'applications')
      .select('full_name, applicant_phone')
      .eq('id', agentApplication ? agentApplicationId : applicationId)
      .single();
    name = data?.full_name || '';
    phone = data?.applicant_phone || '';
  } catch (_) { /* details are a nicety - send the email regardless */ }
  return notifyStaff('documentsReceived', RENDER.documentsReceived({ referenceNumber, agentApplication, name, phone }));
}

/** Approved / rejected -> decision email; moved back to review -> "changed". */
function notifyApplicationStatus(app, status, { note, actor } = {}) {
  if (status === 'APPROVED' || status === 'REJECTED') {
    return notifyStaff('applicationDecision', RENDER.applicationDecision(app, status, { note, actor: actor?.name }), { excludeEmail: actor?.email });
  }
  return notifyStaff('applicationChanged', RENDER.applicationChanged(app, 'Moved back to In Review', { actor: actor?.name }), { excludeEmail: actor?.email });
}

function notifyApplicationChanged(app, summary, actor) {
  return notifyStaff('applicationChanged', RENDER.applicationChanged(app, summary, { actor: actor?.name }), { excludeEmail: actor?.email });
}

function notifyAgentDecision(app, status, actor) {
  return notifyStaff('agentDecision', RENDER.agentDecision(app, status, { actor: actor?.name }), { excludeEmail: actor?.email });
}

/** Fire-and-forget wrapper: call without await from the bot flow / routes. */
function background(promise) {
  Promise.resolve(promise).catch(err => console.error('[EMAIL] notification error:', err.message));
}

// ─── Test samples ───────────────────────────────────────────────────────────

const SAMPLE_APP = {
  reference_number: 'LOS-0123',
  full_name: 'Tendai Moyo',
  category: 'SSB',
  loan_amount: 1500,
  repayment_months: 12,
  employer_name: 'Ministry of Education',
  applicant_phone: '+263771234567',
  agent_phone: '+263712345678',
};

function sampleEmails() {
  const actor = { name: 'Rudo Chikwanha' };
  const c = (label, content) => ({ label, subject: content.subject, html: layout(content.heading, content.body, { button: 'Open dashboard', badge: content.badge, banner: 'TEST EMAIL - sample data only, nothing real happened.' }) });
  const agentApp = { full_name: 'Farai Ncube', area: 'Bulawayo', applicant_phone: '+263773456789' };
  return [
    c('New loan application', RENDER.newApplication(SAMPLE_APP)),
    c('Documents received', RENDER.documentsReceived({ referenceNumber: 'LOS-0123', name: SAMPLE_APP.full_name, phone: SAMPLE_APP.applicant_phone })),
    c('Application approved', RENDER.applicationDecision(SAMPLE_APP, 'APPROVED', { actor: actor.name, note: 'Salary slip verified.' })),
    c('Application rejected', RENDER.applicationDecision(SAMPLE_APP, 'REJECTED', { actor: actor.name, note: 'Affordability check failed.' })),
    c('Application changed', RENDER.applicationChanged(SAMPLE_APP, 'Edited: loan_amount, repayment_months', { actor: actor.name })),
    c('New field agent application', RENDER.newAgentApplication(agentApp)),
    c('Field agent approved', RENDER.agentDecision(agentApp, 'APPROVED', { actor: actor.name })),
    c('Field agent rejected', RENDER.agentDecision(agentApp, 'REJECTED', { actor: actor.name })),
    (() => {
      const r = renderOfficerInvite({ to: 'new.officer@soledd.co.zw', name: 'New Officer', tempPassword: 'Temp-7Kq9xW' });
      return { label: 'Credit officer invite', subject: r.subject, html: r.html };
    })(),
  ];
}

/** Sends every sample email (plus the weekly summary, via `extra`) to one address. */
async function sendTestEmails(to, extra = []) {
  const results = [];
  for (const s of [...sampleEmails(), ...extra]) {
    const r = await sendMail({ to, subject: `[TEST] ${s.subject}`, html: s.html });
    results.push({ label: s.label, sent: r.sent, reason: r.reason });
  }
  return results;
}

module.exports = {
  isConfigured, sendMail, staffRecipients, esc, money, pill, layout, detailTable, dashboardUrl,
  sendOfficerInvite,
  notifyNewApplication,
  notifyNewAgentApplication,
  notifyDocumentsReceived,
  notifyApplicationStatus,
  notifyApplicationChanged,
  notifyAgentDecision,
  background,
  sendTestEmails,
};
