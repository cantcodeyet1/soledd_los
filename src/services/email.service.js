/**
 * email.service.js — sends credit officer invite emails via Resend.
 * If RESEND_API_KEY isn't set, sendOfficerInvite no-ops and returns
 * sent:false so callers can fall back to showing the temp password
 * in the dashboard instead.
 */

'use strict';

const { Resend } = require('resend');

const resend = process.env.RESEND_API_KEY ? new Resend(process.env.RESEND_API_KEY) : null;

async function sendOfficerInvite({ to, name, tempPassword, loginUrl }) {
  if (!resend) return { sent: false, reason: 'RESEND_API_KEY not configured' };

  try {
    await resend.emails.send({
      from: process.env.RESEND_FROM_EMAIL || 'Soledd Loans <onboarding@resend.dev>',
      to,
      subject: 'Your Soledd Loans dashboard login',
      html: `
        <p>Hi ${name.split(' ')[0]},</p>
        <p>You've been added as a credit officer on the Soledd Loans dashboard. Here's your temporary login:</p>
        <p><strong>Email:</strong> ${to}<br/><strong>Temporary password:</strong> ${tempPassword}</p>
        <p>${loginUrl ? `Sign in at <a href="${loginUrl}">${loginUrl}</a>` : 'Sign in with the dashboard link your admin gave you.'} You'll be asked to set your own password on first login.</p>
        <p>This password is temporary; don't share it beyond your own login.</p>
      `,
    });
    return { sent: true };
  } catch (err) {
    console.error('sendOfficerInvite error:', err.message);
    return { sent: false, reason: err.message };
  }
}

module.exports = { sendOfficerInvite };
