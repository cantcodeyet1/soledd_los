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

// ─── Activity timeline ──────────────────────────────────────────────────────
// Best-effort audit log. Never throw from here — a failed log line must not
// break the action it was recording.
async function logActivity(applicationId, type, summary, detail, req) {
  try {
    await supabase.from('application_activity').insert([{
      application_id: applicationId,
      type,
      summary,
      detail: detail || {},
      actor_name: req?.user?.name || null,
      actor_email: req?.user?.email || null,
    }]);
  } catch (err) {
    console.error('[ACTIVITY] log failed:', err.message);
  }
}

// ─── Applications ───────────────────────────────────────────────────────────

router.get('/applications', async (req, res) => {
  try {
    const { category, status, search, agent_phone, applicant_phone, archived } = req.query;

    function baseQuery(withArchived) {
      let q = supabase.from('applications').select('*').order('created_at', { ascending: false });
      // Default view hides archived; ?archived=true shows only archived,
      // ?archived=all shows everything.
      if (withArchived) {
        if (archived === 'true') q = q.eq('archived', true);
        else if (archived !== 'all') q = q.eq('archived', false);
      }
      if (category) q = q.eq('category', category);
      if (status) q = q.eq('status', status);
      if (agent_phone) q = q.eq('agent_phone', agent_phone);
      if (applicant_phone) q = q.eq('applicant_phone', applicant_phone);
      if (search) q = q.or(`full_name.ilike.%${search}%,reference_number.ilike.%${search}%,national_id.ilike.%${search}%`);
      return q;
    }

    let { data, error } = await baseQuery(true);
    // Tolerate the `archived` column not existing yet (migration not run).
    if (error && /archived/.test(error.message || '')) {
      console.warn('[applications] archived column missing — run the pending migration');
      ({ data, error } = await baseQuery(false));
    }
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

/** The applicant-facing message for a decision — also handed back to the
 *  dashboard so it can open a pre-filled WhatsApp chat for the officer to
 *  send (see ?notify below). */
function decisionMessage(application, status, note) {
  const firstName = (application.full_name || '').split(' ')[0] || 'there';
  if (status === 'APPROVED') {
    return `Good news, ${firstName}! Your application ${application.reference_number} ($${Number(application.loan_amount).toFixed(2)}) has been *Approved*. Funds will be disbursed to your registered account shortly.${note ? `\n\n${note}` : ''}`;
  }
  if (status === 'REJECTED') {
    return `Hello ${firstName}, after review we are not able to approve application ${application.reference_number} at this time.${note ? `\n\nReason: ${note}` : ''} You are welcome to reapply in future.`;
  }
  return null;
}

router.patch('/applications/:id/status', async (req, res) => {
  try {
    const { status, note } = req.body;
    // ?notify=send  → bot sends the applicant message itself (old behaviour)
    // default       → dashboard opens a pre-filled WhatsApp chat instead
    const notify = req.query.notify === 'send';
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

    const message = decisionMessage(application, status, note);
    if (message && notify) {
      await whatsappService.sendMessage(application.applicant_phone, message);
    }

    const label = status === 'APPROVED' ? 'Approved' : status === 'REJECTED' ? 'Rejected' : 'Moved back to In Review';
    await logActivity(req.params.id, 'STATUS_CHANGED', `${label}${note ? ` — ${note}` : ''}`, { status, note: note || null }, req);

    res.json({ application, notificationMessage: message, notified: !!(message && notify) });
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
    await logActivity(
      req.params.id, 'AGENT_ASSIGNED',
      agent_phone ? `Field agent assigned (${agent_phone})` : 'Field agent removed',
      { agent_phone: agent_phone || null }, req,
    );
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
    await logActivity(
      req.params.id, 'LOAN_TERMS_UPDATED', 'Loan terms updated',
      { loan_product, borrower_type, disbursement_date }, req,
    );
    res.json({ application });
  } catch (err) {
    console.error('PATCH /applications/:id/loan-terms error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// Edit core application details from the dashboard (task: top-right "Edit"
// button). extra_details is merged, not replaced, so untouched keys survive.
const EDITABLE_COLUMNS = ['full_name', 'national_id', 'employer_name', 'loan_amount', 'repayment_months', 'lms_loan_number', 'applicant_phone'];

router.patch('/applications/:id/details', async (req, res) => {
  try {
    const body = req.body || {};
    const updates = { updated_at: new Date().toISOString() };
    for (const col of EDITABLE_COLUMNS) {
      if (body[col] !== undefined) updates[col] = body[col];
    }
    if (updates.loan_amount !== undefined) updates.loan_amount = Number(updates.loan_amount);
    if (updates.repayment_months !== undefined) updates.repayment_months = Number(updates.repayment_months);

    // A changed WhatsApp number must exist in customers first (FK).
    if (updates.applicant_phone) {
      await supabase.from('customers').upsert(
        { phone_number: updates.applicant_phone, updated_at: new Date().toISOString() },
        { onConflict: 'phone_number' },
      );
    }

    const { data: current } = await supabase.from('applications').select('extra_details').eq('id', req.params.id).single();
    if (body.extra_details && typeof body.extra_details === 'object') {
      updates.extra_details = { ...(current?.extra_details || {}), ...body.extra_details };
    }

    // Retry-drop any column the DB doesn't have yet (e.g. lms_loan_number
    // before the migration is run) so the rest of the edit still lands.
    let application, error;
    for (let attempt = 0; attempt < 4; attempt++) {
      ({ data: application, error } = await supabase
        .from('applications').update(updates).eq('id', req.params.id).select().single());
      if (!error) break;
      const m = /column ['"]?(\w+)['"]? of 'applications'|Could not find the '(\w+)' column/.exec(error.message || '');
      const missing = m && (m[1] || m[2]);
      if (missing && missing in updates) { delete updates[missing]; continue; }
      break;
    }

    if (error || !application) return res.status(404).json({ error: error?.message || 'Not found' });

    const changed = Object.keys(updates).filter(k => k !== 'updated_at');
    await logActivity(req.params.id, 'DETAILS_EDITED', `Edited: ${changed.join(', ')}`, { fields: changed }, req);

    res.json({ application });
  } catch (err) {
    console.error('PATCH /applications/:id/details error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// Mark (or un-mark) an approved loan's field-agent commission as paid.
router.patch('/applications/:id/agent-commission', async (req, res) => {
  try {
    const paid = req.body.paid !== false;
    const { data: application, error } = await supabase
      .from('applications')
      .update({
        agent_commission_paid: paid,
        agent_commission_paid_at: paid ? new Date().toISOString() : null,
        updated_at: new Date().toISOString(),
      })
      .eq('id', req.params.id)
      .select()
      .single();
    if (error || !application) return res.status(404).json({ error: error?.message || 'Not found' });
    await logActivity(req.params.id, 'NOTE', paid ? 'Field agent commission marked paid' : 'Field agent commission marked unpaid', {}, req);
    res.json({ application });
  } catch (err) {
    console.error('PATCH /applications/:id/agent-commission error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

router.get('/applications/:id/activity', async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('application_activity')
      .select('*')
      .eq('application_id', req.params.id)
      .order('created_at', { ascending: false });
    if (error) throw error;
    res.json({ activity: data });
  } catch (err) {
    console.error('GET /applications/:id/activity error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

router.patch('/applications/:id/archive', async (req, res) => {
  try {
    const archived = req.body.archived !== false;
    const { data: application, error } = await supabase
      .from('applications')
      .update({ archived, updated_at: new Date().toISOString() })
      .eq('id', req.params.id)
      .select()
      .single();
    if (error || !application) return res.status(404).json({ error: 'Not found' });
    await logActivity(req.params.id, archived ? 'ARCHIVED' : 'UNARCHIVED', archived ? 'Archived' : 'Restored from archive', {}, req);
    res.json({ application });
  } catch (err) {
    console.error('PATCH /applications/:id/archive error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

router.delete('/applications/:id', async (req, res) => {
  try {
    const { id } = req.params;
    // Remove stored document files + rows, then activity, then the application.
    const docs = await documentStorage.listDocuments(id).catch(() => []);
    for (const d of docs) {
      await documentStorage.deleteDocument(d.id, d.storage_path).catch(err => console.error('[DELETE] doc cleanup:', err.message));
    }
    await supabase.from('application_activity').delete().eq('application_id', id);
    const { error } = await supabase.from('applications').delete().eq('id', id);
    if (error) throw error;
    res.json({ ok: true });
  } catch (err) {
    console.error('DELETE /applications/:id error:', err.message);
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

    await logActivity(req.params.id, 'INFO_REQUESTED', `More info requested — ${message.trim()}`, {}, req);

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
    res.setHeader('Content-Disposition', `attachment; filename="${pdfFileName(application)}"`);
    res.send(buffer);
  } catch (err) {
    console.error('GET /applications/:id/pdf error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

const CATEGORY_EXPORT_LABELS = {
  SSB: 'Civil Servants',
  GOVT_PENSIONER: 'Government Pensioners',
  SME: 'SME',
  PRIVATE_SECTOR: 'Private Sector',
};

/** "LOS-0103 Michelle Chinodya (Private Sector).pdf" — name + type + LOS no. */
function pdfFileName(application) {
  const ref = application.reference_number || 'application';
  const name = (application.full_name || '').replace(/[^\w .'-]/g, '').trim();
  const type = CATEGORY_EXPORT_LABELS[application.category] || application.category || '';
  return `${[ref, name].filter(Boolean).join(' ')}${type ? ` (${type})` : ''}.pdf`;
}

router.get('/applications/export/crystal', async (req, res) => {
  try {
    const { status } = req.query;
    let query = supabase.from('applications').select('*').order('created_at', { ascending: false });
    if (status) query = query.eq('status', status);

    const { data, error } = await query;
    if (error) throw error;

    const buffer = await crystalExport.buildCrystalExport((data || []).filter(a => !a.archived));
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="soledd_loans_export_${new Date().toISOString().slice(0, 10)}.xlsx"`);
    res.send(buffer);
  } catch (err) {
    console.error('GET /applications/export/crystal error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ─── LMS monthly repayment-postings export ─────────────────────────────────
// Produces the two-sheet workbook the client imports into their LMS ("Loan
// Performer"): Sheet1 is the postings batch (one row per approved loan, the
// amount to deduct this month, dated to month-end), Sheet2 is a name/amount/
// loan-number reconciliation list. Matches the client's
// "PEN <...> POSTINGS.xlsx" sample. See crystalExport.buildLmsPostingsExport
// for the column contract and the assumptions it documents.
router.get('/applications/export/lms-postings', async (req, res) => {
  try {
    // month=YYYY-MM (defaults to the current month)
    const monthParam = (req.query.month || '').match(/^(\d{4})-(\d{2})$/);
    const now = new Date();
    const year = monthParam ? Number(monthParam[1]) : now.getFullYear();
    const month0 = monthParam ? Number(monthParam[2]) - 1 : now.getMonth();

    const cfg = (await settingsService.getSetting('lms_postings_config')) || {};

    const { data: applications, error } = await supabase
      .from('applications')
      .select('*')
      .eq('status', 'APPROVED')
      .order('reference_number', { ascending: true });
    if (error) throw error;

    const rows = [];
    for (const app of (applications || []).filter(a => !a.archived)) {
      const computed = await loanCalculator.computeForApplication(app).catch(() => null);
      rows.push({ application: app, computed });
    }

    const buffer = await crystalExport.buildLmsPostingsExport(rows, { year, month0, config: cfg });
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    const stamp = `${year}-${String(month0 + 1).padStart(2, '0')}`;
    res.setHeader('Content-Disposition', `attachment; filename="soledd_lms_postings_${stamp}.xlsx"`);
    res.send(buffer);
  } catch (err) {
    console.error('GET /applications/export/lms-postings error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ─── Conversations ──────────────────────────────────────────────────────────
// conversation_states is one persistent row per WhatsApp number (flow/step
// null out on completion but the row stays, per flow.service.js's
// clearFlowState), so it doubles as a customer index with reliable
// last-activity timestamps — no separate "conversations list" table needed.

const ABANDONED_THRESHOLD_MS = 24 * 60 * 60 * 1000; // 24h with no reply, still mid-flow
const RECENT_MESSAGES_SCAN_LIMIT = 500; // enough to find each active phone's latest message without scanning the whole log

function deriveConversationStatus(state) {
  if (!state || !state.flow) return 'COMPLETED';
  if (state.step === 'DOCUMENT_UPLOAD') return 'AWAITING_DOCS';
  const lastActive = state.last_message_at ? new Date(state.last_message_at).getTime() : 0;
  if (Date.now() - lastActive > ABANDONED_THRESHOLD_MS) return 'ABANDONED';
  return 'IN_PROGRESS';
}

router.get('/conversations', async (req, res) => {
  try {
    const { data: states, error: stateErr } = await supabase
      .from('conversation_states')
      .select('*')
      .order('last_message_at', { ascending: false });
    if (stateErr) throw stateErr;

    const phones = states.map(s => s.customer_phone);
    const [{ data: customers }, { data: recentMessages }] = await Promise.all([
      phones.length ? supabase.from('customers').select('phone_number, name').in('phone_number', phones) : { data: [] },
      supabase.from('conversations').select('customer_phone, message_text, direction, timestamp').order('timestamp', { ascending: false }).limit(RECENT_MESSAGES_SCAN_LIMIT),
    ]);

    const nameByPhone = new Map((customers || []).map(c => [c.phone_number, c.name]));
    const lastMessageByPhone = new Map();
    for (const m of recentMessages || []) {
      if (!lastMessageByPhone.has(m.customer_phone)) lastMessageByPhone.set(m.customer_phone, m);
    }

    const conversations = states.map(s => {
      const last = lastMessageByPhone.get(s.customer_phone);
      return {
        phone: s.customer_phone,
        name: nameByPhone.get(s.customer_phone) || null,
        status: deriveConversationStatus(s),
        flow: s.flow,
        step: s.step,
        botPaused: s.bot_paused,
        lastMessageText: last?.message_text || null,
        lastMessageDirection: last?.direction || null,
        lastMessageAt: s.last_message_at,
      };
    });

    res.json({ conversations });
  } catch (err) {
    console.error('GET /conversations error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

router.get('/conversations/:phone/messages', async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('conversations')
      .select('*')
      .eq('customer_phone', req.params.phone)
      .order('timestamp', { ascending: true });
    if (error) throw error;

    const { data: customer } = await supabase.from('customers').select('*').eq('phone_number', req.params.phone).single();

    res.json({ messages: data, customer: customer || null });
  } catch (err) {
    console.error('GET /conversations/:phone/messages error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ─── LMS postings export config ─────────────────────────────────────────────

const LMS_POSTINGS_DEFAULTS = { glAccount: '127010', savProdId: 'S00', mode: 1, voucherPrefix: 'PEN USD' };

router.get('/settings/lms-postings', requireAdmin, async (req, res) => {
  try {
    const stored = await settingsService.getSetting('lms_postings_config');
    res.json({ ...LMS_POSTINGS_DEFAULTS, ...(stored || {}) });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.put('/settings/lms-postings', requireAdmin, async (req, res) => {
  try {
    const { glAccount, savProdId, mode, voucherPrefix } = req.body || {};
    await settingsService.setSetting('lms_postings_config', {
      glAccount: String(glAccount ?? LMS_POSTINGS_DEFAULTS.glAccount),
      savProdId: String(savProdId ?? LMS_POSTINGS_DEFAULTS.savProdId),
      mode: Number(mode ?? LMS_POSTINGS_DEFAULTS.mode),
      voucherPrefix: String(voucherPrefix ?? LMS_POSTINGS_DEFAULTS.voucherPrefix),
    });
    res.json({ ok: true });
  } catch (err) {
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
    const { agent, activationCode } = await agentService.resendOtp(req.params.id);
    const botNumber = await whatsappService.getBotNumber();
    res.json({
      agent,
      activationCode,
      activationMessage: agentService.activationMessage(agent.name, activationCode, botNumber),
      applicantPhone: agent.phone_number,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Documents an agent submitted with their "Become an Agent" application —
// these live on the agent_applications row, so they'd otherwise vanish from
// the UI once the application is approved. Matched by phone number.
router.get('/agents/:phone/documents', async (req, res) => {
  try {
    const { data: apps } = await supabase
      .from('agent_applications')
      .select('id')
      .eq('applicant_phone', req.params.phone)
      .order('created_at', { ascending: false });

    const docs = [];
    for (const app of apps || []) {
      const appDocs = await documentStorage.listAgentApplicationDocuments(app.id);
      for (const d of appDocs) {
        docs.push({ ...d, url: await documentStorage.getSignedUrl(d.storage_path) });
      }
    }
    res.json({ documents: docs });
  } catch (err) {
    console.error('GET /agents/:phone/documents error:', err.message);
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

    // On approval, hand the dashboard the activation code + a ready-to-send
    // WhatsApp message (sent from the officer's number) so it can open a
    // chat with the new agent. The message points them at the bot's number.
    const activationCode = application.activationCode || null;
    const botNumber = activationCode ? await whatsappService.getBotNumber() : null;
    res.json({
      application,
      activationCode,
      activationMessage: activationCode
        ? agentService.activationMessage(application.full_name, activationCode, botNumber)
        : null,
      applicantPhone: application.applicant_phone,
    });
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
