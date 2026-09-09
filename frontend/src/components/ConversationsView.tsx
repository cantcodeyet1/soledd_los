import { useEffect, useMemo, useRef, useState } from 'react';
import { requestJson } from '../services/api';
import { Application, CATEGORY_LABELS, Conversation, ConversationStatus, CustomerRecord, Message } from '../types';

const LIST_REFRESH_MS = 30 * 1000;
const THREAD_REFRESH_MS = 15 * 1000;

const STATUS_META: Record<ConversationStatus, { label: string; pill: string; dot: string }> = {
  ABANDONED: { label: 'Abandoned', pill: 'bg-accent-wash text-accent-deep', dot: 'bg-accent-deep' },
  AWAITING_DOCS: { label: 'Awaiting Documents', pill: 'bg-warn-bg text-warn', dot: 'bg-warn' },
  IN_PROGRESS: { label: 'In Progress', pill: 'bg-info-bg text-info', dot: 'bg-info' },
  COMPLETED: { label: 'Completed', pill: 'bg-sage-bg text-sage', dot: 'bg-sage' },
};

const STATUS_CHIPS: { id: ConversationStatus | 'all'; label: string }[] = [
  { id: 'all', label: 'All' },
  { id: 'IN_PROGRESS', label: 'In Progress' },
  { id: 'AWAITING_DOCS', label: 'Awaiting Documents' },
  { id: 'ABANDONED', label: 'Abandoned' },
  { id: 'COMPLETED', label: 'Completed' },
];

function initialsFrom(name: string | null, phone: string): string {
  if (name) {
    const parts = name.trim().split(/\s+/).filter(Boolean);
    if (parts.length > 0) return (parts[0][0] + (parts[1]?.[0] || '')).toUpperCase();
  }
  return phone.slice(-2);
}

function relativeTime(iso: string | null): string {
  if (!iso) return '';
  const diffMs = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diffMs / 60000);
  if (mins < 1) return 'Just now';
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d ago`;
  return new Date(iso).toLocaleDateString('en-ZW', { day: 'numeric', month: 'short' });
}

function messageTime(iso: string): string {
  return new Date(iso).toLocaleTimeString('en-ZW', { hour: '2-digit', minute: '2-digit' });
}

function openWhatsApp(phone: string) {
  const clean = (phone || '').replace(/[^0-9]/g, '');
  window.open(`https://wa.me/${clean}`, '_blank', 'noopener');
}

interface ConversationsViewProps {
  onOpenApplication?: (id: string) => void;
}

export default function ConversationsView({ onOpenApplication }: ConversationsViewProps = {}) {
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState<ConversationStatus | 'all'>('all');
  const [search, setSearch] = useState('');
  const [selectedPhone, setSelectedPhone] = useState<string | null>(null);
  const [showProfile, setShowProfile] = useState(false);

  async function loadList() {
    const r = await requestJson('/conversations');
    setConversations(r.conversations);
    setLoading(false);
  }

  useEffect(() => {
    loadList();
    const interval = setInterval(loadList, LIST_REFRESH_MS);
    return () => clearInterval(interval);
  }, []);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return conversations.filter(c => {
      if (statusFilter !== 'all' && c.status !== statusFilter) return false;
      if (q && !(c.name || '').toLowerCase().includes(q) && !c.phone.includes(q)) return false;
      return true;
    });
  }, [conversations, statusFilter, search]);

  const selected = conversations.find(c => c.phone === selectedPhone) || null;

  const statusCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const c of conversations) counts[c.status] = (counts[c.status] || 0) + 1;
    return counts;
  }, [conversations]);

  return (
    <div>
      <div className="mb-5 sm:mb-6 flex items-end justify-between gap-4 flex-wrap">
        <div>
          <div className="text-xs font-bold text-accent uppercase tracking-wide mb-2.5">Chats</div>
          <h1 className="font-display font-bold text-3xl sm:text-4xl tracking-tight">Client Conversations</h1>
          <div className="text-sm text-text-dim mt-2">
            {statusCounts.AWAITING_DOCS || 0} awaiting documents · {statusCounts.ABANDONED || 0} abandoned · {conversations.length} total
          </div>
        </div>
      </div>

      <div className="border border-rule rounded-2xl overflow-hidden bg-paper" style={{ height: 'calc(100vh - 210px)', minHeight: 640 }}>
        <div className="flex h-full">
          <div className="w-full sm:w-[320px] shrink-0 border-r border-rule flex flex-col h-full">
            <div className="p-3 border-b border-rule">
              <input
                placeholder="Search name or phone…"
                value={search}
                onChange={e => setSearch(e.target.value)}
                className="w-full border border-rule rounded-full px-4 py-2 text-xs focus:outline-none focus:border-accent bg-card mb-2.5"
              />
              <div className="flex flex-wrap gap-1.5">
                {STATUS_CHIPS.map(c => (
                  <button
                    key={c.id}
                    onClick={() => setStatusFilter(c.id)}
                    className={`shrink-0 px-2.5 py-1 text-[11px] font-semibold rounded-full border transition-colors duration-150 ${
                      statusFilter === c.id ? 'bg-solid border-solid text-white' : 'border-rule text-text-dim hover:border-ink'
                    }`}
                  >
                    {c.label}
                  </button>
                ))}
              </div>
            </div>

            <div className="flex-1 overflow-y-auto no-scrollbar">
              {loading && (
                <div className="p-3 flex flex-col gap-2">
                  {Array.from({ length: 6 }).map((_, i) => <div key={i} className="h-14 rounded-lg skeleton animate-shimmer" />)}
                </div>
              )}
              {!loading && filtered.length === 0 && <div className="text-center py-12 text-text-dim text-sm px-4">No conversations match these filters</div>}
              {!loading && filtered.map(c => (
                <button
                  key={c.phone}
                  onClick={() => setSelectedPhone(c.phone)}
                  className={`w-full text-left px-3.5 py-3 border-b border-rule flex items-start gap-2.5 transition-colors ${
                    selectedPhone === c.phone ? 'bg-card-tint' : 'hover:bg-card-tint'
                  }`}
                >
                  <div className="w-9 h-9 rounded-full bg-info-bg text-info flex items-center justify-center text-xs font-bold shrink-0">
                    {initialsFrom(c.name, c.phone)}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-semibold text-sm truncate">{c.name || c.phone}</span>
                      <span className="text-[10.5px] text-text-dim shrink-0">{relativeTime(c.lastMessageAt)}</span>
                    </div>
                    <div className="text-xs text-text-dim truncate mt-0.5">
                      {c.lastMessageDirection === 'outbound' && <span className="text-text-dim">↩ </span>}
                      {c.lastMessageText || 'No messages yet'}
                    </div>
                    <span className={`inline-flex items-center gap-1 mt-1.5 text-[9.5px] font-bold uppercase tracking-wide px-2 py-0.5 rounded-full ${STATUS_META[c.status].pill}`}>
                      {STATUS_META[c.status].label}
                    </span>
                  </div>
                </button>
              ))}
            </div>
          </div>

          <div className="hidden sm:flex flex-1 flex-col h-full min-w-0">
            {!selected && (
              <div className="flex-1 flex items-center justify-center text-text-dim text-sm">Select a conversation to view messages</div>
            )}
            {selected && (
              <ChatThread
                key={selected.phone}
                conversation={selected}
                showingProfile={showProfile}
                onOpenProfile={() => setShowProfile(true)}
              />
            )}
          </div>

          {showProfile && selected && (
            <ProfileSidePanel
              conversation={selected}
              onClose={() => setShowProfile(false)}
              onOpenApplication={onOpenApplication}
            />
          )}
        </div>
      </div>
    </div>
  );
}

function ChatThread({ conversation, onOpenProfile, showingProfile }: { conversation: Conversation; onOpenProfile: () => void; showingProfile: boolean }) {
  const [messages, setMessages] = useState<Message[] | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);

  async function load() {
    const r = await requestJson(`/conversations/${encodeURIComponent(conversation.phone)}/messages`);
    setMessages(r.messages);
  }

  useEffect(() => {
    setMessages(null);
    load();
    const interval = setInterval(load, THREAD_REFRESH_MS);
    return () => clearInterval(interval);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [conversation.phone]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ block: 'end' });
  }, [messages]);

  return (
    <>
      <button
        onClick={onOpenProfile}
        className={`flex items-center gap-2.5 px-4 py-3 border-b border-rule text-left hover:bg-card-tint transition-colors shrink-0 ${showingProfile ? 'bg-card-tint' : ''}`}
      >
        <div className="w-8 h-8 rounded-full bg-info-bg text-info flex items-center justify-center text-xs font-bold shrink-0">
          {initialsFrom(conversation.name, conversation.phone)}
        </div>
        <div className="min-w-0">
          <div className="font-semibold text-sm truncate">{conversation.name || conversation.phone}</div>
          <div className="text-[11px] text-text-dim font-mono-brand truncate">{conversation.phone}</div>
        </div>
      </button>

      <div className="flex-1 overflow-y-auto no-scrollbar px-4 py-4 flex flex-col gap-2">
        {messages === null && (
          <div className="flex flex-col gap-2">
            {Array.from({ length: 4 }).map((_, i) => <div key={i} className={`h-10 rounded-2xl skeleton animate-shimmer ${i % 2 ? 'w-2/3 self-end' : 'w-1/2'}`} />)}
          </div>
        )}
        {messages !== null && messages.length === 0 && <div className="text-center text-text-dim text-sm py-8">No messages yet</div>}
        {messages !== null && messages.map(m => (
          <div key={m.id} className={`max-w-[75%] rounded-2xl px-3.5 py-2.5 text-sm ${m.direction === 'inbound' ? 'self-start bg-card-tint' : 'self-end bg-solid text-white'}`}>
            <div className="whitespace-pre-wrap break-words">{m.message_text}</div>
            <div className={`text-[10px] mt-1 ${m.direction === 'inbound' ? 'text-text-dim' : 'text-white/70'}`}>{messageTime(m.timestamp)}</div>
          </div>
        ))}
        <div ref={bottomRef} />
      </div>
    </>
  );
}

function ProfileSidePanel({
  conversation, onClose, onOpenApplication,
}: {
  conversation: Conversation;
  onClose: () => void;
  onOpenApplication?: (id: string) => void;
}) {
  const [customer, setCustomer] = useState<CustomerRecord | null>(null);
  const [applications, setApplications] = useState<Application[] | null>(null);

  useEffect(() => {
    setCustomer(null);
    setApplications(null);
    requestJson(`/conversations/${encodeURIComponent(conversation.phone)}/messages`).then(r => setCustomer(r.customer));
    requestJson(`/applications?applicant_phone=${encodeURIComponent(conversation.phone)}`).then(r => setApplications(r.applications));
  }, [conversation.phone]);

  return (
    <div className="hidden sm:flex flex-col w-[340px] shrink-0 border-l border-rule h-full overflow-y-auto no-scrollbar p-6 animate-panelIn">
      <div className="flex justify-between items-start mb-6">
        <div className="flex items-center gap-3 min-w-0">
          <div className="w-11 h-11 rounded-full bg-info-bg text-info flex items-center justify-center text-sm font-bold shrink-0">
            {initialsFrom(conversation.name, conversation.phone)}
          </div>
          <div className="min-w-0">
            <div className="font-display font-bold text-base truncate">{conversation.name || 'Unnamed'}</div>
            <div className="text-xs text-text-dim font-mono-brand truncate">{conversation.phone}</div>
          </div>
        </div>
        <button onClick={onClose} className="text-text-dim hover:text-ink text-2xl leading-none transition-colors shrink-0">×</button>
      </div>

      <button
        onClick={() => openWhatsApp(conversation.phone)}
        className="flex items-center justify-center gap-2 w-full mb-6 py-2.5 rounded-full bg-sage text-white text-sm font-semibold hover:opacity-90 transition-opacity"
      >
        <svg width="15" height="15" viewBox="0 0 24 24" fill="currentColor"><path d="M17.5 14.4c-.3-.1-1.7-.9-2-1-.3-.1-.5-.1-.6.1-.2.3-.7 1-.9 1.2-.2.2-.3.2-.6.1-.3-.1-1.3-.5-2.5-1.6-.9-.8-1.5-1.8-1.7-2.1-.2-.3 0-.5.1-.6.1-.1.3-.3.4-.5.1-.1.2-.3.3-.4.1-.2 0-.4 0-.5C10 9 9.5 7.7 9.2 7.2c-.2-.5-.5-.4-.6-.4h-.5c-.2 0-.5.1-.7.3-.3.3-1 1-1 2.4s1 2.8 1.2 3c.1.2 2.1 3.2 5 4.5.7.3 1.3.5 1.7.6.7.2 1.4.2 1.9.1.6-.1 1.7-.7 2-1.4.2-.6.2-1.2.2-1.3-.1-.2-.3-.2-.6-.4z"/><path d="M12 2C6.5 2 2 6.5 2 12c0 1.8.5 3.5 1.3 5L2 22l5.2-1.4c1.5.8 3.1 1.2 4.8 1.2 5.5 0 10-4.5 10-10S17.5 2 12 2zm0 18.2c-1.6 0-3.1-.4-4.5-1.3l-.3-.2-3.1.8.8-3-.2-.3C4 14.7 3.6 13.4 3.6 12c0-4.6 3.8-8.4 8.4-8.4s8.4 3.8 8.4 8.4-3.8 8.2-8.4 8.2z"/></svg>
        Chat Now
      </button>

      <div className="flex items-center gap-2 mb-6 flex-wrap">
        <span className={`text-[10.5px] font-bold uppercase tracking-wide px-2.5 py-1 rounded-full ${STATUS_META[conversation.status].pill}`}>
          {STATUS_META[conversation.status].label}
        </span>
        {conversation.botPaused && <span className="text-[10.5px] font-bold uppercase tracking-wide px-2.5 py-1 rounded-full bg-slate-bg text-slate">Bot Paused</span>}
      </div>

      <div className="grid grid-cols-2 gap-3 mb-6">
        <SidebarField label="Customer Since" value={customer ? new Date(customer.created_at).toLocaleDateString('en-ZW', { day: 'numeric', month: 'short', year: 'numeric' }) : '…'} />
        <SidebarField label="Last Active" value={relativeTime(conversation.lastMessageAt) || '—'} />
        <SidebarField label="Current Flow" value={conversation.flow || 'None'} />
        <SidebarField label="Current Step" value={conversation.step || '—'} />
      </div>

      <div className="border-t border-rule pt-4">
        <div className="text-xs uppercase tracking-wide text-text-dim mb-3 font-semibold">Applications</div>
        {applications === null && (
          <div className="flex flex-col gap-2">
            {Array.from({ length: 2 }).map((_, i) => <div key={i} className="h-14 rounded-lg skeleton animate-shimmer" />)}
          </div>
        )}
        {applications !== null && applications.length === 0 && <div className="text-sm text-text-dim">No applications from this number yet.</div>}
        {applications !== null && applications.map(a => (
          <button
            key={a.id}
            onClick={() => onOpenApplication?.(a.id)}
            className="w-full text-left border border-rule rounded-xl p-3 mb-2 hover:border-ink hover:bg-card-tint transition-colors"
          >
            <div className="flex justify-between items-start gap-2 mb-1.5">
              <span className="font-semibold text-sm">{a.full_name}</span>
              <span className="font-mono-brand text-[10.5px] text-text-dim shrink-0">{a.reference_number}</span>
            </div>
            <div className="flex items-center gap-2 flex-wrap">
              <span className="text-[10.5px] px-2 py-0.5 rounded-full bg-info-bg text-info">{CATEGORY_LABELS[a.category]}</span>
              <span className="text-[10.5px] font-bold uppercase px-2 py-0.5 rounded-full bg-card-tint text-text-dim">{a.status.replace('_', ' ')}</span>
              <span className="font-mono-brand text-xs font-semibold ml-auto">${Number(a.loan_amount).toFixed(2)}</span>
            </div>
          </button>
        ))}
      </div>
    </div>
  );
}

function SidebarField({ label, value }: { label: string; value: string }) {
  return (
    <div className="bg-paper rounded-xl p-3">
      <div className="text-[10px] uppercase tracking-wide text-text-dim mb-1">{label}</div>
      <div className="font-semibold text-sm truncate">{value}</div>
    </div>
  );
}
