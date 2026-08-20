/**
 * settings.service.js — key-value settings store (Supabase `settings` table).
 * Used for configurable loan calculator rates.
 */

'use strict';

const { supabase } = require('../models/supabase');

async function getSetting(key) {
  const { data, error } = await supabase.from('settings').select('value').eq('key', key).single();
  if (error) return null;
  return data?.value ?? null;
}

async function setSetting(key, value) {
  const { error } = await supabase
    .from('settings')
    .upsert({ key, value, updated_at: new Date().toISOString() }, { onConflict: 'key' });
  if (error) throw new Error(error.message);
}

module.exports = { getSetting, setSetting };
