/**
 * email.service.js — all outbound email, sent through Mailjet's Send API
 * (v3.1) from a single sender address (EMAIL_FROM, e.g. management@soledd.co.zw).
 *
 * Two kinds of mail share this one sender:
 *   - credit officer login invites (sendOfficerInvite)
 *   - staff notifications: new loan application, new field-agent
 *     application, documents received (notifyStaff)
 *
 * Everything is best-effort. If MAILJET_API_KEY / MAILJET_SECRET_KEY /
 * EMAIL_FROM aren't set the senders no-op and return sent:false, and no
 * failure here ever blocks the WhatsApp bot or an API response.
 */

'use strict';

const axios = require('axios');
const { supabase } = require('../models/supabase');

const MAILJET_URL = 'https://api.mailjet.com/v3.1/send';
const TIMEOUT_MS = 12000;

function isConfigured() {
  return !!(process.env.MAILJET_API_KEY && process.env.MAILJET_SECRET_KEY && process.env.EMAIL_FROM);
}

function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function dashboardUrl() {
  return (process.env.DASHBOARD_URL || '').replace(/\/$/, '');
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

/** Layout shared by every email: small heading, body, optional dashboard button. */
function layout(heading, bodyHtml, { button } = {}) {
  const url = dashboardUrl();
  const cta = button && url
    ? `<p style="margin:24px 0 0"><a href="${esc(url)}" style="background:#0f5c4d;color:#fff;text-decoration:none;padding:10px 18px;border-radius:6px;font-weight:600;display:inline-block">${esc(button)}</a></p>`
    : '';
  return `<div style="font-family:Arial,Helvetica,sans-serif;font-size:14px;line-height:1.55;color:#1c2321;max-width:560px">
    <h2 style="font-size:17px;margin:0 0 14px">${esc(heading)}</h2>
    ${bodyHtml}
    ${cta}
    <p style="color:#7a8481;font-size:12px;margin-top:28px">Soledd Finance · sent automatically, please don't reply to this email.</p>
  </div>`;
}

function detailTable(rows) {
  const body = rows
    .filter(([, v]) => v !== undefined && v !== null && String(v) !== '')
    .map(([k, v]) => `<tr><td style="padding:3px 16px 3px 0;color:#7a8481">${esc(k)}</td><td style="padding:3px 0"><strong>${esc(v)}</strong></td></tr>`)
    .join('');
  return `<table style="border-collapse:collapse">${body}</table>`;
}

// ─── Officer invites ────────────────────────────────────────────────────────

async function sendOfficerInvite({ to, name, tempPassword, loginUrl }) {
  const url = loginUrl || dashboardUrl();
  const first = esc(String(name || '').split(' ')[0] || 'there');
  const html = layout(
    'Your Soledd Loans dashboard login',
    `<p>Hi ${first},</p>
     <p>You've been added as a credit officer on the Soledd Loans dashboard. Here's your temporary login:</p>
     ${detailTable([['Email', to], ['Temporary password', tempPassword]])}
     <p>${url ? `Sign in at <a href="${esc(url)}">${esc(url)}</a>.` : 'Sign in with the dashboard link your admin gave you.'} You'll be asked to set your own password the first time you log in.</p>
     <p style="color:#7a8481">This password is temporary - please don't share it.</p>`
  );
  return sendMail({ to, subject: 'Your Soledd Loans dashboard login', html });
}

// ─── Staff notifications ────────────────────────────────────────────────────

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
  return [...new Set([...officers, ...extra].map(e => e.toLowerCase()))];
}

async function notifyStaff(subject, heading, bodyHtml) {
  if (!isConfigured()) return { sent: false, reason: 'Mailjet not configured' };
  const to = await staffRecipients();
  if (to.length === 0) return { sent: false, reason: 'no staff recipients' };
  return sendMail({ to, subject, html: layout(heading, bodyHtml, { button: 'Open dashboard' }) });
}

const CATEGORY_LABEL = {
  SSB: 'SSB (civil servant)',
  GOVT_PENSIONER: 'Government pensioner',
  PRIVATE_SECTOR: 'Private sector',
  SME: 'SME',
};

function notifyNewApplication(app) {
  const ref = app.reference_number || 'New application';
  return notifyStaff(
    `New loan application ${ref}`,
    `New loan application ${ref}`,
    `<p>A customer has just applied on WhatsApp.</p>` + detailTable([
      ['Applicant', app.full_name],
      ['Category', CATEGORY_LABEL[app.category] || app.category],
      ['Amount', app.loan_amount != null ? `$${Number(app.loan_amount).toFixed(2)}` : ''],
      ['Period', app.repayment_months ? `${app.repayment_months} months` : ''],
      ['Employer', app.employer_name],
      ['Phone', app.applicant_phone],
      ['Via field agent', app.agent_phone],
    ])
  );
}

function notifyNewAgentApplication(app) {
  return notifyStaff(
    `New field agent application: ${app.full_name || 'applicant'}`,
    'New field agent application',
    `<p>Someone has applied to become a field agent.</p>` + detailTable([
      ['Applicant', app.full_name],
      ['Area', app.area],
      ['Phone', app.applicant_phone],
    ])
  );
}

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

  const what = agentApplication ? 'field agent application' : `application ${referenceNumber || ''}`.trim();
  return notifyStaff(
    `Documents received for ${what}`,
    'Documents received',
    `<p>The applicant has finished sending their documents. The ${esc(what)} is ready to review.</p>` + detailTable([
      ['Reference', referenceNumber],
      ['Applicant', name],
      ['Phone', phone],
    ])
  );
}

/** Fire-and-forget wrapper: call without await from the bot flow. */
function background(promise) {
  Promise.resolve(promise).catch(err => console.error('[EMAIL] notification error:', err.message));
}

module.exports = {
  isConfigured,
  sendMail,
  sendOfficerInvite,
  notifyNewApplication,
  notifyNewAgentApplication,
  notifyDocumentsReceived,
  background,
};
