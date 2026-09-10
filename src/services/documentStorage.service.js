/**
 * documentStorage.service.js — downloads WhatsApp media and stores it in
 * the Supabase Storage `documents` bucket, linked to an application.
 */

'use strict';

const { supabase } = require('../models/supabase');
const whatsappService = require('./whatsapp.service');

const EXT_BY_MIME = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'application/pdf': 'pdf',
};

function slugify(label) {
  return label.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
}

/**
 * Downloads a WhatsApp media object and stores it against either a loan
 * application or an agent application (exactly one of applicationId /
 * agentApplicationId should be set). mediaId/mimeType come from the inbound
 * webhook message.
 */
async function storeDocument({ applicationId, agentApplicationId, label, mediaId }) {
  const { url, mimeType } = await whatsappService.getMediaUrl(mediaId);
  const buffer = await whatsappService.downloadMedia(url);

  const parentId = applicationId || agentApplicationId;
  const ext = EXT_BY_MIME[mimeType] || 'bin';
  const path = `${parentId}/${slugify(label)}-${Date.now()}.${ext}`;

  const { error: uploadError } = await supabase.storage.from('documents').upload(path, buffer, {
    contentType: mimeType,
    upsert: false,
  });
  if (uploadError) throw new Error(uploadError.message);

  const { data, error } = await supabase
    .from('documents')
    .insert([{
      application_id: applicationId || null,
      agent_application_id: agentApplicationId || null,
      label, storage_path: path, mime_type: mimeType,
    }])
    .select()
    .single();
  if (error) throw new Error(error.message);

  return data;
}

async function listDocuments(applicationId) {
  const { data, error } = await supabase
    .from('documents')
    .select('*')
    .eq('application_id', applicationId)
    .order('uploaded_at', { ascending: true });
  if (error) throw new Error(error.message);
  return data;
}

async function listAgentApplicationDocuments(agentApplicationId) {
  const { data, error } = await supabase
    .from('documents')
    .select('*')
    .eq('agent_application_id', agentApplicationId)
    .order('uploaded_at', { ascending: true });
  if (error) throw new Error(error.message);
  return data;
}

/** Signed URL for the dashboard to view/download a stored document. */
async function getSignedUrl(storagePath, expiresInSeconds = 300) {
  const { data, error } = await supabase.storage.from('documents').createSignedUrl(storagePath, expiresInSeconds);
  if (error) throw new Error(error.message);
  return data.signedUrl;
}

/** Removes the stored file and its row — used when an application is deleted. */
async function deleteDocument(documentId, storagePath) {
  if (storagePath) {
    const { error: rmErr } = await supabase.storage.from('documents').remove([storagePath]);
    if (rmErr) console.error('[DOCS] storage remove failed:', rmErr.message);
  }
  const { error } = await supabase.from('documents').delete().eq('id', documentId);
  if (error) throw new Error(error.message);
}

module.exports = { storeDocument, listDocuments, listAgentApplicationDocuments, getSignedUrl, deleteDocument };
