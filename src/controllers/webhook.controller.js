/**
 * webhook.controller.js — receives inbound WhatsApp messages from the Meta
 * webhook, dedupes, upserts the customer, logs the message, and dispatches
 * to flow.service. No AI in the request path.
 */

'use strict';

const { supabase } = require('../models/supabase');
const whatsappService = require('../services/whatsapp.service');
const flowService = require('../services/flow.service');
const agentService = require('../services/agent.service');

const processedMessageIds = new Set();
const MESSAGE_ID_TTL_MS = 10 * 60 * 1000;
const MAX_MESSAGE_AGE_MS = 5 * 60 * 1000;

class WebhookController {
  async handleIncomingMessage(req, res) {
    try {
      const body = req.body;

      if (body.object !== 'whatsapp_business_account') {
        return res.sendStatus(404);
      }

      for (const entry of body.entry || []) {
        for (const change of entry.changes || []) {
          if (change.field !== 'messages') continue;

          const value = change.value;
          if (value.statuses && value.statuses.length > 0) continue; // delivery/read receipts
          if (!value.messages || value.messages.length === 0) continue;

          for (const message of value.messages) {
            const SUPPORTED = ['text', 'interactive', 'image', 'document'];
            if (!SUPPORTED.includes(message.type)) {
              console.log(`⏭️ Skipping: unsupported message type "${message.type}"`);
              continue;
            }

            if (message.type === 'interactive') {
              const btnId = message.interactive?.button_reply?.id
                         || message.interactive?.list_reply?.id || null;
              const title = message.interactive?.button_reply?.title
                         || message.interactive?.list_reply?.title || '';
              if (!btnId && !title.trim()) {
                console.log('⏭️ Skipping: empty interactive reply');
                continue;
              }
              message._buttonId = btnId;
              message._normalisedText = title.trim() || btnId;
            } else if (message.type === 'image' || message.type === 'document') {
              const media = message[message.type];
              if (!media?.id) {
                console.log('⏭️ Skipping: media message with no id');
                continue;
              }
              message._media = { id: media.id, mimeType: media.mime_type, kind: message.type };
              message._normalisedText = media.caption || `[${message.type} received]`;
            } else if (!message.text?.body?.trim()) {
              console.log('⏭️ Skipping: empty text message');
              continue;
            }

            const ageMs = Date.now() - parseInt(message.timestamp, 10) * 1000;
            if (ageMs > MAX_MESSAGE_AGE_MS) {
              console.log(`⏭️ Skipping: stale message (${Math.round(ageMs / 1000)}s old)`);
              continue;
            }

            if (processedMessageIds.has(message.id)) {
              console.log('[DEDUP] Skipping duplicate:', message.id);
              continue;
            }
            processedMessageIds.add(message.id);
            setTimeout(() => processedMessageIds.delete(message.id), MESSAGE_ID_TTL_MS);

            await this.processMessage(message, value);
          }
        }
      }

      res.sendStatus(200);
    } catch (err) {
      console.error('❌ Webhook error:', err);
      res.sendStatus(500);
    }
  }

  async processMessage(message, value) {
    try {
      const customerPhone = message.from;
      const messageText = message._normalisedText || message.text.body.trim();
      const buttonId = message._buttonId || null;
      const media = message._media || null;
      const timestamp = new Date(parseInt(message.timestamp, 10) * 1000);

      console.log(`📨 From ${customerPhone}: "${messageText}" buttonId=${buttonId || 'none'}`);

      let { data: customer } = await supabase
        .from('customers')
        .select('*')
        .eq('phone_number', customerPhone)
        .single();

      if (!customer) {
        const profileName = value.contacts?.[0]?.profile?.name || 'Customer';
        const { data: newCustomer, error } = await supabase
          .from('customers')
          .insert([{ phone_number: customerPhone, name: profileName }])
          .select()
          .single();
        if (error) {
          console.error('❌ Failed to create customer:', error.message);
          return;
        }
        customer = newCustomer;
      }

      await supabase.from('conversations').insert([{
        customer_phone: customerPhone,
        message_text: messageText,
        direction: 'inbound',
        whatsapp_message_id: message.id,
        timestamp: timestamp.toISOString(),
        sent_by: 'customer',
      }]);

      // Field agents onboarded via the dashboard (or an approved agent
      // application) activate by sending their 6-digit code to the bot —
      // intercept that here, before any flow dispatch. We pull the first
      // 6-digit run out of whatever they typed, so "my code is 497540" and
      // "497540" both work.
      const agentRecord = await agentService.findByPhone(customerPhone);
      if (agentRecord && !agentRecord.verified) {
        const codeMatch = (messageText || '').match(/\b(\d{6})\b/);
        if (!codeMatch) {
          await whatsappService.sendMessage(
            customerPhone,
            'Send the 6-digit activation code from your approval message to activate your Soledd field agent account.'
          );
          return;
        }
        const result = await agentService.verifyOtp(customerPhone, codeMatch[1]);
        if (result?.ok) {
          await whatsappService.sendMessage(customerPhone, "You're verified! Welcome to the Soledd field agent team. Send any message to get started.");
        } else if (result?.reason === 'expired') {
          await whatsappService.sendMessage(customerPhone, 'That code has expired. Please ask your office manager to resend a new one.');
        } else {
          await whatsappService.sendMessage(customerPhone, "That code doesn't look right. Please check and try again.");
        }
        return;
      }
      const isAgent = !!(agentRecord && agentRecord.verified && agentRecord.active);

      const { data: state } = await supabase
        .from('conversation_states')
        .select('*')
        .eq('customer_phone', customerPhone)
        .single();

      if (state?.bot_paused) {
        console.log('⏸️ Bot paused for this customer — no auto-reply');
        return;
      }

      await flowService.dispatch(customerPhone, { text: messageText, buttonId, media, customer, state, isAgent });
    } catch (err) {
      console.error('❌ processMessage error:', err.message, err.stack);
    }
  }

  async verifyWebhook(req, res) {
    const mode = req.query['hub.mode'];
    const token = req.query['hub.verify_token'];
    const challenge = req.query['hub.challenge'];

    const result = whatsappService.verifyWebhook(mode, token, challenge);
    if (result) {
      console.log('✅ Webhook verified');
      res.status(200).send(result);
    } else {
      console.log('❌ Webhook verification failed');
      res.sendStatus(403);
    }
  }
}

module.exports = new WebhookController();
