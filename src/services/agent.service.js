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
  const expiresAt = new Date(Date.now() + OTP_TTL_MINUTES * 60000).toISOString();

  const { data, error } = await supabase
    .from('agents')
    .update({ otp_code: otp, otp_expires_at: expiresAt, updated_at: new Date().toISOString() })
    .eq('id', agentId)
    .select()
    .single();

  if (error) throw new Error(error.message);

  await whatsappService.sendMessage(
    data.phone_number,
    `Your new Soledd Loans agent verification code is *${otp}*. It expires in ${OTP_TTL_MINUTES} minutes.`
  );

  return data;
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
  const { error } = await supabase.from('agents').update({ active, updated_at: new Date().toISOString() }).eq('id', agentId);
  if (error) throw new Error(error.message);
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
  const { data, error } = await supabase
    .from('applications')
    .select('status, loan_amount')
    .eq('agent_phone', phoneNumber);
  if (error) throw new Error(error.message);

  const commissionRate = (await getCommissionRatePct()) / 100;
  const total = data.length;
  const approved = data.filter(a => a.status === 'APPROVED');
  const pending = data.filter(a => a.status === 'IN_REVIEW').length;
  const rejected = data.filter(a => a.status === 'REJECTED').length;
  const totalRemuneration = approved.reduce((sum, a) => sum + Number(a.loan_amount) * commissionRate, 0);

  return {
    total,
    approved: approved.length,
    pending,
    rejected,
    approvalRate: total ? Math.round((approved.length / total) * 100) : 0,
    totalRemuneration: Math.round(totalRemuneration * 100) / 100,
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

async function decideAgentApplication(id, status, note) {
  const { data: application, error } = await supabase
    .from('agent_applications')
    .update({ status, updated_at: new Date().toISOString() })
    .eq('id', id)
    .select()
    .single();
  if (error) throw new Error(error.message);
  if (!application) return null;

  if (status === 'APPROVED') {
    await supabase.from('agents').upsert({
      phone_number: application.applicant_phone,
      name: application.full_name,
      region: application.area,
      verified: true,
      active: true,
      otp_code: null,
      otp_expires_at: null,
      updated_at: new Date().toISOString(),
    }, { onConflict: 'phone_number' });

    await whatsappService.sendMessage(
      application.applicant_phone,
      `Congratulations ${application.full_name.split(' ')[0]}! Your Soledd field agent application has been *Approved*. You now have access to the field agent menu here on WhatsApp.${note ? `\n\n${note}` : ''}`
    );
  } else if (status === 'REJECTED') {
    await whatsappService.sendMessage(
      application.applicant_phone,
      `Hello ${application.full_name.split(' ')[0]}, after review we are not able to approve your field agent application at this time.${note ? ` ${note}` : ''} You are welcome to reapply in future.`
    );
  }

  return application;
}

module.exports = {
  listAgents, addAgent, resendOtp, findByPhone, verifyOtp, setActive, updateAgent, removeAgent,
  agentPerformance, getCommissionRatePct, setCommissionRatePct,
  listAgentApplications, decideAgentApplication,
};
