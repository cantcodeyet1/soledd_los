/**
 * flow.service.js — state-machine orchestrator.
 *
 * Single entry point: dispatch(customerPhone, payload). Reads session state
 * from conversation_states, routes to the active flow handler, sends the
 * returned messages, and persists the new state. No AI/LLM calls happen here.
 */

'use strict';

const { supabase } = require('../models/supabase');
const whatsappService = require('./whatsapp.service');

const mainFlow = require('../flows/mainFlow');
const agentFlow = require('../flows/agentFlow');

const FLOW_HANDLERS = {
  MAIN: mainFlow,
  AGENT: agentFlow,
};

// New conversations enter the agent menu if the sender is a verified, active
// field agent; everyone else gets the customer menu.
function detectStartFlow(isAgent) {
  return isAgent ? 'AGENT' : 'MAIN';
}

async function dispatch(customerPhone, { text, buttonId, media, customer, state, isAgent = false }) {
  try {
    const flow = state?.flow || null;
    const step = state?.step || null;
    const flowData = state?.flow_data || {};

    let targetFlow = flow || detectStartFlow(isAgent);
    let handler = FLOW_HANDLERS[targetFlow];
    if (!handler) {
      // Stale flow name from a previous deploy (e.g. a renamed flow) —
      // self-heal by restarting at the default flow's entry step.
      console.warn(`[FLOW] Unknown flow "${targetFlow}" in stored state — resetting to default flow`);
      targetFlow = detectStartFlow(isAgent);
      handler = FLOW_HANDLERS[targetFlow];
    }

    const currentStep = (flow === targetFlow && step) ? step : handler.ENTRY_STEP;
    console.log(`[FLOW] ${customerPhone} | flow=${targetFlow} step=${currentStep} text="${text}" btn=${buttonId || 'none'} media=${media ? media.kind : 'none'}`);

    const result = await handler.handleStep(currentStep, { text, buttonId, media, flowData, customer });
    if (!result) {
      console.warn(`[FLOW] Handler returned null for ${targetFlow}/${currentStep}`);
      return;
    }

    const { messages, nextStep, applicationData, agentApplicationData, endFlow } = result;
    let updatedData = result.updatedData;
    let outgoing = messages || [];

    // If this step finalises a loan application, create it first so we can
    // substitute {{REFERENCE}} into the outgoing messages and thread the new
    // application's id/reference into flow state (e.g. for document upload).
    if (applicationData) {
      const application = await createApplication(customerPhone, applicationData);
      const reference = application?.reference_number || 'PENDING';
      outgoing = outgoing.map(m => ({
        ...m,
        body: m.body ? m.body.replace('{{REFERENCE}}', reference) : m.body,
      }));
      if (updatedData) {
        updatedData = { ...updatedData, applicationId: application?.id || null, referenceNumber: reference };
      }
    }

    if (agentApplicationData) {
      await createAgentApplication(customerPhone, agentApplicationData);
    }

    if (outgoing.length > 0) {
      await sendMessages(customerPhone, outgoing);
    }

    if (endFlow) {
      await clearFlowState(customerPhone);
    } else if (nextStep) {
      const merged = { ...flowData, ...(updatedData || {}) };
      await setFlowState(customerPhone, targetFlow, nextStep, merged);
    } else if (updatedData && Object.keys(updatedData).length > 0) {
      const merged = { ...flowData, ...updatedData };
      await setFlowState(customerPhone, targetFlow, currentStep, merged);
    }
  } catch (err) {
    console.error('[FLOW] dispatch error:', err.message, err.stack);
  }
}

async function setFlowState(customerPhone, flow, step, flowData) {
  const now = new Date().toISOString();
  const { error } = await supabase
    .from('conversation_states')
    .upsert({
      customer_phone: customerPhone,
      flow,
      step,
      flow_data: flowData,
      last_message_at: now,
      updated_at: now,
    }, { onConflict: 'customer_phone' });
  if (error) console.error('[FLOW] setFlowState error:', error.message);
  else console.log(`[FLOW] state saved → ${flow}/${step}`);
}

async function clearFlowState(customerPhone) {
  const { error } = await supabase
    .from('conversation_states')
    .update({ flow: null, step: null, flow_data: {}, updated_at: new Date().toISOString() })
    .eq('customer_phone', customerPhone);
  if (error) console.error('[FLOW] clearFlowState error:', error.message);
}

async function sendMessages(customerPhone, messages) {
  for (const msg of messages) {
    let result;

    if (msg.type === 'text') {
      result = await whatsappService.sendMessage(customerPhone, msg.body);
    } else if (msg.type === 'interactive') {
      result = await whatsappService.sendButtonMessage(customerPhone, msg.body, msg.buttons);
    } else if (msg.type === 'list') {
      result = await whatsappService.sendListMessage(customerPhone, msg.body, msg.buttonLabel, msg.sections);
    } else {
      console.warn('[FLOW] Unsupported message type:', msg.type);
      continue;
    }

    if (result && result.success === false) {
      console.error('[FLOW] Send failed:', result.error);
    } else {
      console.log(`[FLOW] Sent (${msg.type}): ${msg.body.slice(0, 80)}`);
    }

    await supabase.from('conversations').insert([{
      customer_phone: customerPhone,
      message_text: msg.body,
      direction: 'outbound',
      timestamp: new Date().toISOString(),
      sent_by: 'bot',
    }]);
  }
}

async function createApplication(customerPhone, appData) {
  const { data: inserted, error } = await supabase
    .from('applications')
    .insert([{
      applicant_phone: customerPhone,
      category: appData.categoryCode,
      full_name: appData.fullName,
      national_id: appData.nationalId,
      employer_name: appData.employerName || null,
      loan_amount: appData.loanAmount,
      repayment_months: appData.repaymentMonths,
      extra_details: appData.extraDetails || {},
      agent_phone: appData.agentPhone || null,
    }])
    .select()
    .single();

  if (error) {
    console.error('[FLOW] createApplication error:', error.message);
    return null;
  }

  console.log(`[FLOW] Application created: ${inserted.reference_number} (${inserted.category})`);
  return inserted;
}

async function createAgentApplication(customerPhone, agentData) {
  const { data: inserted, error } = await supabase
    .from('agent_applications')
    .insert([{
      applicant_phone: customerPhone,
      full_name: agentData.fullName,
      national_id: agentData.nationalId,
      area: agentData.area,
    }])
    .select()
    .single();

  if (error) {
    console.error('[FLOW] createAgentApplication error:', error.message);
    return null;
  }

  console.log(`[FLOW] Agent application created for ${customerPhone}`);
  return inserted;
}

module.exports = {
  dispatch,
  setFlowState,
  clearFlowState,
  sendMessages,
  createApplication,
  createAgentApplication,
};
