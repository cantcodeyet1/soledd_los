/**
 * admin.routes.js — dashboard API. All routes here are mounted behind the
 * `authenticate` middleware in index.js.
 */

'use strict';

const express = require('express');
const router = express.Router();

const { supabase } = require('../models/supabase');
const whatsappService = require('../services/whatsapp.service');
const loanCalculator = require('../services/loanCalculator.service');
const pdfExport = require('../services/pdfExport.service');
const pdfFormFill = require('../services/pdfFormFill.service');
const crystalExport = require('../services/crystalExport.service');
const agentService = require('../services/agent.service');
const documentStorage = require('../services/documentStorage.service');
const settingsService = require('../services/settings.service');
const officerAuth = require('../services/officerAuth.service');
const emailService = require('../services/email.service');
const { getEffectivePassword, requireAdmin } = require('../middleware/auth');

// ─── Applications ───────────────────────────────────────────────────────────

router.get('/applications', async (req, res) => {
  try {
    const { category, status, search, agent_phone } = req.query;
    let query = supabase.from('applications').select('*').order('created_at', { ascending: false });

    if (category) query = query.eq('category', category);
    if (status) query = query.eq('status', status);
    if (agent_phone) query = query.eq('agent_phone', agent_phone);
    if (search) {
      query = query.or(`full_name.ilike.%${search}%,reference_number.ilike.%${search}%,national_id.ilike.%${search}%`);
    }

    const { data, error } = await query;
    if (error) throw error;
    res.json({ applications: data });
  } catch (err) {
    console.error('GET /applications error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

router.get('/applications/stats', async (req, res) => {
  try {
    const startOfToday = new Date();
    startOfToday.setHours(0, 0, 0, 0);
    const startOfMonth = new Date();
    startOfMonth.setDate(1);
    startOfMonth.setHours(0, 0, 0, 0);

    const [{ count: pending }, { data: approvedToday }, { data: disbursedMonth }, { count: activeAgents }] = await Promise.all([
      supabase.from('applications').select('id', { count: 'exact', head: true }).eq('status', 'IN_REVIEW'),
      supabase.from('applications').select('id').eq('status', 'APPROVED').gte('updated_at', startOfToday.toISOString()),
      supabase.from('applications').select('loan_amount').eq('status', 'APPROVED').gte('updated_at', startOfMonth.toISOString()),
      supabase.from('agents').select('id', { count: 'exact', head: true }).eq('verified', true).eq('active', true),
    ]);

    const disbursedTotal = (disbursedMonth || []).reduce((sum, a) => sum + Number(a.loan_amount || 0), 0);

    res.json({
      pendingReview: pending || 0,
      approvedToday: (approvedToday || []).length,
      disbursedThisMonth: disbursedTotal,
      activeFieldAgents: activeAgents || 0,
    });
  } catch (err) {
    console.error('GET /applications/stats error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

router.get('/applications/:id', async (req, res) => {
  try {
    const { data, error } = await supabase.from('applications').select('*').eq('id', req.params.id).single();
    if (error || !data) return res.status(404).json({ error: 'Not found' });
    res.json({ application: data });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/applications/:id/documents', async (req, res) => {
  try {
    const docs = await documentStorage.listDocuments(req.params.id);
    const withUrls = await Promise.all(docs.map(async d => ({
      ...d,
      url: await documentStorage.getSignedUrl(d.storage_path),
    })));
    res.json({ documents: withUrls });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.patch('/applications/:id/status', async (req, res) => {
  try {
    const { status, note } = req.body;
    if (!['APPROVED', 'REJECTED', 'IN_REVIEW'].includes(status)) {
      return res.status(400).json({ error: 'status must be APPROVED, REJECTED, or IN_REVIEW' });
    }

    const { data: application, error } = await supabase
      .from('applications')
      .update({ status, updated_at: new Date().toISOString() })
      .eq('id', req.params.id)
      .select()
      .single();

    if (error || !application) return res.status(404).json({ error: 'Not found' });

    let message = null;
    if (status === 'APPROVED') {
      message = `Good news, ${application.full_name.split(' ')[0]}! Your application ${application.reference_number} ($${Number(application.loan_amount).toFixed(2)}) has been *Approved*. Funds will be disbursed to your registered account shortly.${note ? `\n\n${note}` : ''}`;
    } else if (status === 'REJECTED') {
      message = `Hello ${application.full_name.split(' ')[0]}, after review we are not able to approve application ${application.reference_number} at this time.${note ? ` ${note}` : ''} You are welcome to reapply in future.`;
    }

    if (message) {
      await whatsappService.sendMessage(application.applicant_phone, message);
    }

    res.json({ application });
  } catch (err) {
    console.error('PATCH /applications/:id/status error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

router.patch('/applications/:id/agent', async (req, res) => {
  try {
    const { agent_phone } = req.body;
    const { data: application, error } = await supabase
      .from('applications')
      .update({ agent_phone: agent_phone || null, updated_at: new Date().toISOString() })
      .eq('id', req.params.id)
      .select()
      .single();

    if (error || !application) return res.status(404).json({ error: 'Not found' });
    res.json({ application });
  } catch (err) {
    console.error('PATCH /applications/:id/agent error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

router.patch('/applications/:id/loan-terms', async (req, res) => {
  try {
    const { loan_product, borrower_type, disbursement_date } = req.body;
    const { data: application, error } = await supabase
      .from('applications')
      .update({ loan_product, borrower_type, disbursement_date, updated_at: new Date().toISOString() })
      .eq('id', req.params.id)
      .select()
      .single();

    if (error || !application) return res.status(404).json({ error: 'Not found' });
    res.json({ application });
  } catch (err) {
    console.error('PATCH /applications/:id/loan-terms error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

router.post('/applications/:id/request-info', async (req, res) => {
  try {
    const { message } = req.body;
    if (!message || !message.trim()) return res.status(400).json({ error: 'message is required' });

    const { data: application, error } = await supabase.from('applications').select('*').eq('id', req.params.id).single();
    if (error || !application) return res.status(404).json({ error: 'Not found' });

    await whatsappService.sendMessage(
      application.applicant_phone,
      `Hello ${application.full_name.split(' ')[0]}. Regarding your application ${application.reference_number}: ${message.trim()}`
    );

    res.json({ ok: true });
  } catch (err) {
    console.error('POST /applications/:id/request-info error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

router.get('/applications/:id/pdf', async (req, res) => {
  try {
    const { data: application, error } = await supabase.from('applications').select('*').eq('id', req.params.id).single();
    if (error || !application) return res.status(404).json({ error: 'Not found' });

    const computed = await loanCalculator.computeForApplication(application).catch(() => null);

    // Prefer the exact paper-form replica; fall back to the generated
    // summary if the Python filler isn't available or errors out.
    let buffer = await pdfFormFill.fillFormPdf(application.category, {
      answers: application.extra_details || {},
      application: {
        applicantPhone: application.applicant_phone,
        loanAmount: application.loan_amount,
        repaymentMonths: application.repayment_months,
        fullName: application.full_name,
        nationalId: application.national_id,
        employerName: application.employer_name,
        referenceNumber: application.reference_number,
      },
      computed,
    });
    if (!buffer) buffer = await pdfExport.buildApplicationPdf(application, computed);

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${application.reference_number || 'application'}.pdf"`);
    res.send(buffer);
  } catch (err) {
    console.error('GET /applications/:id/pdf error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

router.get('/applications/export/crystal', async (req, res) => {
  try {
    const { status } = req.query;
    let query = supabase.from('applications').select('*').order('created_at', { ascending: false });
    if (status) query = query.eq('status', status);

    const { data, error } = await query;
    if (error) throw error;

    const buffer = await crystalExport.buildCrystalExport(data);
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="soledd_loans_export_${new Date().toISOString().slice(0, 10)}.xlsx"`);
    res.send(buffer);
  } catch (err) {
    console.error('GET /applications/export/crystal error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ─── Loan Calculator ────────────────────────────────────────────────────────

router.get('/calculator/rates', requireAdmin, async (req, res) => {
  try {
    res.json(await loanCalculator.getConfig());
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.put('/calculator/rates', requireAdmin, async (req, res) => {
  try {
    const { products, upfront } = req.body;
    if (!products || !upfront) {
      return res.status(400).json({ error: 'products and upfront are required' });
    }
    await loanCalculator.setConfig({ products, upfront });
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/calculator/compute', async (req, res) => {
  try {
    const {
      product, borrowerType, amountRequired, disbursementDate, repaymentStartDate, tenorMonths,
      negotiatedRates, repaymentType,
    } = req.body;
    if (!product || !borrowerType || !amountRequired || !disbursementDate || !tenorMonths) {
      return res.status(400).json({ error: 'product, borrowerType, amountRequired, disbursementDate, and tenorMonths are required' });
    }
    const config = await loanCalculator.getConfig();
    const result = loanCalculator.computeLoan({
      product, borrowerType,
      amountRequired: Number(amountRequired),
      disbursementDate,
      repaymentStartDate: repaymentStartDate || undefined,
      tenorMonths: Number(tenorMonths),
      config,
      negotiatedRates,
      repaymentType,
    });
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── Field Agents ───────────────────────────────────────────────────────────

router.get('/agents', async (req, res) => {
  try {
    const agents = await agentService.listAgents();
    const withPerformance = await Promise.all(agents.map(async a => ({
      ...a,
      performance: await agentService.agentPerformance(a.phone_number),
    })));
    res.json({ agents: withPerformance });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/agents', async (req, res) => {
  try {
    const { phoneNumber, name, region } = req.body;
    if (!phoneNumber) return res.status(400).json({ error: 'phoneNumber is required' });
    const agent = await agentService.addAgent({ phoneNumber, name, region });
    res.json({ agent });
  } catch (err) {
    console.error('POST /agents error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

router.post('/agents/:id/resend-otp', async (req, res) => {
  try {
    const agent = await agentService.resendOtp(req.params.id);
    res.json({ agent });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.patch('/agents/:id', async (req, res) => {
  try {
    const { active, phoneNumber, name, region } = req.body;
    if (active !== undefined) await agentService.setActive(req.params.id, active);
    if (phoneNumber !== undefined || name !== undefined || region !== undefined) {
      await agentService.updateAgent(req.params.id, { phoneNumber, name, region });
    }
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.delete('/agents/:id', async (req, res) => {
  try {
    await agentService.removeAgent(req.params.id);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/agents/export/excel', async (req, res) => {
  try {
    const agents = await agentService.listAgents();
    const withPerformance = await Promise.all(agents.map(async a => ({
      ...a,
      performance: await agentService.agentPerformance(a.phone_number),
    })));
    const buffer = await crystalExport.buildAgentsExport(withPerformance);
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="soledd_field_agents_${new Date().toISOString().slice(0, 10)}.xlsx"`);
    res.send(buffer);
  } catch (err) {
    console.error('GET /agents/export/excel error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

router.get('/agents/commission-rate', requireAdmin, async (req, res) => {
  try {
    res.json({ pct: await agentService.getCommissionRatePct() });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.put('/agents/commission-rate', requireAdmin, async (req, res) => {
  try {
    const { pct } = req.body;
    if (pct === undefined || Number.isNaN(Number(pct))) return res.status(400).json({ error: 'pct is required' });
    await agentService.setCommissionRatePct(pct);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── Agent Applications ("Become an Agent" WhatsApp flow) ──────────────────

router.get('/agent-applications/:id/documents', async (req, res) => {
  try {
    const docs = await documentStorage.listAgentApplicationDocuments(req.params.id);
    const withUrls = await Promise.all(docs.map(async d => ({
      ...d,
      url: await documentStorage.getSignedUrl(d.storage_path),
    })));
    res.json({ documents: withUrls });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/agent-applications', async (req, res) => {
  try {
    const applications = await agentService.listAgentApplications(req.query.status);
    res.json({ applications });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.patch('/agent-applications/:id/status', async (req, res) => {
  try {
    const { status, note } = req.body;
    if (!['APPROVED', 'REJECTED'].includes(status)) {
      return res.status(400).json({ error: 'status must be APPROVED or REJECTED' });
    }
    const application = await agentService.decideAgentApplication(req.params.id, status, note);
    if (!application) return res.status(404).json({ error: 'Not found' });
    res.json({ application });
  } catch (err) {
    console.error('PATCH /agent-applications/:id/status error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ─── Credit Officers ────────────────────────────────────────────────────────
// ADMIN-only: officer accounts (and what they can see/do) are managed here.

router.get('/officers', requireAdmin, async (req, res) => {
  try {
    const { data, error } = await supabase.from('credit_officers').select('*').order('created_at', { ascending: false });
    if (error) throw error;
    res.json({ officers: data });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/officers', requireAdmin, async (req, res) => {
  try {
    const { name, email, branch, role } = req.body;
    if (!name) return res.status(400).json({ error: 'name is required' });
    if (!email) return res.status(400).json({ error: 'email is required to send a login invite' });

    const { officer, tempPassword } = await officerAuth.createOfficerWithTempPassword({
      name, email: email.trim().toLowerCase(), branch, role,
    });
    const { sent } = await emailService.sendOfficerInvite({ to: officer.email, name: officer.name, tempPassword });

    res.json({ officer, tempPassword, emailSent: sent });
  } catch (err) {
    if (err.message && err.message.includes('duplicate')) {
      return res.status(409).json({ error: 'An officer with this email already exists' });
    }
    res.status(500).json({ error: err.message });
  }
});

router.post('/officers/:id/resend-invite', requireAdmin, async (req, res) => {
  try {
    const { officer, tempPassword } = await officerAuth.resetTempPassword(req.params.id);
    const { sent } = await emailService.sendOfficerInvite({ to: officer.email, name: officer.name, tempPassword });
    res.json({ officer, tempPassword, emailSent: sent });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.patch('/officers/:id', requireAdmin, async (req, res) => {
  try {
    const { name, email, branch, active, role } = req.body;
    const updates = { updated_at: new Date().toISOString() };
    if (name !== undefined) updates.name = name;
    if (email !== undefined) updates.email = email;
    if (branch !== undefined) updates.branch = branch;
    if (active !== undefined) updates.active = active;
    if (role !== undefined) updates.role = role;

    const { data, error } = await supabase.from('credit_officers').update(updates).eq('id', req.params.id).select().single();
    if (error) throw error;
    res.json({ officer: data });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.delete('/officers/:id', requireAdmin, async (req, res) => {
  try {
    const { error } = await supabase.from('credit_officers').delete().eq('id', req.params.id);
    if (error) throw error;
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── Profile / account ──────────────────────────────────────────────────────

router.post('/profile/password', requireAdmin, async (req, res) => {
  try {
    const { currentPassword, newPassword } = req.body;
    if (!currentPassword || !newPassword) {
      return res.status(400).json({ error: 'currentPassword and newPassword are required' });
    }
    if (newPassword.length < 8) {
      return res.status(400).json({ error: 'New password must be at least 8 characters' });
    }

    const effective = await getEffectivePassword();
    if (currentPassword !== effective) {
      return res.status(401).json({ error: 'Current password is incorrect' });
    }

    await settingsService.setSetting('admin_password_override', newPassword);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
