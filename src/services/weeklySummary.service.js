/**
 * weeklySummary.service.js — builds and sends the weekly activity summary
 * email, and runs the tiny scheduler that decides when to send it.
 *
 * Day / time / on-off come from notificationSettings (Settings →
 * Notifications), in Zimbabwe time. The scheduler ticks once a minute and
 * sends at most once per calendar day: if the server was asleep at the
 * scheduled minute it still sends later that same day when it wakes.
 *
 * The scheduler only runs on Render (or with SCHEDULER=true) so a developer
 * running the backend locally against the live database can't double-send.
 */

'use strict';

const { supabase } = require('../models/supabase');
const settingsService = require('./settings.service');
const notificationSettings = require('./notificationSettings.service');
const email = require('./email.service');

const LAST_SENT_KEY = 'weekly_summary_last_sent';
const DAY = 24 * 3600 * 1000;
const CATEGORY_LABEL = { SSB: 'SSB', GOVT_PENSIONER: 'Govt pensioner', PRIVATE_SECTOR: 'Private sector', SME: 'SME' };
const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

/** Wall-clock parts of `date` in Zimbabwe time. */
function harareParts(date = new Date()) {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-GB', {
      timeZone: notificationSettings.TIMEZONE, weekday: 'short', year: 'numeric', month: '2-digit',
      day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false,
    }).formatToParts(date).map(p => [p.type, p.value])
  );
  const hour = parts.hour === '24' ? '00' : parts.hour;
  return {
    dateKey: `${parts.year}-${parts.month}-${parts.day}`,
    weekday: ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(parts.weekday),
    minutes: Number(hour) * 60 + Number(parts.minute),
  };
}

function shortDate(date) {
  return new Intl.DateTimeFormat('en-GB', { timeZone: notificationSettings.TIMEZONE, day: 'numeric', month: 'short' }).format(date);
}

async function fetchData(now) {
  const since = new Date(now.getTime() - 7 * DAY).toISOString();

  const created = await supabase
    .from('applications')
    .select('id, reference_number, full_name, category, loan_amount, agent_phone')
    .gte('created_at', since);

  const activity = await supabase
    .from('application_activity')
    .select('application_id, detail, created_at')
    .eq('type', 'STATUS_CHANGED')
    .gte('created_at', since)
    .order('created_at', { ascending: true });

  // Latest decision per application this week.
  const decided = new Map();
  for (const a of activity.data || []) {
    const st = a.detail?.status;
    if (st === 'APPROVED' || st === 'REJECTED') decided.set(a.application_id, st);
    else decided.delete(a.application_id); // sent back to review - no longer a decision
  }
  let decidedApps = [];
  if (decided.size > 0) {
    const { data } = await supabase.from('applications').select('id, loan_amount').in('id', [...decided.keys()]);
    decidedApps = (data || []).map(a => ({ ...a, status: decided.get(a.id) }));
  }

  const reviewSelect = 'reference_number, full_name, category, loan_amount, created_at';
  let review = await supabase.from('applications').select(reviewSelect).eq('status', 'IN_REVIEW').eq('archived', false).order('created_at', { ascending: true });
  if (review.error) { // archived column not migrated yet
    review = await supabase.from('applications').select(reviewSelect).eq('status', 'IN_REVIEW').order('created_at', { ascending: true });
  }

  const newAgents = await supabase.from('agent_applications').select('id', { count: 'exact', head: true }).gte('created_at', since);
  const pendingAgents = await supabase.from('agent_applications').select('id', { count: 'exact', head: true }).not('status', 'in', '("APPROVED","REJECTED")');

  return {
    created: created.data || [],
    decided: decidedApps,
    review: review.data || [],
    newAgentApplications: newAgents.count || 0,
    pendingAgentApplications: pendingAgents.count || 0,
  };
}

const sum = rows => rows.reduce((t, r) => t + Number(r.loan_amount || 0), 0);

function tile(label, value, sub) {
  return `<td style="width:25%;padding:12px 10px;border:1px solid #e3e7e5;border-radius:6px;vertical-align:top">
    <div style="font-size:11px;color:#7a8481;text-transform:uppercase;letter-spacing:.4px">${email.esc(label)}</div>
    <div style="font-size:22px;font-weight:700;margin-top:3px">${email.esc(value)}</div>
    <div style="font-size:12px;color:#7a8481;margin-top:2px">${email.esc(sub || ' ')}</div>
  </td>`;
}

function renderSummary(data, now) {
  const approved = data.decided.filter(d => d.status === 'APPROVED');
  const rejected = data.decided.filter(d => d.status === 'REJECTED');
  const period = `${shortDate(new Date(now.getTime() - 7 * DAY))} - ${shortDate(now)}`;

  const byCategory = {};
  for (const a of data.created) {
    const k = CATEGORY_LABEL[a.category] || a.category || 'Other';
    byCategory[k] = byCategory[k] || { n: 0, amount: 0 };
    byCategory[k].n += 1;
    byCategory[k].amount += Number(a.loan_amount || 0);
  }
  const catRows = Object.entries(byCategory).sort((a, b) => b[1].n - a[1].n)
    .map(([k, v]) => `<tr><td style="padding:5px 0">${email.esc(k)}</td><td style="padding:5px 0;text-align:right">${v.n}</td><td style="padding:5px 0 5px 18px;text-align:right">${email.money(v.amount)}</td></tr>`).join('');

  const waiting = data.review.slice(0, 8).map(r => {
    const days = Math.max(0, Math.floor((now.getTime() - new Date(r.created_at).getTime()) / DAY));
    return `<tr><td style="padding:5px 12px 5px 0"><strong>${email.esc(r.reference_number)}</strong></td><td style="padding:5px 12px 5px 0">${email.esc(r.full_name)}</td><td style="padding:5px 12px 5px 0;text-align:right">${email.money(r.loan_amount)}</td><td style="padding:5px 0;text-align:right;color:${days >= 3 ? '#a02a20' : '#7a8481'}">${days === 0 ? 'today' : `${days}d`}</td></tr>`;
  }).join('');
  const more = data.review.length > 8 ? `<p style="color:#7a8481;font-size:12px;margin:6px 0 0">+ ${data.review.length - 8} more in the dashboard</p>` : '';

  const viaAgents = data.created.filter(a => a.agent_phone).length;

  const body = `
    <p style="margin:0 0 14px">Here's what happened in the last 7 days (${email.esc(period)}).</p>
    <table style="width:100%;border-collapse:separate;border-spacing:6px 0;margin:0 -6px 20px"><tr>
      ${tile('New applications', String(data.created.length), email.money(sum(data.created)))}
      ${tile('Approved', String(approved.length), email.money(sum(approved)))}
      ${tile('Rejected', String(rejected.length), email.money(sum(rejected)))}
      ${tile('Awaiting review', String(data.review.length), 'right now')}
    </tr></table>

    ${data.created.length ? `<h3 style="font-size:14px;margin:0 0 6px">New applications by category</h3>
    <table style="width:100%;border-collapse:collapse;margin-bottom:6px">${catRows}</table>
    ${viaAgents ? `<p style="color:#7a8481;font-size:12.5px;margin:0 0 20px">${viaAgents} of ${data.created.length} came through field agents.</p>` : '<div style="height:14px"></div>'}` : '<p style="color:#7a8481">No new applications this week.</p>'}

    ${data.review.length ? `<h3 style="font-size:14px;margin:0 0 6px">Waiting for a decision (oldest first)</h3>
    <table style="width:100%;border-collapse:collapse">${waiting}</table>${more}` : '<p style="color:#12633f"><strong>Nothing is waiting for review. All caught up.</strong></p>'}

    <h3 style="font-size:14px;margin:20px 0 6px">Field agents</h3>
    <p style="margin:0">${data.newAgentApplications} new agent application${data.newAgentApplications === 1 ? '' : 's'} this week · ${data.pendingAgentApplications} still waiting for a decision.</p>`;

  return {
    subject: `Soledd weekly summary: ${data.created.length} new, ${approved.length} approved, ${data.review.length} awaiting review`,
    html: email.layout('Weekly activity summary', body, { button: 'Open dashboard', badge: email.pill('WEEKLY SUMMARY', 'blue') }),
  };
}

/** Builds the summary from live data. @returns { subject, html } */
async function buildSummary(now = new Date()) {
  return renderSummary(await fetchData(now), now);
}

async function sendWeeklySummary() {
  const { subject, html } = await buildSummary();
  const to = await email.staffRecipients();
  return email.sendMail({ to, subject, html });
}

// ─── Scheduler ──────────────────────────────────────────────────────────────

async function tick() {
  if (!email.isConfigured()) return;
  const cfg = (await notificationSettings.getNotificationSettings()).weeklySummary;
  if (!cfg.enabled) return;

  const now = harareParts();
  const [h, m] = cfg.time.split(':').map(Number);
  if (now.weekday !== cfg.day || now.minutes < h * 60 + m) return;

  const last = await settingsService.getSetting(LAST_SENT_KEY);
  if (last?.date === now.dateKey) return;

  // Mark first: a failure or slow send must never turn into a retry storm.
  await settingsService.setSetting(LAST_SENT_KEY, { date: now.dateKey });
  const result = await sendWeeklySummary();
  console.log(`[WEEKLY_SUMMARY] ${DAY_NAMES[cfg.day]} ${cfg.time}: ${result.sent ? 'sent' : `not sent (${result.reason})`}`);
}

function start() {
  const flag = process.env.SCHEDULER;
  const enabled = flag === 'true' || (flag !== 'false' && !!process.env.RENDER);
  if (!enabled) return;
  const timer = setInterval(() => { tick().catch(err => console.error('[WEEKLY_SUMMARY] tick failed:', err.message)); }, 60 * 1000);
  timer.unref();
  console.log('[WEEKLY_SUMMARY] scheduler running (checks every minute)');
}

module.exports = { buildSummary, sendWeeklySummary, start, tick, harareParts };
