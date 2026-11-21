/**
 * Sends one of every email type (sample data, plus this week's real weekly
 * summary) to a single address, so the layouts can be checked.
 *   node scripts/send_test_emails.js you@example.com
 */
require('dotenv').config();
const email = require('../src/services/email.service');
const weeklySummary = require('../src/services/weeklySummary.service');

(async () => {
  const to = process.argv[2];
  if (!to) { console.error('usage: node scripts/send_test_emails.js <email>'); process.exit(1); }
  if (!email.isConfigured()) { console.error('Mailjet env vars are not set'); process.exit(1); }
  const summary = await weeklySummary.buildSummary();
  const results = await email.sendTestEmails(to, [{ label: 'Weekly summary', ...summary }]);
  for (const r of results) console.log(r.sent ? 'sent   ' : 'FAILED ', r.label, r.reason || '');
  process.exit(results.every(r => r.sent) ? 0 : 2);
})().catch(e => { console.error(e); process.exit(1); });
