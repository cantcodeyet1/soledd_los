/**
 * agent.service.js — field agent management + OTP verification.
 *
 * Flow: admin adds a phone number on the dashboard -> a 6-digit OTP is sent
 * to that number via WhatsApp -> the agent replies with the code from their
 * WhatsApp chat (handled in agentFlow.js) -> verified=true, and that number
 * gets the field-agent menu on every future message.
 */

'use strict';

const { supabase } = require('../models/supabase');
const whatsappService = require('./whatsapp.service');
const settingsService = require('./settings.service');

const OTP_TTL_MINUTES = 10;

function generateOtp() {
  return String(Math.floor(100000 + Math.random() * 900000));
}

async function listAgents() {
  const { data, error } = await supabase.from('agents').select('*').order('created_at', { ascending: false });
  if (error) throw new Error(error.message);
  return data;
}

async function addAgent({ phoneNumber, name, region }) {
  const otp = generateOtp();
  const expiresAt = new Date(Date.now() + OTP_TTL_MINUTES * 60000).toISOString();

  const { data, error } = await supabase
    .from('agents')
    .upsert({
      phone_number: phoneNumber,
      name: name || null,
      region: region || null,
      otp_code: otp,
      otp_expires_at: expiresAt,
      verified: false,
      active: true,
      updated_at: new Date().toISOString(),
    }, { onConflict: 'phone_number' })
    .select()
    .single();

  if (error) throw new Error(error.message);

  await whatsappService.sendMessage(
    phoneNumber,
    `Welcome to Soledd Loans field agent access. Your verification code is *${otp}*. Reply with this code to activate your agent account. It expires in ${OTP_TTL_MINUTES} minutes.`
  );

  return data;
}

async function resendOtp(agentId) {
  const otp = generateOtp();
  const expiresAt = new Date(Date.now() + ACTIVATION_CODE_TTL_HOURS * 3600 * 1000).toISOString();

  const { data, error } = await supabase
    .from('agents')
    .update({ otp_code: otp, otp_expires_at: expiresAt, verified: false, updated_at: new Date().toISOString() })
    .eq('id', agentId)
    .select()
    .single();

  if (error) throw new Error(error.message);

  // No bot send — the dashboard opens a WhatsApp chat so the officer hands
  // over the new code, and the agent sends it to the bot to activate.
  return { agent: data, activationCode: otp };
}

async function findByPhone(phoneNumber) {
  const { data } = await supabase.from('agents').select('*').eq('phone_number', phoneNumber).single();
  return data || null;
}

/** Called from the WhatsApp webhook when an unverified agent number replies with a code. */
async function verifyOtp(phoneNumber, code) {
  const agent = await findByPhone(phoneNumber);
  if (!agent || agent.verified) return null;

  if (agent.otp_code !== code.trim()) return { ok: false, reason: 'incorrect' };
  if (!agent.otp_expires_at || new Date(agent.otp_expires_at) < new Date()) return { ok: false, reason: 'expired' };

  const { data, error } = await supabase
    .from('agents')
    .update({ verified: true, otp_code: null, otp_expires_at: null, updated_at: new Date().toISOString() })
    .eq('id', agent.id)
    .select()
    .single();

  if (error) throw new Error(error.message);
  return { ok: true, agent: data };
}

async function setActive(agentId, active) {
  const { data, error } = await supabase
    .from('agents')
    .update({ active, updated_at: new Date().toISOString() })
    .eq('id', agentId)
    .select()
    .single();
  if (error) throw new Error(error.message);

  // Deactivating an agent takes effect immediately: any client application
  // they're mid-capture on is dropped, and they fall back to the normal
  // customer menu on their next WhatsApp message (webhook.controller.js
  // gates the agent flow on verified && active).
  if (!active && data?.phone_number) {
    await supabase
      .from('conversation_states')
      .update({ flow: null, step: null, flow_data: {}, updated_at: new Date().toISOString() })
      .eq('customer_phone', data.phone_number)
      .eq('flow', 'AGENT');
    await whatsappService.sendMessage(
      data.phone_number,
      'Your Soledd field agent access has been paused. Any application in progress has been stopped. You can still use Soledd Loans as a normal customer.'
    ).catch(() => {});
  }
}

async function updateAgent(agentId, { phoneNumber, name, region }) {
  const updates = { updated_at: new Date().toISOString() };
  if (phoneNumber !== undefined) updates.phone_number = phoneNumber;
  if (name !== undefined) updates.name = name;
  if (region !== undefined) updates.region = region;

  const { data, error } = await supabase.from('agents').update(updates).eq('id', agentId).select().single();
  if (error) throw new Error(error.message);
  return data;
}

async function removeAgent(agentId) {
  const { error } = await supabase.from('agents').delete().eq('id', agentId);
  if (error) throw new Error(error.message);
}

const COMMISSION_RATE_SETTING_KEY = 'agent_commission_rate_pct';
const DEFAULT_COMMISSION_RATE_PCT = 3; // % of loan amount, paid on approved loans

async function getCommissionRatePct() {
  const stored = await settingsService.getSetting(COMMISSION_RATE_SETTING_KEY);
  return typeof stored === 'number' ? stored : DEFAULT_COMMISSION_RATE_PCT;
}

async function setCommissionRatePct(pct) {
  await settingsService.setSetting(COMMISSION_RATE_SETTING_KEY, Number(pct));
}

async function agentPerformance(phoneNumber) {
  let { data, error } = await supabase
    .from('applications')
    .select('status, loan_amount, agent_commission_paid')
    .eq('agent_phone', phoneNumber);
  // Tolerate the agent_commission_paid column not existing yet.
  if (error && /agent_commission_paid/.test(error.message || '')) {
    ({ data, error } = await supabase.from('applications').select('status, loan_amount').eq('agent_phone', phoneNumber));
  }
  if (error) throw new Error(error.message);

  const commissionRate = (await getCommissionRatePct()) / 100;
  const round2 = n => Math.round(n * 100) / 100;
  const total = data.length;
  const approved = data.filter(a => a.status === 'APPROVED');
  const pending = data.filter(a => a.status === 'IN_REVIEW').length;
  const rejected = data.filter(a => a.status === 'REJECTED').length;
  const commissionOf = a => Number(a.loan_amount) * commissionRate;

  const accrued = approved.reduce((s, a) => s + commissionOf(a), 0);
  const paid = approved.filter(a => a.agent_commission_paid).reduce((s, a) => s + commissionOf(a), 0);

  return {
    total,
    approved: approved.length,
    pending,
    rejected,
    approvalRate: total ? Math.round((approved.length / total) * 100) : 0,
    // totalRemuneration kept as the accrued total for backwards compatibility.
    totalRemuneration: round2(accrued),
    accruedRemuneration: round2(accrued),
    paidRemuneration: round2(paid),
    outstandingRemuneration: round2(accrued - paid),
  };
}

// ─── Agent applications ("Become an Agent" WhatsApp flow) ──────────────────

async function listAgentApplications(status) {
  let query = supabase.from('agent_applications').select('*').order('created_at', { ascending: false });
  if (status) query = query.eq('status', status);
  const { data, error } = await query;
  if (error) throw new Error(error.message);
  return data;
}

// How long an activation code issued on agent-application approval stays
// valid — longer than the dashboard "Add agent" OTP (10 min) because the
// officer has to relay this one to the applicant out-of-band.
const ACTIVATION_CODE_TTL_HOURS = 72;

async function decideAgentApplication(id, status, note) {
  const { data: application, error } = await supabase
    .from('agent_applications')
    .update({ status, updated_at: new Date().toISOString() })
    .eq('id', id)
    .select()
    .single();
  if (error) throw new Error(error.message);
  if (!application) return null;

  let activationCode = null;

  if (status === 'APPROVED') {
    // Approval registers the agent as PENDING with a fresh 6-digit
    // activation code. They become a live field agent only once they send
    // that code to the bot (webhook.controller.js → verifyOtp). The
    // dashboard opens a WhatsApp chat pre-filled with the code so the
    // officer can hand it over.
    activationCode = generateOtp();
    const expiresAt = new Date(Date.now() + ACTIVATION_CODE_TTL_HOURS * 3600 * 1000).toISOString();

    await supabase.from('agents').upsert({
      phone_number: application.applicant_phone,
      name: application.full_name,
      region: application.area,
      verified: false,
      active: true,
      otp_code: activationCode,
      otp_expires_at: expiresAt,
      updated_at: new Date().toISOString(),
    }, { onConflict: 'phone_number' });
  } else if (status === 'REJECTED') {
    await whatsappService.sendMessage(
      application.applicant_phone,
      `Hello ${application.full_name.split(' ')[0]}, after review we are not able to approve your field agent application at this time.${note ? ` ${note}` : ''} You are welcome to reapply in future.`
    );
  }

  return { ...application, activationCode };
}

/** The message the dashboard pre-fills into a WhatsApp chat after approving
 *  an agent application. This is sent from the officer's number, so it tells
 *  the agent to send the code to the *bot* (not reply here). */
function activationMessage(fullName, code, botNumber) {
  const first = (fullName || '').split(' ')[0] || 'there';
  const where = botNumber ? ` on WhatsApp at ${botNumber}` : ' to the Soledd Loans WhatsApp bot';
  return `Congratulations ${first}! Your Soledd field agent application has been approved.\n\n`
    + `To activate your field agent account, send this code${where} — just the code, nothing else:\n\n`
    + `${code}\n\n`
    + `The code is valid for ${ACTIVATION_CODE_TTL_HOURS} hours.`;
}

module.exports = {
  listAgents, addAgent, resendOtp, findByPhone, verifyOtp, setActive, updateAgent, removeAgent,
  agentPerformance, getCommissionRatePct, setCommissionRatePct,
  listAgentApplications, decideAgentApplication, activationMessage,
};
