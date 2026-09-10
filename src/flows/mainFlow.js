/**
 * mainFlow.js — main menu + New Application + agent flows (deterministic, no AI).
 *
 * WELCOME → MAIN_MENU (native WhatsApp list, 6 options)
 *   ├─ loan category → APPLICATION_CAPTURE (full paper-form field sequence, see applicationEngine.js)
 *   ├─ Speak to an Agent → agent contact card (terminal)
 *   └─ Become an Agent → AGENT_NAME_CAPTURE → AGENT_ID_CAPTURE → AGENT_AREA_CAPTURE → submit
 *
 * Every step accepts a "🔙 Main Menu" button tap (id RETURN_MENU) that jumps
 * straight back to WELCOME, regardless of where the customer is.
 */

'use strict';

const { supabase } = require('../models/supabase');
const applicationEngine = require('./applicationEngine');
const documentUploadEngine = require('./documentUploadEngine');
const { normaliseName } = require('../utils/normalise');

const ENTRY_STEP = 'WELCOME';

const RETURN_BUTTON = { id: 'RETURN_MENU', title: '🔙 Main Menu' };

const AGENT_NAME = 'Michelle';
const AGENT_PHONE = '263789896434';

const CATEGORIES = [
  { code: 'SSB',            label: 'Civil Servants',              listId: 'CAT_SSB' },
  { code: 'GOVT_PENSIONER',  label: 'Government Pensioners',       listId: 'CAT_PENSIONER' },
  { code: 'SME',             label: 'Small to Medium Enterprises', listId: 'CAT_SME' },
  { code: 'PRIVATE_SECTOR',  label: 'Private Sector Employees',    listId: 'CAT_PRIVATE' },
];

// ─── Menu builders ────────────────────────────────────────────────────────

function mainMenuMessage() {
  return {
    type: 'list',
    body: 'Hello, welcome to Soledd Loans. Tap below to choose an option 👇',
    buttonLabel: 'View Options',
    sections: [
      {
        title: 'Loan Categories',
        rows: CATEGORIES.map(c => ({ id: c.listId, title: c.label, description: '' })),
      },
      {
        title: 'Other',
        rows: [
          { id: 'ACTION_CHECK_LOAN',   title: 'Check on a loan',       description: 'See the status of an application you submitted' },
          { id: 'ACTION_SUBMIT_DOCS',  title: 'Submit loan documents', description: 'Send docs for an application you already started' },
          { id: 'ACTION_SPEAK_AGENT',  title: 'Speak to an Agent',     description: 'Talk to a Soledd representative' },
          { id: 'ACTION_BECOME_AGENT', title: 'Become an Agent',       description: 'Apply to become a Soledd agent' },
        ],
      },
    ],
  };
}

function questionWithReturn(bodyText) {
  return { type: 'interactive', body: bodyText, buttons: [RETURN_BUTTON] };
}

function finalWithReturn(bodyText) {
  return { type: 'interactive', body: bodyText, buttons: [RETURN_BUTTON] };
}

// ─── Parsing helpers ──────────────────────────────────────────────────────

/**
 * "Submit loan documents" — resume the document phase for the applicant's
 * most recent application that hasn't had documents sent yet. Requires them
 * to have already completed the questions for an application.
 */
async function startDocumentResume(phone) {
  const { data: apps } = await supabase
    .from('applications')
    .select('id, reference_number, category, created_at')
    .eq('applicant_phone', phone)
    .order('created_at', { ascending: false })
    .limit(5);

  let target = null;
  for (const a of apps || []) {
    const { count } = await supabase
      .from('documents')
      .select('id', { count: 'exact', head: true })
      .eq('application_id', a.id);
    if (!count) { target = a; break; }
  }

  if (!target) {
    return {
      messages: [finalWithReturn(
        (apps && apps.length)
          ? "We've already received documents for your applications. If you need to send more, please contact our office."
          : "I can't find an application from you that's waiting for documents. Start an application from the menu first, then come back here to send your documents."
      )],
      endFlow: true,
    };
  }

  const docStart = documentUploadEngine.start(target.category);
  return {
    messages: [
      { type: 'text', body: `Let's finish the documents for ${target.reference_number}.` },
      ...docStart.messages,
    ],
    nextStep: docStart.nextStep,
    updatedData: {
      ...(docStart.updatedData || {}),
      applicationId: target.id,
      referenceNumber: target.reference_number,
      categoryCode: target.category,
    },
  };
}

const STATUS_WORDS = {
  APPROVED: 'Approved. A credit officer will be in touch about disbursement.',
  REJECTED: 'Not approved this time. You are welcome to reapply in future.',
};

/** "Check on a loan" — status of an application submitted from this number. */
async function lookupLoanStatus(phone, text) {
  const raw = (text || '').trim();
  const m = raw.match(/LOS[-\s]?0*\d+/i);
  const ref = m ? m[0].toUpperCase().replace(/\s+/g, '-').replace('LOS0', 'LOS-0') : raw;

  const { data: app } = await supabase
    .from('applications')
    .select('id, reference_number, status, full_name, loan_amount')
    .eq('applicant_phone', phone)
    .ilike('reference_number', ref)
    .maybeSingle();

  if (!app) {
    return {
      messages: [questionWithReturn(
        `I couldn't find ${ref || 'that reference'} under your number. Please check it and reply again, or tap Main Menu.`
      )],
      nextStep: 'LOAN_STATUS_LOOKUP',
      updatedData: {},
    };
  }

  let line = STATUS_WORDS[app.status];
  if (!line) {
    const { count } = await supabase
      .from('documents')
      .select('id', { count: 'exact', head: true })
      .eq('application_id', app.id);
    line = count ? 'Under review by a credit officer.' : 'Waiting for your documents. Choose *Submit loan documents* from the menu to send them.';
  }

  return {
    messages: [finalWithReturn(
      `*${app.reference_number}* for $${Number(app.loan_amount).toFixed(2)}\nStatus: ${line}`
    )],
    endFlow: true,
  };
}

function matchCategoryByKeyword(text) {
  const t = (text || '').toLowerCase();
  if (t.includes('civil') || t.includes('ssb')) return CATEGORIES.find(c => c.code === 'SSB');
  if (t.includes('pension')) return CATEGORIES.find(c => c.code === 'GOVT_PENSIONER');
  if (t.includes('sme') || t.includes('enterprise') || t.includes('entrepreneur') || t.includes('business')) return CATEGORIES.find(c => c.code === 'SME');
  if (t.includes('private')) return CATEGORIES.find(c => c.code === 'PRIVATE_SECTOR');
  return null;
}

// ─── Main step handler ────────────────────────────────────────────────────

async function handleStep(step, { text, buttonId, media, flowData, customer }) {

  // Global: tapping "Main Menu" from anywhere jumps straight back to WELCOME.
  if (buttonId === RETURN_BUTTON.id) {
    return handleStep('WELCOME', { text, buttonId: null, flowData: {}, customer });
  }

  // ── WELCOME ──────────────────────────────────────────────────────────────
  if (step === 'WELCOME') {
    return {
      messages: [mainMenuMessage()],
      nextStep: 'MAIN_MENU',
      updatedData: {},
    };
  }

  // ── MAIN_MENU ────────────────────────────────────────────────────────────
  if (step === 'MAIN_MENU') {
    const category = CATEGORIES.find(c => c.listId === buttonId) || matchCategoryByKeyword(text);

    if (category) {
      const started = applicationEngine.startApplication(category.code);
      return {
        ...started,
        updatedData: { categoryCode: category.code, categoryLabel: category.label, ...started.updatedData },
      };
    }

    if (buttonId === 'ACTION_SPEAK_AGENT' || (/\bagent\b/i.test(text || '') && /speak|talk|human/i.test(text || ''))) {
      return {
        messages: [finalWithReturn(
          `You can reach our representative *${AGENT_NAME}* directly on WhatsApp: wa.me/${AGENT_PHONE}`
        )],
        endFlow: true,
      };
    }

    if (buttonId === 'ACTION_BECOME_AGENT' || /become.*agent|join.*agent/i.test(text || '')) {
      return {
        messages: [questionWithReturn('Great! What is your full name?')],
        nextStep: 'AGENT_NAME_CAPTURE',
        updatedData: {},
      };
    }

    if (buttonId === 'ACTION_SUBMIT_DOCS' || /submit.*doc|upload.*doc|send.*doc/i.test(text || '')) {
      return startDocumentResume(customer.phone_number);
    }

    if (buttonId === 'ACTION_CHECK_LOAN' || /check.*loan|loan.*status|my.*application/i.test(text || '')) {
      return {
        messages: [questionWithReturn('Reply with your loan reference number (for example LOS-0142).')],
        nextStep: 'LOAN_STATUS_LOOKUP',
        updatedData: {},
      };
    }

    return {
      messages: [{ ...mainMenuMessage(), body: `Sorry, I didn't catch that.\n\n${mainMenuMessage().body}` }],
      nextStep: 'MAIN_MENU',
      updatedData: {},
    };
  }

  // ── APPLICATION_CAPTURE — delegates to the generic question engine ───────
  if (step === 'APPLICATION_CAPTURE') {
    return applicationEngine.continueApplication({ text, buttonId, flowData, customerPhone: customer.phone_number });
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

  // ── LOAN_STATUS_LOOKUP — customer checking on their own application ──────
  if (step === 'LOAN_STATUS_LOOKUP') {
    return lookupLoanStatus(customer.phone_number, text);
  }

  // ── DOCUMENT_UPLOAD_INTRO / DOCUMENT_UPLOAD — document collection engine ─
  if (step === 'DOCUMENT_UPLOAD_INTRO') {
    return documentUploadEngine.handleIntro({ text, buttonId, flowData });
  }
  if (step === 'DOCUMENT_UPLOAD') {
    return documentUploadEngine.handleUpload({ text, buttonId, media, flowData });
  }

  // ── AGENT_NAME_CAPTURE ───────────────────────────────────────────────────
  if (step === 'AGENT_NAME_CAPTURE') {
    const fullName = normaliseName((text || '').trim());
    if (fullName.length < 2) {
      return {
        messages: [questionWithReturn('Please enter your full name.')],
        nextStep: 'AGENT_NAME_CAPTURE',
        updatedData: {},
      };
    }

    return {
      messages: [questionWithReturn(`Thanks, ${fullName.split(' ')[0]}. What is your National ID number?`)],
      nextStep: 'AGENT_ID_CAPTURE',
      updatedData: { fullName },
    };
  }

  // ── AGENT_ID_CAPTURE ─────────────────────────────────────────────────────
  if (step === 'AGENT_ID_CAPTURE') {
    const nationalId = (text || '').trim();
    if (nationalId.length < 5) {
      return {
        messages: [questionWithReturn('Please enter a valid National ID number (e.g. 63-114872-A63).')],
        nextStep: 'AGENT_ID_CAPTURE',
        updatedData: {},
      };
    }

    return {
      messages: [questionWithReturn('Which area/town do you operate in?')],
      nextStep: 'AGENT_AREA_CAPTURE',
      updatedData: { nationalId },
    };
  }

  // ── AGENT_AREA_CAPTURE ───────────────────────────────────────────────────
  if (step === 'AGENT_AREA_CAPTURE') {
    const area = (text || '').trim();
    if (area.length < 2) {
      return {
        messages: [questionWithReturn('Which area/town do you operate in?')],
        nextStep: 'AGENT_AREA_CAPTURE',
        updatedData: {},
      };
    }

    const merged = { ...flowData, area };
    const docStart = documentUploadEngine.start('AGENT_APPLICATION');

    return {
      messages: docStart.messages,
      nextStep: docStart.nextStep,
      endFlow: docStart.endFlow || false,
      updatedData: { ...(docStart.updatedData || {}) },
      agentApplicationData: merged,
    };
  }

  // ── Unknown step fallback ────────────────────────────────────────────────
  console.warn(`[MAIN_FLOW] Unknown step "${step}" — restarting`);
  return handleStep('WELCOME', { text, buttonId: null, flowData: {}, customer });
}

module.exports = { ENTRY_STEP, handleStep, CATEGORIES, mainMenuMessage };
