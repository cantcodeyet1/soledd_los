/**
 * keepAlive.service.js — keeps the free tiers awake.
 *
 *  - Render (free web service) sleeps after ~15 min without inbound traffic,
 *    and the next request pays a ~50s cold start. While the process is up it
 *    pings its own public URL (RENDER_EXTERNAL_URL, set automatically by
 *    Render) so it never goes idle.
 *  - Supabase (free) pauses a project after ~7 days of no activity. Every
 *    beat also runs a tiny query so the database always counts as active.
 *
 * A timer inside a sleeping process can't wake that process, so this is the
 * belt; the braces are a free external pinger (UptimeRobot / cron-job.org)
 * hitting GET /health/db every 5 minutes — see the README note in index.js.
 *
 * Never throws and never blocks the bot: every failure is caught and logged.
 */

'use strict';

const axios = require('axios');
const { supabase } = require('../models/supabase');

const INTERVAL_MIN = Number(process.env.KEEP_ALIVE_INTERVAL_MIN) || 4;

/** One lightweight DB round trip. Returns { ok, ms, error? }. */
async function pingDatabase() {
  const started = Date.now();
  try {
    const { error } = await supabase.from('customers').select('phone_number').limit(1);
    if (error) throw error;
    return { ok: true, ms: Date.now() - started };
  } catch (err) {
    return { ok: false, ms: Date.now() - started, error: err.message };
  }
}

async function pingSelf() {
  const base = process.env.RENDER_EXTERNAL_URL;
  if (!base) return;
  try {
    await axios.get(`${base.replace(/\/$/, '')}/health`, { timeout: 15000 });
  } catch (err) {
    console.warn('[KEEP_ALIVE] self-ping failed:', err.message);
  }
}

async function beat() {
  const db = await pingDatabase();
  if (!db.ok) console.warn('[KEEP_ALIVE] database ping failed:', db.error);
  await pingSelf();
}

/** Starts the heartbeat. Only runs on Render (or when KEEP_ALIVE=true). */
function start() {
  const flag = process.env.KEEP_ALIVE;
  const enabled = flag === 'true' || (flag !== 'false' && !!process.env.RENDER);
  if (!enabled) return;

  const timer = setInterval(() => { beat().catch(() => {}); }, INTERVAL_MIN * 60 * 1000);
  timer.unref();
  console.log(`[KEEP_ALIVE] heartbeat every ${INTERVAL_MIN} min (database${process.env.RENDER_EXTERNAL_URL ? ' + self-ping' : ''})`);
}

module.exports = { start, pingDatabase };
