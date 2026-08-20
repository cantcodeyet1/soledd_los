#!/usr/bin/env node
'use strict';

/**
 * tunnel.js — opens an ngrok tunnel to the locally running server
 * (npm start / npm run dev) and prints the webhook URL to paste into
 * the Meta App Dashboard.
 *
 * Run via: node scripts/tunnel.js
 */

require('dotenv').config();

async function main() {
  const authtoken = (process.env.NGROK_AUTHTOKEN || '').trim();
  if (!authtoken) {
    console.error('\n❌ NGROK_AUTHTOKEN not set in .env — get a free one at https://dashboard.ngrok.com/get-started/your-authtoken\n');
    process.exit(1);
  }

  const port = process.env.PORT || 3000;
  const ngrok = require('@ngrok/ngrok');

  console.log(`\n🔌 Starting ngrok tunnel on port ${port}...`);
  const listener = await ngrok.connect({ addr: Number(port), authtoken });
  const url = listener.url();

  console.log(`\n${'═'.repeat(60)}`);
  console.log('  🌐 Webhook URL — paste this into Meta App Dashboard:');
  console.log(`     ${url}/api/webhook`);
  console.log(`  🔑 Verify token: ${process.env.WEBHOOK_VERIFY_TOKEN}`);
  console.log(`${'═'.repeat(60)}\n`);
  console.log('Leave this running. Press Ctrl+C to stop the tunnel.\n');

  // Keep the process alive — ngrok.connect() runs the tunnel on a native
  // thread that doesn't register a libuv handle, so Node exits immediately
  // once main() returns unless something keeps an active timer open.
  setInterval(() => {}, 1 << 30);
}

main().catch((err) => {
  console.error('❌ ngrok failed to start:', err.message);
  process.exit(1);
});
