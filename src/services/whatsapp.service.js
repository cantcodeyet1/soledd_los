/**
 * whatsapp.service.js — thin client for the Meta WhatsApp Cloud API.
 * The New Application flow is plain numbered-menu text, so only text
 * sending is needed for now.
 */

'use strict';

const axios = require('axios');

const BASE_URL = 'https://graph.facebook.com/v18.0';

function config() {
  return {
    token:        process.env.WHATSAPP_API_TOKEN,
    phoneNumberId: process.env.WHATSAPP_PHONE_NUMBER_ID,
  };
}

async function sendMessage(to, body) {
  const { token, phoneNumberId } = config();
  if (!token || !phoneNumberId) {
    console.warn('⚠️ WhatsApp not configured (missing WHATSAPP_API_TOKEN / WHATSAPP_PHONE_NUMBER_ID)');
    return { success: false, error: 'WhatsApp not configured' };
  }

  try {
    const response = await axios.post(
      `${BASE_URL}/${phoneNumberId}/messages`,
      {
        messaging_product: 'whatsapp',
        to: to.replace(/\+/g, ''),
        type: 'text',
        text: { body },
      },
      {
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
      }
    );
    return { success: true, data: response.data };
  } catch (error) {
    console.error('WhatsApp send error:', error.response?.data || error.message);
    return { success: false, error: error.response?.data || error.message };
  }
}

/**
 * buttons: [{ id, title }] — max 3, title trimmed to 20 chars (Meta limit).
 */
async function sendButtonMessage(to, bodyText, buttons) {
  const { token, phoneNumberId } = config();
  if (!token || !phoneNumberId) {
    console.warn('⚠️ WhatsApp not configured');
    return { success: false, error: 'WhatsApp not configured' };
  }

  try {
    const response = await axios.post(
      `${BASE_URL}/${phoneNumberId}/messages`,
      {
        messaging_product: 'whatsapp',
        to: to.replace(/\+/g, ''),
        type: 'interactive',
        interactive: {
          type: 'button',
          body: { text: bodyText },
          action: {
            buttons: buttons.map((btn, idx) => ({
              type: 'reply',
              reply: { id: btn.id || `btn_${idx}`, title: btn.title.slice(0, 20) },
            })),
          },
        },
      },
      { headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' } }
    );
    return { success: true, data: response.data };
  } catch (error) {
    console.error('WhatsApp button send error:', error.response?.data || error.message);
    return { success: false, error: error.response?.data || error.message };
  }
}

/**
 * sections: [{ title, rows: [{ id, title, description }] }] — max 10 rows total,
 * row title <=24 chars, row description <=72 chars (Meta limits).
 */
async function sendListMessage(to, bodyText, buttonLabel, sections) {
  const { token, phoneNumberId } = config();
  if (!token || !phoneNumberId) {
    console.warn('⚠️ WhatsApp not configured');
    return { success: false, error: 'WhatsApp not configured' };
  }

  try {
    const response = await axios.post(
      `${BASE_URL}/${phoneNumberId}/messages`,
      {
        messaging_product: 'whatsapp',
        to: to.replace(/\+/g, ''),
        type: 'interactive',
        interactive: {
          type: 'list',
          body: { text: bodyText },
          action: {
            button: buttonLabel.slice(0, 20),
            sections: sections.map(s => ({
              title: s.title.slice(0, 24),
              rows: s.rows.map(r => ({
                id: r.id,
                title: r.title.slice(0, 24),
                description: (r.description || '').slice(0, 72),
              })),
            })),
          },
        },
      },
      { headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' } }
    );
    return { success: true, data: response.data };
  } catch (error) {
    console.error('WhatsApp list send error:', error.response?.data || error.message);
    return { success: false, error: error.response?.data || error.message };
  }
}

let _botNumberCache = null;

/**
 * The bot's own WhatsApp number in display form (e.g. "+263 78 622 0151"),
 * for telling people where to send an activation code. Prefers the
 * WHATSAPP_BOT_NUMBER env var; otherwise reads display_phone_number from the
 * Graph API once and caches it. Falls back to null if neither is available.
 */
async function getBotNumber() {
  if (process.env.WHATSAPP_BOT_NUMBER) return process.env.WHATSAPP_BOT_NUMBER;
  if (_botNumberCache) return _botNumberCache;
  const { token, phoneNumberId } = config();
  if (!token || !phoneNumberId) return null;
  try {
    const res = await axios.get(`${BASE_URL}/${phoneNumberId}`, {
      params: { fields: 'display_phone_number' },
      headers: { Authorization: `Bearer ${token}` },
    });
    _botNumberCache = res.data?.display_phone_number || null;
    return _botNumberCache;
  } catch (error) {
    console.error('WhatsApp getBotNumber error:', error.response?.data || error.message);
    return null;
  }
}

/** Resolves a Meta media ID to a short-lived download URL + mime type. */
async function getMediaUrl(mediaId) {
  const { token } = config();
  const response = await axios.get(`${BASE_URL}/${mediaId}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  return { url: response.data.url, mimeType: response.data.mime_type };
}

/** Downloads media bytes from a Meta-issued URL (still requires our token). */
async function downloadMedia(url) {
  const { token } = config();
  const response = await axios.get(url, {
    headers: { Authorization: `Bearer ${token}` },
    responseType: 'arraybuffer',
  });
  return Buffer.from(response.data);
}

function verifyWebhook(mode, token, challenge) {
  const verifyToken = process.env.WEBHOOK_VERIFY_TOKEN;
  if (mode === 'subscribe' && token === verifyToken) {
    return challenge;
  }
  return null;
}

module.exports = { sendMessage, sendButtonMessage, sendListMessage, getMediaUrl, downloadMedia, verifyWebhook, getBotNumber };
