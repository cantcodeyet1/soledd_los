/**
 * agentFlow.js — the WhatsApp menu shown to verified, active field agents
 * instead of the customer menu (see webhook.controller.js / flow.service.js
 * for how a sender is routed here).
 *
 * AGENT_WELCOME → Check on a loan (list recent clients / lookup by reference)
 *              → Start new loan for a client (same question engine as the
 *                customer flow, but the resulting application is tagged
 *                with this agent's phone number)
 */

'use strict';

const { supabase } = require('../models/supabase');
const applicationEngine = require('./applicationEngine');
const documentUploadEngine = require('./documentUploadEngine');

const ENTRY_STEP = 'AGENT_WELCOME';

const AGENT_MENU_BUTTON = { id: 'AGENT_MENU', title: '🔙 Agent Menu' };

const CATEGORIES = [
  { code: 'SSB',            label: 'Civil Servants',              listId: 'CAT_SSB' },
  { code: 'GOVT_PENSIONER',  label: 'Government Pensioners',       listId: 'CAT_PENSIONER' },
  { code: 'SME',             label: 'Small to Medium Enterprises', listId: 'CAT_SME' },
  { code: 'PRIVATE_SECTOR',  label: 'Private Sector Employees',    listId: 'CAT_PRIVATE' },
];

function welcomeMessage() {
  return {
    type: 'interactive',
    body: "Welcome back! What would you like to do?",
    buttons: [
      { id: 'AGENT_CHECK_LOAN', title: 'Check on a loan' },
      { id: 'AGENT_NEW_LOAN', title: 'Start new loan' },
    ],
  };
}

function categoryMenuMessage() {
  return {
    type: 'list',
    body: 'Which loan category is this client applying for?',
    buttonLabel: 'View Options',
    sections: [{
      title: 'Loan Categories',
      rows: [
        ...CATEGORIES.map(c => ({ id: c.listId, title: c.label, description: '' })),
        { id: AGENT_MENU_BUTTON.id, title: AGENT_MENU_BUTTON.title },
      ],
    }],
  };
}

async function recentApplicationsFor(agentPhone) {
  const { data } = await supabase
    .from('applications')
    .select('id, reference_number, full_name, status, loan_amount, category')
    .eq('agent_phone', agentPhone)
    .order('created_at', { ascending: false })
    .limit(9);
  return data || [];
}

function loanListMessage(applications) {
  if (applications.length === 0) {
    return {
      type: 'interactive',
      body: "You don't have any client applications yet. You can also type a reference number (e.g. LOS-0142) to look one up.",
      buttons: [AGENT_MENU_BUTTON],
    };
  }

  return {
    type: 'list',
    body: 'Your recent client applications. Tap one for details, or type a reference number to search.',
    buttonLabel: 'View Loans',
    sections: [{
      title: 'Applications',
      rows: [
        ...applications.map(a => ({
          id: `APP_${a.id}`,
          title: a.reference_number,
          description: `${a.full_name} (${a.status})`,
        })),
        { id: AGENT_MENU_BUTTON.id, title: AGENT_MENU_BUTTON.title },
      ],
    }],
  };
}

function formatLoanDetail(a) {
  return `*${a.reference_number}*\nClient: ${a.full_name}\nCategory: ${a.category}\nAmount: $${Number(a.loan_amount).toFixed(2)}\nStatus: ${a.status}`;
}

async function handleStep(step, { text, buttonId, media, flowData, customer }) {

  // The shared application/document engines emit a "🔙 Main Menu" button
  // with id RETURN_MENU; in the agent flow that means "back to the agent menu".
  if (buttonId === AGENT_MENU_BUTTON.id || buttonId === 'RETURN_MENU') {
    return handleStep('AGENT_WELCOME', { text, buttonId: null, flowData: {}, customer });
  }

  // ── AGENT_WELCOME ────────────────────────────────────────────────────────
  if (step === 'AGENT_WELCOME') {
    return {
      messages: [welcomeMessage()],
      nextStep: 'AGENT_MENU_SELECT',
      updatedData: {},
    };
  }

  // ── AGENT_MENU_SELECT ────────────────────────────────────────────────────
  if (step === 'AGENT_MENU_SELECT') {
    if (buttonId === 'AGENT_CHECK_LOAN') {
      const apps = await recentApplicationsFor(customer.phone_number);
      return {
        messages: [loanListMessage(apps)],
        nextStep: 'AGENT_LOAN_LOOKUP',
        updatedData: {},
      };
    }

    if (buttonId === 'AGENT_NEW_LOAN') {
      return {
        messages: [categoryMenuMessage()],
        nextStep: 'AGENT_CATEGORY_SELECT',
        updatedData: {},
      };
    }

    return {
      messages: [welcomeMessage()],
      nextStep: 'AGENT_MENU_SELECT',
      updatedData: {},
    };
  }

  // ── AGENT_LOAN_LOOKUP ────────────────────────────────────────────────────
  if (step === 'AGENT_LOAN_LOOKUP') {
    if (buttonId && buttonId.startsWith('APP_')) {
      const id = buttonId.slice('APP_'.length);
      const { data } = await supabase.from('applications').select('*').eq('id', id).single();
      if (data) {
        return {
          messages: [{ type: 'interactive', body: formatLoanDetail(data), buttons: [AGENT_MENU_BUTTON] }],
          nextStep: 'AGENT_LOAN_LOOKUP',
          updatedData: {},
        };
      }
    }

    const ref = (text || '').trim();
    if (ref) {
      const { data } = await supabase
        .from('applications')
        .select('*')
        .eq('agent_phone', customer.phone_number)
        .ilike('reference_number', ref)
        .maybeSingle();

      if (data) {
        return {
          messages: [{ type: 'interactive', body: formatLoanDetail(data), buttons: [AGENT_MENU_BUTTON] }],
          nextStep: 'AGENT_LOAN_LOOKUP',
          updatedData: {},
        };
      }
    }

    const apps = await recentApplicationsFor(customer.phone_number);
    return {
      messages: [{ ...loanListMessage(apps), body: `Couldn't find that reference.\n\n${loanListMessage(apps).body}` }],
      nextStep: 'AGENT_LOAN_LOOKUP',
      updatedData: {},
    };
  }

  // ── AGENT_CATEGORY_SELECT ────────────────────────────────────────────────
  if (step === 'AGENT_CATEGORY_SELECT') {
    const category = CATEGORIES.find(c => c.listId === buttonId);
    if (category) {
      const started = applicationEngine.startApplication(category.code, customer.phone_number);
      return {
        ...started,
        updatedData: { categoryCode: category.code, categoryLabel: category.label, ...started.updatedData },
      };
    }

    return {
      messages: [{ ...categoryMenuMessage(), body: `Sorry, I didn't catch that.\n\n${categoryMenuMessage().body}` }],
      nextStep: 'AGENT_CATEGORY_SELECT',
      updatedData: {},
    };
  }

  // ── APPLICATION_CAPTURE — same generic engine the customer flow uses ─────
  // customerPhone is deliberately omitted: it would be the agent's own
  // number here, not the client's, so repeat-client matching falls back to
  // National ID only (see applicationEngine.findPriorApplication).
  if (step === 'APPLICATION_CAPTURE') {
    return applicationEngine.continueApplication({ text, buttonId, flowData });
  }

  // ── APPLICATION_EDIT_SELECT / APPLICATION_EDIT_CAPTURE — fixing a previous answer
  if (step === 'APPLICATION_EDIT_SELECT') {
    return applicationEngine.handleEditSelect({ text, flowData });
  }
  if (step === 'APPLICATION_EDIT_CAPTURE') {
    return applicationEngine.handleEditCapture({ text, buttonId, flowData });
  }

  // ── APPLICATION_REPEAT_CONFIRM — reuse details from a prior application? ──
  if (step === 'APPLICATION_REPEAT_CONFIRM') {
    return applicationEngine.handleRepeatConfirm({ text, buttonId, flowData });
  }

  // ── DOCUMENT_UPLOAD_INTRO / DOCUMENT_UPLOAD — shared document engine ─────
  if (step === 'DOCUMENT_UPLOAD_INTRO') {
    return documentUploadEngine.handleIntro({ text, buttonId, flowData });
  }
  if (step === 'DOCUMENT_UPLOAD') {
    return documentUploadEngine.handleUpload({ text, buttonId, media, flowData });
  }

  console.warn(`[AGENT_FLOW] Unknown step "${step}" — restarting`);
  return handleStep('AGENT_WELCOME', { text, buttonId: null, flowData: {}, customer });
}

module.exports = { ENTRY_STEP, handleStep };
