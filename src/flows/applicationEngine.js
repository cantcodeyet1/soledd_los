/**
 * applicationEngine.js — generic sequential question runner shared by all
 * four loan categories. The per-category field lists live in
 * applicationQuestions.js; this file just walks them, validates answers,
 * handles skip conditions, and builds the final application payload.
 */

'use strict';

const { supabase } = require('../models/supabase');
const { questionsForCategory } = require('./applicationQuestions');
const { verificationPromiseText } = require('../utils/businessHours');
const documentUploadEngine = require('./documentUploadEngine');
const { REQUIRED_DOCUMENTS } = require('./requiredDocuments');

const RETURN_BUTTON = { id: 'RETURN_MENU', title: '🔙 Main Menu' };
const EDIT_BUTTON = { id: 'EDIT_ANSWER', title: '✏️ Edit answer' };

// Tapped "Edit answer", or typed one of the edit commands.
function isEditRequest(text, buttonId) {
  return buttonId === EDIT_BUTTON.id || (!buttonId && EDIT_COMMAND.test((text || '').trim()));
}

// Durable fields worth offering to reuse from a repeat client's last
// application — deliberately excludes per-application specifics like loan
// amount, purpose, or repayment period, which should always be asked fresh.
const REUSABLE_FIELDS = {
  SSB:              ['contactLine', 'nextOfKin', 'employerName', 'bankDetails'],
  GOVT_PENSIONER:   ['contactLine', 'nextOfKin', 'bankDetails'],
  SME:               ['address', 'nextOfKin', 'bankDetails'],
  PRIVATE_SECTOR:   ['personalDetails', 'nextOfKin', 'bankersDetails'],
};

function parseAmount(text) {
  const cleaned = (text || '').replace(/[^0-9.]/g, '');
  if (!cleaned) return null;
  const n = parseFloat(cleaned);
  if (!Number.isFinite(n) || n <= 0) return null;
  return n;
}

function nextQuestionIndex(questions, answers, fromIndex) {
  let i = fromIndex;
  while (i < questions.length) {
    const q = questions[i];
    const alreadyAnswered = Object.prototype.hasOwnProperty.call(answers, q.field);
    if (!alreadyAnswered && (!q.skipIf || !q.skipIf(answers))) return i;
    i++;
  }
  return -1;
}

/** "(3/16) " — position of question `idx` among the questions that actually
 *  apply given the answers so far (skipped ones don't count). */
function progressLabel(questions, answers, idx) {
  const active = questions.filter(q => !q.skipIf || !q.skipIf(answers || {}));
  const pos = active.indexOf(questions[idx]) + 1;
  if (pos < 1 || active.length === 0) return '';
  return `(${pos}/${active.length}) `;
}

/**
 * Looks up the applicant's most recent prior application, if any. When a
 * field agent is applying on the client's behalf, customerPhone is the
 * agent's own number (not the client's) — match on National ID only in
 * that case, so we never pull a different client's details.
 */
async function findPriorApplication(customerPhone, nationalId) {
  let query = supabase.from('applications').select('extra_details').order('created_at', { ascending: false }).limit(1);
  query = customerPhone
    ? query.or(`applicant_phone.eq.${customerPhone},national_id.eq.${nationalId}`)
    : query.eq('national_id', nationalId);

  const { data } = await query.maybeSingle();
  return data || null;
}

/**
 * canEdit — once the applicant has answered at least one question, every
 * prompt carries a way back to a previous answer and to the main menu.
 * yesno keeps Yes/No/Menu (WhatsApp allows only 3 reply buttons, no room
 * for Edit); list-type questions add both as extra rows; free-text/amount
 * questions get Edit + Menu buttons.
 */
function buildQuestionMessage(q, canEdit = false, progress = '') {
  const body = `${progress}${q.prompt}`;
  if (q.type === 'yesno') {
    return {
      type: 'interactive',
      body,
      buttons: [{ id: 'YES', title: 'Yes' }, { id: 'NO', title: 'No' }, RETURN_BUTTON],
    };
  }

  if (q.type === 'choice') {
    return {
      type: 'list',
      body,
      buttonLabel: 'Choose',
      sections: [{
        title: 'Options',
        rows: [
          ...q.options.map((o, i) => ({ id: `OPT_${i}`, title: o })),
          ...(canEdit ? [{ id: EDIT_BUTTON.id, title: EDIT_BUTTON.title }] : []),
          { id: RETURN_BUTTON.id, title: RETURN_BUTTON.title },
        ],
      }],
    };
  }

  if (q.type === 'period') {
    return {
      type: 'list',
      body,
      buttonLabel: 'Choose Period',
      sections: [{
        title: 'Repayment Period',
        rows: [
          ...q.options.map(p => ({ id: `PERIOD_${p.months}`, title: p.label })),
          ...(canEdit ? [{ id: EDIT_BUTTON.id, title: EDIT_BUTTON.title }] : []),
          { id: RETURN_BUTTON.id, title: RETURN_BUTTON.title },
        ],
      }],
    };
  }

  // text / amount
  return {
    type: 'interactive',
    body,
    buttons: canEdit ? [EDIT_BUTTON, RETURN_BUTTON] : [RETURN_BUTTON],
  };
}

const EDIT_COMMAND = /^(back|edit|edit previous)$/i;

function displayValue(q, value) {
  if (q.type === 'period') return `${value} months`;
  return String(value);
}

/** Numbered text summary of every question answered so far, plus an
 *  interactive prompt that always carries a "Main Menu" button. */
function editListMessages(questions, answers) {
  const answeredFields = Object.keys(answers);
  const lines = answeredFields.map((field, i) => {
    const q = questions.find(qq => qq.field === field);
    if (!q) return null;
    return `${i + 1}. ${q.prompt}\n   → ${displayValue(q, answers[field])}`;
  }).filter(Boolean);

  return [
    { type: 'text', body: `Your answers so far:\n\n${lines.join('\n\n')}` },
    {
      type: 'interactive',
      body: 'Reply with the number of the answer you want to fix, or CANCEL to carry on.',
      buttons: [RETURN_BUTTON],
    },
  ];
}

/** Returns the parsed value, or null if the answer is invalid for this question type. */
function parseAnswer(q, text, buttonId) {
  if (q.type === 'yesno') {
    if (buttonId === 'YES') return 'YES';
    if (buttonId === 'NO') return 'NO';
    const t = (text || '').trim().toLowerCase();
    if (/^y(es)?$/.test(t)) return 'YES';
    if (/^n(o)?$/.test(t)) return 'NO';
    return null;
  }

  if (q.type === 'choice') {
    if (buttonId && buttonId.startsWith('OPT_')) {
      const idx = parseInt(buttonId.slice('OPT_'.length), 10);
      return q.options[idx] || null;
    }
    const t = (text || '').toLowerCase();
    return q.options.find(o => t.includes(o.toLowerCase())) || null;
  }

  if (q.type === 'period') {
    if (buttonId && buttonId.startsWith('PERIOD_')) {
      const months = parseInt(buttonId.slice('PERIOD_'.length), 10);
      return q.options.some(p => p.months === months) ? months : null;
    }
    const t = text || '';
    const match = q.options.find(p => t.includes(String(p.months)));
    return match ? match.months : null;
  }

  if (q.type === 'amount') {
    return parseAmount(text);
  }

  const t = (text || '').trim();
  return t.length >= 1 ? t : null;
}

function buildApplicationData(categoryCode, answers) {
  // SME asks title+first name (nameLine) separately from surname/company name,
  // since the latter also doubles as employer_name. Other categories combine
  // title+first+surname into one nameLine question.
  const fullName = categoryCode === 'SME'
    ? `${answers.nameLine || ''} ${answers.surname || ''}`.trim() || 'Applicant'
    : (answers.nameLine || 'Applicant');

  let employerName = null;
  if (categoryCode === 'SME') {
    employerName = answers.surname || null; // form combines surname/registered company name
  } else if (answers.employerName) {
    employerName = answers.employerName;
  }

  return {
    categoryCode,
    fullName,
    nationalId: answers.nationalId,
    employerName,
    loanAmount: answers.loanAmount,
    repaymentMonths: answers.repaymentMonths,
    extraDetails: answers,
  };
}

/**
 * Begins the question sequence for a category — call when a category is
 * first selected. Pass agentPhone when a field agent is applying on behalf
 * of a client, so the resulting application is attributed to them.
 */
function startApplication(categoryCode, agentPhone = null) {
  const questions = questionsForCategory(categoryCode);
  const answers = {};
  const idx = nextQuestionIndex(questions, answers, 0);
  const q = questions[idx];

  return {
    messages: [buildQuestionMessage(q, false, progressLabel(questions, answers, idx))],
    nextStep: 'APPLICATION_CAPTURE',
    updatedData: { qIndex: idx, answers, agentPhone },
  };
}

/** Handles one answer within an in-progress application, or submits once complete. */
async function continueApplication({ text, buttonId, flowData, customerPhone }) {
  const questions = questionsForCategory(flowData.categoryCode);
  const q = questions[flowData.qIndex];

  const hasPrior = Object.keys(flowData.answers || {}).length > 0;

  // "Edit answer" button / "EDIT"/"BACK" text jumps into the
  // edit-a-previous-answer sub-flow, remembering which question to resume.
  if (isEditRequest(text, buttonId) && hasPrior) {
    return {
      messages: editListMessages(questions, flowData.answers),
      nextStep: 'APPLICATION_EDIT_SELECT',
      updatedData: { editReturnIndex: flowData.qIndex },
    };
  }

  const value = parseAnswer(q, text, buttonId);

  if (value === null) {
    const prog = progressLabel(questions, flowData.answers, flowData.qIndex);
    return {
      messages: [{ ...buildQuestionMessage(q, hasPrior), body: `${prog}Sorry, I didn't catch that.\n\n${q.prompt}` }],
      nextStep: 'APPLICATION_CAPTURE',
      updatedData: {},
    };
  }

  const answers = { ...flowData.answers, [q.field]: value };

  // Right after National ID: check for a repeat client and offer to reuse
  // their durable details (address, next of kin, bank details, etc.).
  if (q.field === 'nationalId') {
    const prior = await findPriorApplication(customerPhone || null, value);
    const reusableFields = REUSABLE_FIELDS[flowData.categoryCode] || [];
    const reuse = {};
    if (prior?.extra_details) {
      for (const field of reusableFields) {
        if (prior.extra_details[field] !== undefined) reuse[field] = prior.extra_details[field];
      }
    }

    if (Object.keys(reuse).length > 0) {
      const pendingNextIndex = flowData.qIndex + 1;
      const summary = Object.entries(reuse).map(([field, val]) => {
        const rq = questions.find(qq => qq.field === field);
        return `• ${rq.prompt}\n  → ${displayValue(rq, val)}`;
      }).join('\n');

      return {
        messages: [{
          type: 'interactive',
          body: `Welcome back! We found your details on file:\n\n${summary}\n\nReuse these for this application?`,
          buttons: [{ id: 'REUSE_YES', title: 'Yes, reuse' }, { id: 'REUSE_NO', title: 'No, re-enter' }, RETURN_BUTTON],
        }],
        nextStep: 'APPLICATION_REPEAT_CONFIRM',
        updatedData: { answers, pendingReuse: reuse, pendingNextIndex },
      };
    }
  }

  const nextIdx = nextQuestionIndex(questions, answers, flowData.qIndex + 1);

  if (nextIdx === -1) {
    return buildCompletionResult(flowData, answers);
  }

  const nextQ = questions[nextIdx];
  return {
    messages: [buildQuestionMessage(nextQ, true, progressLabel(questions, answers, nextIdx))],
    nextStep: 'APPLICATION_CAPTURE',
    updatedData: { answers, qIndex: nextIdx },
  };
}

/** Application/agent data + document-upload handoff once all questions are answered. */
function buildCompletionResult(flowData, answers) {
  const docStart = documentUploadEngine.start(flowData.categoryCode);
  const docs = REQUIRED_DOCUMENTS[flowData.categoryCode] || [];
  const checklist = docs.length ? `\n\n${docs.map(d => `* ${d}`).join('\n')}` : '';

  // One consolidated message: reference, credit-officer note, and the full
  // list of documents to send back. flow.service then sends the PDFs, then
  // the document-collection prompts start.
  const summary = `Got it. Your reference number is {{REFERENCE}}.\n\n`
    + `${verificationPromiseText()}\n\n`
    + `I'm about to send you your loan forms. Please print and sign them, then send the signed copies back here as photos or files, along with:${checklist}`;

  return {
    messages: [
      { type: 'text', body: summary },
      ...docStart.messages,
    ],
    nextStep: docStart.nextStep,
    endFlow: docStart.endFlow || false,
    updatedData: { ...(docStart.updatedData || {}) },
    applicationData: { ...buildApplicationData(flowData.categoryCode, answers), agentPhone: flowData.agentPhone || null },
  };
}

/** Step: user is responding YES/NO to reusing their details from a prior application. */
function handleRepeatConfirm({ buttonId, text, flowData }) {
  const questions = questionsForCategory(flowData.categoryCode);
  const t = (text || '').trim().toLowerCase();
  const wantsReuse = buttonId === 'REUSE_YES' || (!buttonId && /^y(es)?$/.test(t));
  const declines = buttonId === 'REUSE_NO' || (!buttonId && /^n(o)?$/.test(t));

  if (!wantsReuse && !declines) {
    return {
      messages: [{
        type: 'interactive',
        body: "Sorry, I didn't catch that. Reuse your details on file for this application?",
        buttons: [{ id: 'REUSE_YES', title: 'Yes, reuse' }, { id: 'REUSE_NO', title: 'No, re-enter' }, RETURN_BUTTON],
      }],
      nextStep: 'APPLICATION_REPEAT_CONFIRM',
      updatedData: {},
    };
  }

  const answers = wantsReuse ? { ...flowData.answers, ...flowData.pendingReuse } : { ...flowData.answers };
  const nextIdx = nextQuestionIndex(questions, answers, flowData.pendingNextIndex);

  if (nextIdx === -1) {
    return buildCompletionResult(flowData, answers);
  }

  const nextQ = questions[nextIdx];
  return {
    messages: [buildQuestionMessage(nextQ, true, progressLabel(questions, answers, nextIdx))],
    nextStep: 'APPLICATION_CAPTURE',
    updatedData: { answers, qIndex: nextIdx },
  };
}

/** Step: user is picking which previously-answered question to redo. */
function handleEditSelect({ text, flowData }) {
  const questions = questionsForCategory(flowData.categoryCode);
  const answeredFields = Object.keys(flowData.answers || {});
  const t = (text || '').trim();

  if (/^cancel$/i.test(t)) {
    const resumeQ = questions[flowData.editReturnIndex];
    return {
      messages: [buildQuestionMessage(resumeQ, true, progressLabel(questions, flowData.answers, flowData.editReturnIndex))],
      nextStep: 'APPLICATION_CAPTURE',
      updatedData: { qIndex: flowData.editReturnIndex },
    };
  }

  const choice = parseInt(t, 10);
  if (!Number.isInteger(choice) || choice < 1 || choice > answeredFields.length) {
    return {
      messages: editListMessages(questions, flowData.answers),
      nextStep: 'APPLICATION_EDIT_SELECT',
      updatedData: {},
    };
  }

  const field = answeredFields[choice - 1];
  const editQ = questions.find(qq => qq.field === field);
  return {
    messages: [{ ...buildQuestionMessage(editQ), body: `Editing:\n\n${buildQuestionMessage(editQ).body}` }],
    nextStep: 'APPLICATION_EDIT_CAPTURE',
    updatedData: { editingField: field },
  };
}

/** Step: user has replied with the corrected value for the field picked above. */
function handleEditCapture({ text, buttonId, flowData }) {
  const questions = questionsForCategory(flowData.categoryCode);
  const editQ = questions.find(qq => qq.field === flowData.editingField);
  const value = parseAnswer(editQ, text, buttonId);

  if (value === null) {
    return {
      messages: [{ ...buildQuestionMessage(editQ), body: `Sorry, I didn't catch that.\n\n${editQ.prompt}` }],
      nextStep: 'APPLICATION_EDIT_CAPTURE',
      updatedData: {},
    };
  }

  const answers = { ...flowData.answers, [flowData.editingField]: value };
  const resumeQ = questions[flowData.editReturnIndex];

  return {
    messages: [
      { type: 'text', body: '✅ Updated.' },
      buildQuestionMessage(resumeQ, true, progressLabel(questions, answers, flowData.editReturnIndex)),
    ],
    nextStep: 'APPLICATION_CAPTURE',
    updatedData: { answers, qIndex: flowData.editReturnIndex },
  };
}

module.exports = { startApplication, continueApplication, handleEditSelect, handleEditCapture, handleRepeatConfirm };
