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

/** Call when an application has just been created, to start the document sequence. */
function start(categoryCode) {
  const docs = REQUIRED_DOCUMENTS[categoryCode] || [];
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
  const docs = REQUIRED_DOCUMENTS[flowData.categoryCode] || [];
  const label = docs[flowData.docIndex];

  if (buttonId === 'SKIP_DOC' || /^skip$/i.test((text || '').trim())) {
    return advance(docs, flowData);
  }

  if (media) {
    try {
      await documentStorage.storeDocument({
        applicationId: flowData.applicationId,
        label,
        mediaId: media.id,
      });
    } catch (err) {
      console.error('[DOCS] storeDocument failed:', err.message);
      return {
        messages: [{ type: 'text', body: `Sorry, that upload failed. Please try sending *${label}* again.` }],
        nextStep: 'DOCUMENT_UPLOAD',
        updatedData: {},
      };
    }

    return advance(docs, flowData, `✅ Received: ${label}`);
  }

  return {
    messages: [{ type: 'text', body: `Please attach *${label}* as a photo or file, or reply SKIP.` }],
    nextStep: 'DOCUMENT_UPLOAD',
    updatedData: {},
  };
}

function advance(docs, flowData, prefix = null) {
  const nextIndex = flowData.docIndex + 1;

  if (nextIndex >= docs.length) {
    const messages = [];
    if (prefix) messages.push({ type: 'text', body: prefix });
    messages.push({
      type: 'interactive',
      body: `All done! Thank you. Your documents for ${flowData.referenceNumber || 'your application'} have been received. A credit officer will be in touch.`,
      buttons: [RETURN_BUTTON],
    });
    return { messages, endFlow: true };
  }

  const messages = [];
  if (prefix) messages.push({ type: 'text', body: prefix });
  messages.push(uploadPromptMessage(docs[nextIndex]));
  return { messages, nextStep: 'DOCUMENT_UPLOAD', updatedData: { docIndex: nextIndex } };
}

module.exports = { start, handleUpload };
