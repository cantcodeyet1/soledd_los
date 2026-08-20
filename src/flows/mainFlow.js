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

const applicationEngine = require('./applicationEngine');
const documentUploadEngine = require('./documentUploadEngine');

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
          { id: 'ACTION_SPEAK_AGENT',  title: 'Speak to an Agent', description: 'Talk to a Soledd representative' },
          { id: 'ACTION_BECOME_AGENT', title: 'Become an Agent',   description: 'Apply to become a Soledd agent' },
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

  // ── DOCUMENT_UPLOAD — delegates to the document collection engine ────────
  if (step === 'DOCUMENT_UPLOAD') {
    return documentUploadEngine.handleUpload({ text, buttonId, media, flowData });
  }

  // ── AGENT_NAME_CAPTURE ───────────────────────────────────────────────────
  if (step === 'AGENT_NAME_CAPTURE') {
    const fullName = (text || '').trim();
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

module.exports = { ENTRY_STEP, handleStep, CATEGORIES };
