/**
 * documentUploadEngine.js — walks the applicant through sending each
 * required document for their category. Shared by the customer flow
 * (mainFlow.js) and the field-agent flow (agentFlow.js); both delegate
 * their 'DOCUMENT_UPLOAD' and 'DOCUMENT_UPLOAD_INTRO' steps here.
 *
 * Flow: start() shows a numbered checklist + [Start uploading / Come back
 * later]. Then each document is prompted one at a time with a (k/N)
 * progress marker.
 */

'use strict';

const { REQUIRED_DOCUMENTS } = require('./requiredDocuments');
const documentStorage = require('../services/documentStorage.service');

const RETURN_BUTTON = { id: 'RETURN_MENU', title: '🔙 Main Menu' };

function docsFor(flowData) {
  const key = flowData.agentApplicationId ? 'AGENT_APPLICATION' : flowData.categoryCode;
  return REQUIRED_DOCUMENTS[key] || [];
}

function uploadPromptMessage(label, index, total) {
  const prog = total ? `(${index + 1}/${total}) ` : '';
  return {
    type: 'interactive',
    body: `${prog}Please send: *${label}*\n\nSend it as a photo or file. Reply SKIP if you don't have it right now.`,
    buttons: [{ id: 'SKIP_DOC', title: 'Skip for now' }, RETURN_BUTTON],
  };
}

function introMessage(docs) {
  const list = docs.map((d, i) => `${i + 1}. ${d}`).join('\n');
  return {
    type: 'interactive',
    body: `You'll need to send ${docs.length} document${docs.length === 1 ? '' : 's'}:\n\n${list}\n\n`
      + `You can send them now one at a time, or come back later.`,
    buttons: [
      { id: 'START_UPLOAD', title: 'Start uploading' },
      { id: 'DOCS_LATER', title: "I'll come back later" },
      RETURN_BUTTON,
    ],
  };
}

/**
 * Call when an application (or agent application) has just been created, to
 * start the document sequence. `docsKey` is a loan category code or
 * 'AGENT_APPLICATION'.
 */
function start(docsKey) {
  const docs = REQUIRED_DOCUMENTS[docsKey] || [];
  if (docs.length === 0) {
    return { messages: [], nextStep: null, endFlow: true };
  }
  return {
    messages: [introMessage(docs)],
    nextStep: 'DOCUMENT_UPLOAD_INTRO',
    updatedData: { docIndex: 0 },
  };
}

/** Handles the [Start uploading / Come back later] choice. */
function handleIntro({ buttonId, text, flowData }) {
  const docs = docsFor(flowData);
  const t = (text || '').trim().toLowerCase();

  if (buttonId === 'DOCS_LATER' || /later|not now|come back/.test(t)) {
    return {
      messages: [{
        type: 'interactive',
        body: 'No problem. When you have your documents ready, choose *Submit loan documents* from the menu and I\'ll pick up where we left off.',
        buttons: [RETURN_BUTTON],
      }],
      endFlow: true,
    };
  }

  if (buttonId === 'START_UPLOAD' || /start|upload|ready|yes|go/.test(t)) {
    return {
      messages: [uploadPromptMessage(docs[0], 0, docs.length)],
      nextStep: 'DOCUMENT_UPLOAD',
      updatedData: { docIndex: 0 },
    };
  }

  return { messages: [introMessage(docs)], nextStep: 'DOCUMENT_UPLOAD_INTRO', updatedData: {} };
}

/** Handles one incoming message while collecting documents. */
async function handleUpload({ text, buttonId, media, flowData }) {
  const isAgentApplication = !!flowData.agentApplicationId;
  const docs = docsFor(flowData);
  const label = docs[flowData.docIndex];

  if (buttonId === 'SKIP_DOC' || /^skip$/i.test((text || '').trim())) {
    return advance(docs, flowData, isAgentApplication);
  }

  if (media) {
    try {
      await documentStorage.storeDocument({
        applicationId: flowData.applicationId,
        agentApplicationId: flowData.agentApplicationId,
        label,
        mediaId: media.id,
      });
    } catch (err) {
      console.error('[DOCS] storeDocument failed:', err.message);
      return {
        messages: [{ type: 'interactive', body: `Sorry, that upload failed. Please try sending *${label}* again.`, buttons: [{ id: 'SKIP_DOC', title: 'Skip for now' }, RETURN_BUTTON] }],
        nextStep: 'DOCUMENT_UPLOAD',
        updatedData: {},
      };
    }

    return advance(docs, flowData, isAgentApplication, `✅ Received: ${label}`);
  }

  return {
    messages: [{ type: 'interactive', body: `Please attach *${label}* as a photo or file, or reply SKIP.`, buttons: [{ id: 'SKIP_DOC', title: 'Skip for now' }, RETURN_BUTTON] }],
    nextStep: 'DOCUMENT_UPLOAD',
    updatedData: {},
  };
}

function advance(docs, flowData, isAgentApplication, prefix = null) {
  const nextIndex = flowData.docIndex + 1;

  if (nextIndex >= docs.length) {
    const messages = [];
    if (prefix) messages.push({ type: 'text', body: prefix });
    const completionBody = isAgentApplication
      ? "All done. Thank you. Your agent application and documents have been received. A staff member will review it and get back to you within 48 hours."
      : `All done. Thank you. Your documents for ${flowData.referenceNumber || 'your application'} have been received. A credit officer will be in touch.`;
    messages.push({ type: 'interactive', body: completionBody, buttons: [RETURN_BUTTON] });
    return { messages, endFlow: true };
  }

  const messages = [];
  if (prefix) messages.push({ type: 'text', body: prefix });
  messages.push(uploadPromptMessage(docs[nextIndex], nextIndex, docs.length));
  return { messages, nextStep: 'DOCUMENT_UPLOAD', updatedData: { docIndex: nextIndex } };
}

module.exports = { start, handleIntro, handleUpload };
