/**
 * documentUploadEngine.js — walks the applicant through sending each
 * required document for their category, one at a time. Shared by both the
 * customer flow (mainFlow.js) and the field-agent flow (agentFlow.js) —
 * both just delegate their 'DOCUMENT_UPLOAD' step here.
 */

'use strict';

const { REQUIRED_DOCUMENTS } = require('./requiredDocuments');
const documentStorage = require('../services/documentStorage.service');

const RETURN_BUTTON = { id: 'RETURN_MENU', title: '🔙 Main Menu' };

function uploadPromptMessage(label) {
  return {
    type: 'interactive',
    body: `Please send: *${label}*\n\nSend it as a photo or file attachment. Reply SKIP if you don't have it right now.`,
    buttons: [{ id: 'SKIP_DOC', title: 'Skip for now' }, RETURN_BUTTON],
  };
}

/**
 * Call when an application (or agent application) has just been created, to
 * start the document sequence. `docsKey` looks up REQUIRED_DOCUMENTS —
 * either a loan category code, or 'AGENT_APPLICATION'.
 */
function start(docsKey) {
  const docs = REQUIRED_DOCUMENTS[docsKey] || [];
  if (docs.length === 0) {
    return { messages: [], nextStep: null, endFlow: true };
  }
  return {
    messages: [uploadPromptMessage(docs[0])],
    nextStep: 'DOCUMENT_UPLOAD',
    updatedData: { docIndex: 0 },
  };
}

/** Handles one incoming message while collecting documents. */
async function handleUpload({ text, buttonId, media, flowData }) {
  const isAgentApplication = !!flowData.agentApplicationId;
  const docsKey = isAgentApplication ? 'AGENT_APPLICATION' : flowData.categoryCode;
  const docs = REQUIRED_DOCUMENTS[docsKey] || [];
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
      ? "All done! Thank you. Your agent application and documents have been received. A staff member will review your application and revert within 48 hours."
      : `All done! Thank you. Your documents for ${flowData.referenceNumber || 'your application'} have been received. A credit officer will be in touch.`;
    messages.push({ type: 'interactive', body: completionBody, buttons: [RETURN_BUTTON] });
    return { messages, endFlow: true };
  }

  const messages = [];
  if (prefix) messages.push({ type: 'text', body: prefix });
  messages.push(uploadPromptMessage(docs[nextIndex]));
  return { messages, nextStep: 'DOCUMENT_UPLOAD', updatedData: { docIndex: nextIndex } };
}

module.exports = { start, handleUpload };
