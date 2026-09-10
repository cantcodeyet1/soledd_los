/**
 * flow_smoketest.js — drives every bot conversational pathway by calling
 * flowService.dispatch directly (plus the webhook controller's agent-OTP
 * interception), with WhatsApp sends mocked so nothing leaves the machine.
 * Prints the bot transcript and cleans up all test rows afterwards.
 *
 *   node scripts/flow_smoketest.js
 *
 * Real DB writes happen (conversation_states, applications, documents,
 * agent_applications, application_activity) against a fake phone number and
 * are deleted at the end. completionForms still runs Python + uploads the
 * generated PDFs to storage/generated/<id>/ (also cleaned).
 */

'use strict';

require('dotenv').config();
const { supabase } = require('../src/models/supabase');

// ── mock WhatsApp before anything requires it ─────────────────────────────
const ws = require('../src/services/whatsapp.service');
const OUT = [];
ws.sendMessage = async (to, body) => { OUT.push({ to, kind: 'text', body }); return { success: true }; };
ws.sendButtonMessage = async (to, body, buttons) => { OUT.push({ to, kind: 'buttons', body, buttons: buttons.map(b => b.title) }); return { success: true }; };
ws.sendListMessage = async (to, body, label, sections) => { OUT.push({ to, kind: 'list', body, rows: sections.flatMap(s => s.rows.map(r => r.title)) }); return { success: true }; };
ws.sendDocument = async (to, link, filename) => { OUT.push({ to, kind: 'document', body: `[document: ${filename}]` }); return { success: true }; };
ws.getBotNumber = async () => '+263 78 622 0151';

const flowService = require('../src/services/flow.service');
const agentService = require('../src/services/agent.service');

const PHONE = '263700000091';
const AGENT_PHONE = '263700000092';

async function ensureCustomer(phone, name) {
  await supabase.from('customers').upsert({ phone_number: phone, name }, { onConflict: 'phone_number' });
}

async function getState(phone) {
  const { data } = await supabase.from('conversation_states').select('*').eq('customer_phone', phone).maybeSingle();
  return data || null;
}

/** One inbound turn — mirrors webhook.controller.processMessage. */
async function turn(phone, { text = null, buttonId = null, media = null } = {}) {
  OUT.length = 0;
  await ensureCustomer(phone, 'Smoke Tester');
  const { data: customer } = await supabase.from('customers').select('*').eq('phone_number', phone).single();

  // agent OTP interception (controller-level)
  const agentRecord = await agentService.findByPhone(phone);
  if (agentRecord && !agentRecord.verified) {
    const codeMatch = (text || '').match(/\b(\d{6})\b/);
    if (!codeMatch) { OUT.push({ kind: 'text', body: 'Send the 6-digit activation code from your approval message to activate your Soledd field agent account.' }); return render(phone, text, buttonId); }
    const result = await agentService.verifyOtp(phone, codeMatch[1]);
    OUT.push({ kind: 'text', body: result?.ok ? "You're verified! Welcome to the Soledd field agent team." : result?.reason === 'expired' ? 'That code has expired.' : "That code doesn't look right." });
    return render(phone, text, buttonId);
  }
  const isAgent = !!(agentRecord && agentRecord.verified && agentRecord.active);

  const state = await getState(phone);
  await flowService.dispatch(phone, { text, buttonId, media, customer, state, isAgent });
  return render(phone, text, buttonId);
}

function render(phone, text, buttonId) {
  const lines = [`  >> ${buttonId ? `[btn ${buttonId}]` : ''} ${text || ''}`.trimEnd()];
  for (const m of OUT) {
    let s = `BOT  ${(m.body || '').replace(/\n/g, '\n      ')}`;
    if (m.kind === 'buttons') s += `   ⟨buttons: ${m.buttons.join(' | ')}⟩`;
    if (m.kind === 'list') s += `   ⟨rows: ${m.rows.join(' | ')}⟩`;
    lines.push(s);
  }
  return lines.join('\n');
}

function head(t) { console.log(`\n${'━'.repeat(80)}\n${t}\n${'━'.repeat(80)}`); }

async function cleanup() {
  for (const p of [PHONE, AGENT_PHONE]) {
    const { data: apps } = await supabase.from('applications').select('id').eq('applicant_phone', p);
    for (const a of apps || []) {
      await supabase.from('application_activity').delete().eq('application_id', a.id);
      await supabase.from('documents').delete().eq('application_id', a.id);
      const { data: gen } = await supabase.storage.from('documents').list(`generated/${a.id}`, { limit: 100 });
      if (gen && gen.length) await supabase.storage.from('documents').remove(gen.map(f => `generated/${a.id}/${f.name}`)).catch(() => {});
    }
    const { data: aapps } = await supabase.from('agent_applications').select('id').eq('applicant_phone', p);
    for (const a of aapps || []) await supabase.from('documents').delete().eq('agent_application_id', a.id);
    await supabase.from('applications').delete().eq('applicant_phone', p);
    await supabase.from('agent_applications').delete().eq('applicant_phone', p);
    await supabase.from('agents').delete().eq('phone_number', p);
    await supabase.from('conversation_states').delete().eq('customer_phone', p);
    await supabase.from('conversations').delete().eq('customer_phone', p);
    await supabase.from('customers').delete().eq('phone_number', p);
  }
}

async function run() {
  await cleanup();

  head('1. First-time customer — new SSB application (invalid amount, then forms + doc prompts)');
  console.log(await turn(PHONE, { text: 'Hi' }));
  console.log(await turn(PHONE, { buttonId: 'CAT_SSB', text: 'Civil Servants' }));
  console.log(await turn(PHONE, { text: 'Mr Tinashe Tapiwa Moyo' }));
  console.log(await turn(PHONE, { text: '63-114872-A63' }));
  console.log(await turn(PHONE, { text: '0772000111, 12 Main St, Harare' }));
  console.log(await turn(PHONE, { text: 'Rudo Moyo, 12 Main St, 0772000222' }));
  console.log(await turn(PHONE, { text: 'Ministry of Health' }));
  console.log(await turn(PHONE, { text: 'CBZ, 1234567890' }));
  console.log(await turn(PHONE, { buttonId: 'OPT_0', text: 'Monthly Salary' }));
  console.log(await turn(PHONE, { text: 'School fees' }));
  console.log(await turn(PHONE, { text: 'abc' }));            // invalid amount
  console.log(await turn(PHONE, { text: '1000' }));
  console.log(await turn(PHONE, { buttonId: 'PERIOD_12', text: '12 months' }));
  console.log('   → state:', JSON.stringify(await getState(PHONE).then(s => ({ flow: s?.flow, step: s?.step }))));

  head('1b. Document phase — SKIP every prompt to the end');
  for (let i = 0; i < 10; i++) {
    const s = await getState(PHONE);
    if (s?.step !== 'DOCUMENT_UPLOAD') break;
    console.log(await turn(PHONE, { buttonId: 'SKIP_DOC', text: 'Skip for now' }));
  }
  console.log('   → state after docs:', JSON.stringify(await getState(PHONE).then(s => ({ flow: s?.flow || null, step: s?.step || null }))));
  const { data: act } = await supabase.from('application_activity').select('type, summary').order('created_at', { ascending: true });
  console.log('   → activity for the new app:', JSON.stringify((act || []).filter(a => /document|Submitted/i.test(a.summary))));

  head('2. Returning customer — reuse prior details');
  console.log(await turn(PHONE, { text: 'Hi' }));
  console.log(await turn(PHONE, { buttonId: 'CAT_PRIVATE', text: 'Private Sector Employees' }));
  console.log(await turn(PHONE, { text: 'Mr Tinashe Tapiwa Moyo' }));
  console.log(await turn(PHONE, { text: '63-114872-A63' }));   // repeat ID
  head('2b. ...tap "Yes, reuse"');
  console.log(await turn(PHONE, { buttonId: 'REUSE_YES', text: 'Yes, reuse' }));

  head('3. Mid-application EDIT');
  console.log(await turn(PHONE, { buttonId: 'EDIT_ANSWER', text: 'Edit answer' }));
  console.log(await turn(PHONE, { text: '1' }));
  console.log(await turn(PHONE, { text: 'Mrs Rufaro Nkomo' }));

  head('4. "Main Menu" button abandons progress');
  console.log(await turn(PHONE, { buttonId: 'RETURN_MENU', text: '🔙 Main Menu' }));
  console.log('   → state (flow should be null):', JSON.stringify(await getState(PHONE).then(s => ({ flow: s?.flow || null, step: s?.step || null }))));

  head('5. Gibberish at the main menu');
  console.log(await turn(PHONE, { text: '🤪🤪 zxqw' }));

  head('6. Private Sector branching — answer "Married" → spouse question');
  console.log(await turn(PHONE, { buttonId: 'CAT_PRIVATE', text: 'Private Sector Employees' }));
  console.log(await turn(PHONE, { text: 'Ms Chido Zulu' }));
  console.log(await turn(PHONE, { text: '63-555555-Q55' }));   // fresh ID
  console.log(await turn(PHONE, { text: '01/01/1990, 5 Rd, Harare, 0771222333' }));
  console.log(await turn(PHONE, { text: 'Baba Zulu, 5 Rd, 0771222444, Father' }));
  console.log(await turn(PHONE, { text: 'Married' }));

  head('7. Speak to an Agent');
  console.log(await turn(PHONE, { buttonId: 'RETURN_MENU', text: '🔙 Main Menu' }));
  console.log(await turn(PHONE, { buttonId: 'ACTION_SPEAK_AGENT', text: 'Speak to an Agent' }));
  console.log('   → state (should be null):', JSON.stringify(await getState(PHONE).then(s => ({ flow: s?.flow || null, step: s?.step || null }))));

  head('8. Become an Agent — short-input reprompts, then agent doc prompts');
  console.log(await turn(PHONE, { text: 'Hi' }));
  console.log(await turn(PHONE, { buttonId: 'ACTION_BECOME_AGENT', text: 'Become an Agent' }));
  console.log(await turn(PHONE, { text: 'A' }));               // short name
  console.log(await turn(PHONE, { text: 'Tapiwa Field' }));
  console.log(await turn(PHONE, { text: '12' }));              // short ID
  console.log(await turn(PHONE, { text: '63-222222-B22' }));
  console.log(await turn(PHONE, { text: 'X' }));               // short area
  console.log(await turn(PHONE, { text: 'Chitungwiza' }));
  const { data: aapp } = await supabase.from('agent_applications').select('full_name, area, status').eq('applicant_phone', PHONE).maybeSingle();
  console.log('   → agent_applications row:', JSON.stringify(aapp));

  head('9. Field agent — junk, then the 6-digit code, then the agent menu');
  await ensureCustomer(AGENT_PHONE, 'Field Agent Test');
  await supabase.from('agents').upsert({
    phone_number: AGENT_PHONE, name: 'Field Agent Test', verified: false, active: true,
    otp_code: '654321', otp_expires_at: new Date(Date.now() + 3600e3).toISOString(),
  }, { onConflict: 'phone_number' });
  console.log(await turn(AGENT_PHONE, { text: 'hello' }));
  console.log(await turn(AGENT_PHONE, { text: 'my code is 654321' }));
  console.log(await turn(AGENT_PHONE, { text: 'hi' }));
  console.log('   → verified?', JSON.stringify((await supabase.from('agents').select('verified, active').eq('phone_number', AGENT_PHONE).single()).data));

  head('9b. Field agent starts a client loan, then gets deactivated mid-flow');
  console.log(await turn(AGENT_PHONE, { buttonId: 'AGENT_NEW_LOAN', text: 'Start new loan' }));
  console.log(await turn(AGENT_PHONE, { buttonId: 'CAT_SME', text: 'Small to Medium Enterprises' }));
  console.log(await turn(AGENT_PHONE, { text: 'Mr Clientson' }));
  // deactivate the agent while they are mid client-application
  await supabase.from('agents').update({ active: false }).eq('phone_number', AGENT_PHONE);
  console.log(await turn(AGENT_PHONE, { text: 'CBZ, 123' }));
  console.log('   → state after deactivation (should be MAIN/MAIN_MENU):', JSON.stringify(await getState(AGENT_PHONE).then(s => ({ flow: s?.flow || null, step: s?.step || null }))));

  head('10. Submit loan documents from the menu (customer who already applied)');
  console.log(await turn(PHONE, { text: 'Hi' }));
  console.log(await turn(PHONE, { buttonId: 'ACTION_SUBMIT_DOCS', text: 'Submit loan documents' }));

  console.log('\n\ncleaning up test data...');
  await cleanup();
  console.log('done.');
}

run().catch(e => { console.error('SMOKETEST ERROR:', e.message, e.stack); cleanup().finally(() => process.exit(1)); });
