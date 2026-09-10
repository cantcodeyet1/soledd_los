import { useState } from 'react';
import { downloadBlob } from '../services/api';
import { Document } from '../types';

export function filenameFromPath(path: string): string {
  const parts = path.split('/');
  return parts[parts.length - 1];
}

/** "Certified copy of ID - Nyasha Mpofu.jpg" */
export function docDownloadName(label: string, owner: string, path: string): string {
  const ext = /\.([a-z0-9]+)$/i.exec(path)?.[1]?.toLowerCase() || '';
  const clean = (s: string) => (s || '').replace(/[^\w .'-]/g, '').replace(/\s+/g, ' ').trim();
  const base = [clean(label), clean(owner)].filter(Boolean).join(' - ') || 'document';
  return ext ? `${base}.${ext}` : base;
}

function isImageDoc(d: Document): boolean {
  return (d.mime_type || '').startsWith('image/');
}

async function downloadDocument(d: Document, name: string) {
  const res = await fetch(d.url);
  const blob = await res.blob();
  downloadBlob(blob, name);
}

export default function DocsSection({ documents, loading, downloadName, onDownloadZip }: {
  documents: Document[];
  loading: boolean;
  downloadName?: (d: Document) => string;
  onDownloadZip?: () => Promise<void> | void;
}) {
  const [lightboxDoc, setLightboxDoc] = useState<Document | null>(null);
  const [zipping, setZipping] = useState(false);
  const nameFor = (d: Document) => downloadName?.(d) || filenameFromPath(d.storage_path);

  async function downloadAll() {
    if (onDownloadZip) {
      setZipping(true);
      try { await onDownloadZip(); } finally { setZipping(false); }
      return;
    }
    for (const d of documents) {
      await downloadDocument(d, nameFor(d));
      await new Promise(r => setTimeout(r, 300)); // stagger so browsers don't block multiple downloads
    }
  }

  return (
    <div className="border-t border-rule pt-4 mb-6">
      <div className="flex items-center justify-between mb-3">
        <div className="text-xs uppercase tracking-wide text-text-dim font-semibold">Docs{documents.length > 0 ? ` (${documents.length})` : ''}</div>
        {documents.length > 1 && (
          <button onClick={downloadAll} disabled={zipping} className="text-xs font-semibold text-accent-bright hover:underline disabled:opacity-60">
            {zipping ? 'Zipping…' : onDownloadZip ? 'Download All (.zip)' : 'Download All'}
          </button>
        )}
      </div>
      {loading && (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
          {Array.from({ length: 2 }).map((_, i) => (
            <div key={i} className="h-9 rounded-lg skeleton animate-shimmer" />
          ))}
        </div>
      )}
      {!loading && documents.length === 0 && <div className="text-sm text-text-dim">No documents received yet.</div>}
      {!loading && documents.length > 0 && (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
          {documents.map(d => (
            <div key={d.id} className="flex items-center justify-between border border-rule rounded-lg px-3 py-2 text-sm hover:border-accent transition-colors gap-2">
              <button
                onClick={() => isImageDoc(d) ? setLightboxDoc(d) : window.open(d.url, '_blank', 'noopener')}
                className="flex-1 min-w-0 text-left"
                title={d.label}
              >
                <div className="text-[10px] uppercase tracking-wide text-text-dim">{d.label}</div>
                <div className="truncate">{filenameFromPath(d.storage_path)}</div>
              </button>
              <button onClick={() => downloadDocument(d, nameFor(d))} className="text-xs text-accent-bright font-semibold shrink-0">Download</button>
            </div>
          ))}
        </div>
      )}

      {lightboxDoc && <DocumentLightbox document={lightboxDoc} downloadName={nameFor(lightboxDoc)} onClose={() => setLightboxDoc(null)} />}
    </div>
  );
}

function DocumentLightbox({ document: doc, downloadName, onClose }: { document: Document; downloadName: string; onClose: () => void }) {
  return (
    <div className="fixed inset-0 bg-black/80 backdrop-blur-sm flex items-center justify-center z-[70] p-6 animate-overlayIn" onClick={onClose}>
      <div className="max-w-3xl max-h-[85vh] w-full flex flex-col items-center gap-3 animate-modalIn" onClick={e => e.stopPropagation()}>
        <img src={doc.url} alt={doc.label} className="max-w-full max-h-[70vh] rounded-lg object-contain bg-black/20" />
        <div className="flex items-center gap-3">
          <span className="text-white/80 text-sm">{downloadName}</span>
          <button onClick={() => downloadDocument(doc, downloadName)} className="bg-white text-ink text-xs font-semibold px-3 py-1.5 rounded-full hover:opacity-90">Download</button>
          <button onClick={onClose} className="text-white/80 hover:text-white text-xs font-semibold px-3 py-1.5 rounded-full border border-white/30">Close</button>
        </div>
      </div>
    </div>
  );
}
