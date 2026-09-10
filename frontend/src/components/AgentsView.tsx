import { useEffect, useMemo, useRef, useState } from 'react';
import { requestJson, requestBlob, downloadBlob } from '../services/api';
import { Agent, AgentApplication, Application, CATEGORY_LABELS, Document as DocType } from '../types';
import ViewToggle, { ViewMode } from './ViewToggle';
import DocsSection from './DocsSection';

function openWhatsApp(phone: string, message = '') {
  const clean = (phone || '').replace(/[^0-9]/g, '');
  const text = message.trim() ? `?text=${encodeURIComponent(message.trim())}` : '';
  window.open(`https://wa.me/${clean}${text}`, '_blank', 'noopener');
}

function WhatsAppChatButton({ phone, message, label = 'Open WhatsApp Chat' }: { phone: string; message?: string; label?: string }) {
  return (
    <button
      onClick={() => openWhatsApp(phone, message)}
      className="bg-[#25D366] hover:opacity-90 text-white text-sm font-semibold px-4 py-2 rounded-lg flex items-center justify-center gap-2 transition-opacity"
    >
      <svg width="15" height="15" viewBox="0 0 20 20" fill="currentColor"><path d="M10 2a8 8 0 0 0-6.9 12l-1 3.6 3.7-1A8 8 0 1 0 10 2Zm4.6 11.4c-.2.5-1.1 1-1.5 1-.4 0-.9.1-2.9-.8-2.4-1-4-3.4-4.1-3.6-.1-.2-1-1.3-1-2.5s.6-1.8.9-2c.2-.2.5-.3.7-.3h.5c.2 0 .4 0 .6.4.2.5.7 1.7.8 1.8.1.2.1.3 0 .5-.1.2-.2.3-.3.5-.2.2-.3.3-.1.6.2.3.8 1.3 1.7 2.1 1.2 1 2.1 1.4 2.4 1.5.3.1.5.1.6-.1.2-.2.7-.8.9-1 .2-.3.4-.2.6-.1l1.6.8c.2.1.3.2.4.3.1.2.1.7-.1 1.2Z"/></svg>
      {label}
    </button>
  );
}

type AgentStatus = 'PENDING' | 'ACTIVE' | 'DEACTIVATED';

function statusOf(a: Agent): AgentStatus {
  if (!a.verified) return 'PENDING';
  return a.active ? 'ACTIVE' : 'DEACTIVATED';
}

const STATUS_OPTIONS: { value: AgentStatus; label: string }[] = [
  { value: 'PENDING', label: 'Pending OTP' },
  { value: 'ACTIVE', label: 'Active' },
  { value: 'DEACTIVATED', label: 'Deactivated' },
];

const STATUS_PILL: Record<AgentStatus, string> = {
  PENDING: 'bg-slate-bg text-slate',
  ACTIVE: 'bg-sage-bg text-sage',
  DEACTIVATED: 'bg-accent-wash text-accent-deep',
};

const STATUS_CHIPS: { id: string; label: string }[] = [
  { id: 'all', label: 'All' },
  { id: 'ACTIVE', label: 'Active' },
  { id: 'PENDING', label: 'Pending OTP' },
  { id: 'DEACTIVATED', label: 'Deactivated' },
];

export default function AgentsView() {
  const [agents, setAgents] = useState<Agent[]>([]);
  const [loading, setLoading] = useState(true);
  const [showAdd, setShowAdd] = useState(false);
  const [phone, setPhone] = useState('');
  const [name, setName] = useState('');
  const [region, setRegion] = useState('');
  const [saving, setSaving] = useState(false);
  const [selected, setSelected] = useState<Agent | null>(null);
  const [viewMode, setViewMode] = useState<ViewMode>(() => (localStorage.getItem('soledd_agents_view') as ViewMode) || 'grid');

  const [statuses, setStatuses] = useState<string[]>([]);
  const [regions, setRegions] = useState<string[]>([]);
  const [search, setSearch] = useState('');

  function setMode(m: ViewMode) {
    setViewMode(m);
    localStorage.setItem('soledd_agents_view', m);
  }

  async function load() {
    const r = await requestJson('/agents');
    setAgents(r.agents);
    setLoading(false);
    setSelected(prev => {
      if (!prev) return prev;
      return r.agents.find((a: Agent) => a.id === prev.id) || null;
    });
  }

  useEffect(() => { load(); }, []);

  const allRegions = useMemo(() => Array.from(new Set(agents.map(a => a.region).filter(Boolean))) as string[], [agents]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return agents.filter(a => {
      if (statuses.length > 0 && !statuses.includes(statusOf(a))) return false;
      if (regions.length > 0 && !(a.region && regions.includes(a.region))) return false;
      if (q && !(a.name || '').toLowerCase().includes(q) && !a.phone_number.includes(q)) return false;
      return true;
    });
  }, [agents, statuses, regions, search]);

  const advancedActive = statuses.length > 1 || regions.length > 0;

  function clearAdvanced() {
    setStatuses([]);
    setRegions([]);
  }

  const stats = useMemo(() => ({
    active: agents.filter(a => statusOf(a) === 'ACTIVE').length,
    pending: agents.filter(a => statusOf(a) === 'PENDING').length,
    totalRemuneration: agents.reduce((sum, a) => sum + a.performance.totalRemuneration, 0),
  }), [agents]);

  async function addAgent(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    await requestJson('/agents', { method: 'POST', body: JSON.stringify({ phoneNumber: phone, name, region }) });
    setSaving(false);
    setShowAdd(false);
    setPhone(''); setName(''); setRegion('');
    await load();
  }

  async function resendOtp(id: string) {
    await requestJson(`/agents/${id}/resend-otp`, { method: 'POST' });
    alert('New code sent.');
  }

  async function toggleActive(agent: Agent) {
    await requestJson(`/agents/${agent.id}`, { method: 'PATCH', body: JSON.stringify({ active: !agent.active }) });
    await load();
  }

  async function remove(id: string) {
    if (!confirm('Remove this agent?')) return;
    await requestJson(`/agents/${id}`, { method: 'DELETE' });
    setSelected(null);
    await load();
  }

  async function updateAgentDetails(id: string, updates: { phoneNumber?: string; name?: string; region?: string }) {
    await requestJson(`/agents/${id}`, { method: 'PATCH', body: JSON.stringify(updates) });
    await load();
  }

  async function exportExcel() {
    const blob = await requestBlob('/agents/export/excel');
    downloadBlob(blob, `soledd_field_agents_${new Date().toISOString().slice(0, 10)}.xlsx`);
  }

  return (
    <div>
      {/* Hero */}
      <div className="flex flex-col sm:flex-row sm:items-end gap-8 sm:gap-14 mb-10 sm:mb-14">
        <div>
          <div className="text-xs font-bold text-accent uppercase tracking-wide mb-2.5">Field Agents</div>
          <div className="font-display font-bold leading-none tracking-tight" style={{ fontSize: 'clamp(44px, 9vw, 76px)' }}>
            {stats.active}<span className="text-2xl sm:text-3xl font-semibold text-text-dim ml-1.5">active field agents</span>
          </div>
          <div className="text-sm text-text-dim mt-2">{agents.length} total, OTP-verified via WhatsApp</div>
        </div>
        <div className="flex gap-6 sm:gap-9 pb-1 flex-wrap">
          <MiniStat value={String(stats.pending)} label="Pending OTP" color={stats.pending > 0 ? 'text-warn' : undefined} />
          <MiniStat value={String(allRegions.length)} label="Regions covered" />
          <MiniStat value={`$${stats.totalRemuneration.toFixed(2)}`} label="Remuneration paid" />
        </div>
        <div className="sm:ml-auto flex gap-2">
          <button
            onClick={exportExcel}
            className="border border-rule hover:border-ink text-sm font-semibold px-4 py-2.5 rounded-lg transition-colors whitespace-nowrap"
          >
            Export to Excel
          </button>
          <button
            onClick={() => setShowAdd(o => !o)}
            className="bg-accent hover:bg-accent-deep text-white text-sm font-semibold px-4 py-2.5 rounded-lg transition-colors whitespace-nowrap"
          >
            {showAdd ? 'Cancel' : '+ Add Agent'}
          </button>
        </div>
      </div>

      {showAdd && (
        <form onSubmit={addAgent} className="border border-rule rounded-2xl p-5 mb-6 flex flex-wrap gap-3 items-end bg-paper">
          <div className="flex-1 min-w-[160px]">
            <label className="block text-[11px] uppercase tracking-wide text-text-dim mb-1.5">Phone (WhatsApp)</label>
            <input required value={phone} onChange={e => setPhone(e.target.value)} placeholder="263771234567" className="border border-rule rounded-lg px-3 py-2 text-sm w-full bg-card" />
          </div>
          <div className="flex-1 min-w-[140px]">
            <label className="block text-[11px] uppercase tracking-wide text-text-dim mb-1.5">Name</label>
            <input value={name} onChange={e => setName(e.target.value)} className="border border-rule rounded-lg px-3 py-2 text-sm w-full bg-card" />
          </div>
          <div className="flex-1 min-w-[140px]">
            <label className="block text-[11px] uppercase tracking-wide text-text-dim mb-1.5">Region</label>
            <input value={region} onChange={e => setRegion(e.target.value)} className="border border-rule rounded-lg px-3 py-2 text-sm w-full bg-card" />
          </div>
          <button type="submit" disabled={saving} className="bg-solid hover:bg-solid-hover text-white text-sm font-semibold px-4 py-2 rounded-lg disabled:opacity-60 transition-colors">
            {saving ? 'Sending code…' : 'Send OTP'}
          </button>
        </form>
      )}

      {/* Toolbar */}
      <div className="flex flex-col sm:flex-row sm:items-center gap-4 mb-5">
        <h2 className="font-display font-bold text-lg">All Agents</h2>

        <div className="flex flex-wrap gap-2">
          {STATUS_CHIPS.map(c => {
            const active = c.id === 'all' ? statuses.length === 0 : statuses.length === 1 && statuses[0] === c.id;
            return (
              <button
                key={c.id}
                onClick={() => setStatuses(c.id === 'all' ? [] : [c.id])}
                className={`shrink-0 px-3.5 py-1.5 text-xs font-semibold rounded-full border transition-colors duration-150 ${
                  active ? 'bg-solid border-solid text-white' : 'border-rule text-text-dim hover:border-ink'
                }`}
              >
                {c.label}
              </button>
            );
          })}
          <AgentAdvancedFilter
            statuses={statuses} onStatusesChange={setStatuses}
            regions={regions} onRegionsChange={setRegions}
            allRegions={allRegions}
            active={advancedActive}
          />
        </div>

        <div className="flex items-center gap-2 sm:ml-auto flex-wrap">
          <input
            placeholder="Search name or phone…"
            value={search}
            onChange={e => setSearch(e.target.value)}
            className="border border-rule rounded-full px-4 py-2 text-xs w-full sm:w-56 focus:outline-none focus:border-accent bg-card"
          />
          <ViewToggle mode={viewMode} onChange={setMode} />
        </div>
      </div>

      {advancedActive && (
        <div className="flex items-center gap-2 mb-5 -mt-2 flex-wrap">
          <span className="text-xs text-text-dim">Showing:</span>
          {statuses.length > 1 && statuses.map(s => (
            <span key={s} className="text-xs font-semibold px-2.5 py-1 rounded-full bg-info-bg text-info">
              {STATUS_OPTIONS.find(o => o.value === s)?.label}
            </span>
          ))}
          {regions.map(r => (
            <span key={r} className="text-xs font-semibold px-2.5 py-1 rounded-full bg-info-bg text-info">{r}</span>
          ))}
          <button onClick={clearAdvanced} className="text-xs text-accent font-semibold hover:underline">Clear</button>
        </div>
      )}

      {loading && <AgentsSkeleton mode={viewMode} />}

      {!loading && filtered.length === 0 && <div className="text-center py-16 text-text-dim text-sm">No agents match these filters</div>}

      {!loading && filtered.length > 0 && viewMode === 'grid' && (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {filtered.map(a => {
            const status = statusOf(a);
            return (
              <button
                key={a.id}
                onClick={() => setSelected(a)}
                className="text-left border border-rule rounded-2xl p-5 bg-card-tint flex flex-col gap-3.5 transition-all duration-150 hover:border-ink hover:-translate-y-0.5 hover:shadow-sm"
              >
                <div className="flex justify-between items-start gap-2">
                  <div>
                    <div className="font-display font-bold text-base">{a.name || 'Unnamed Agent'}</div>
                    <div className="text-xs text-text-dim mt-0.5 font-mono-brand">{a.phone_number}</div>
                  </div>
                  <span className="text-[11px] text-text-dim shrink-0">{a.region || '-'}</span>
                </div>
                <span className={`inline-flex w-fit items-center text-[10.5px] font-bold uppercase tracking-wide px-2.5 py-1 rounded-full ${STATUS_PILL[status]}`}>
                  {status === 'PENDING' ? 'Pending OTP' : status === 'ACTIVE' ? 'Active' : 'Deactivated'}
                </span>
                <div className="flex justify-between items-center border-t border-rule pt-3.5 text-sm">
                  <span className="font-mono-brand font-bold">{a.performance.total} loans</span>
                  <span className="font-mono-brand text-text-dim">{a.performance.approvalRate}% approved</span>
                </div>
                <div className="flex justify-between items-center text-xs" onClick={e => e.stopPropagation()}>
                  <span className="text-text-dim">${a.performance.totalRemuneration.toFixed(2)} remuneration</span>
                  <span className="flex gap-3">
                    {status === 'PENDING' && <button onClick={() => resendOtp(a.id)} className="text-accent-bright font-semibold">Resend Code</button>}
                    <button onClick={() => openWhatsApp(a.phone_number)} className="text-sage font-semibold">Chat</button>
                  </span>
                </div>
              </button>
            );
          })}
        </div>
      )}

      {!loading && filtered.length > 0 && viewMode === 'list' && (
        <div className="border border-rule rounded-2xl overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm min-w-[760px]">
              <thead>
                <tr className="text-left text-[10.5px] uppercase tracking-wide text-text-dim border-b border-rule">
                  <th className="px-5 py-3">Name</th><th className="px-5 py-3">Phone</th><th className="px-5 py-3">Region</th>
                  <th className="px-5 py-3">Status</th><th className="px-5 py-3">Loans</th><th className="px-5 py-3">Approval Rate</th>
                  <th className="px-5 py-3">Remuneration</th><th className="px-5 py-3"></th>
                </tr>
              </thead>
              <tbody>
                {filtered.map(a => {
                  const status = statusOf(a);
                  return (
                    <tr key={a.id} onClick={() => setSelected(a)} className="border-b border-rule last:border-0 cursor-pointer hover:bg-paper">
                      <td className="px-5 py-3.5 font-semibold">{a.name || '-'}</td>
                      <td className="px-5 py-3.5 font-mono-brand text-text-dim">{a.phone_number}</td>
                      <td className="px-5 py-3.5">{a.region || '-'}</td>
                      <td className="px-5 py-3.5">
                        <span className={`text-[10.5px] font-bold uppercase px-2.5 py-1 rounded-full ${STATUS_PILL[status]}`}>
                          {status === 'PENDING' ? 'Pending OTP' : status === 'ACTIVE' ? 'Active' : 'Deactivated'}
                        </span>
                      </td>
                      <td className="px-5 py-3.5 font-mono-brand">{a.performance.total}</td>
                      <td className="px-5 py-3.5 font-mono-brand">{a.performance.approvalRate}%</td>
                      <td className="px-5 py-3.5 font-mono-brand font-semibold">${a.performance.totalRemuneration.toFixed(2)}</td>
                      <td className="px-5 py-3.5">
                        <div className="flex gap-2.5" onClick={e => e.stopPropagation()}>
                          <button onClick={() => openWhatsApp(a.phone_number)} className="text-xs text-sage font-semibold">Chat</button>
                          {!a.verified && <button onClick={() => resendOtp(a.id)} className="text-xs text-accent-bright font-semibold">Resend Code</button>}
                          {a.verified && <button onClick={() => toggleActive(a)} className="text-xs text-ink font-semibold">{a.active ? 'Deactivate' : 'Activate'}</button>}
                          <button onClick={() => remove(a.id)} className="text-xs text-accent font-semibold">Delete</button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <div className="px-5 py-3 text-xs text-text-dim border-t border-rule">Showing {filtered.length} agent{filtered.length === 1 ? '' : 's'}</div>
        </div>
      )}

      {selected && (
        <AgentDetail
          agent={selected}
          onClose={() => setSelected(null)}
          onToggleActive={() => toggleActive(selected)}
          onDelete={() => remove(selected.id)}
          onResendOtp={() => resendOtp(selected.id)}
          onSaveDetails={updates => updateAgentDetails(selected.id, updates)}
        />
      )}

      <AgentApplicationsSection />
    </div>
  );
}

function AgentAdvancedFilter({
  statuses, onStatusesChange,
  regions, onRegionsChange,
  allRegions, active,
}: {
  statuses: string[]; onStatusesChange: (s: string[]) => void;
  regions: string[]; onRegionsChange: (r: string[]) => void;
  allRegions: string[]; active: boolean;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function onClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener('mousedown', onClick);
    return () => document.removeEventListener('mousedown', onClick);
  }, []);

  function toggleStatus(id: string) {
    onStatusesChange(statuses.includes(id) ? statuses.filter(s => s !== id) : [...statuses, id]);
  }
  function toggleRegion(r: string) {
    onRegionsChange(regions.includes(r) ? regions.filter(x => x !== r) : [...regions, r]);
  }
  function clearAll() {
    onStatusesChange([]);
    onRegionsChange([]);
  }

  return (
    <div className="relative shrink-0" ref={ref}>
      <button
        onClick={() => setOpen(o => !o)}
        aria-label="Advanced filter"
        className={`flex items-center gap-1.5 px-3.5 py-1.5 text-xs font-semibold rounded-full border transition-colors duration-150 ${
          active ? 'border-accent-bright text-accent-bright' : 'border-rule text-text-dim hover:border-ink'
        }`}
      >
        <svg width="12" height="12" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round"><path d="M3 5h14M6 10h8M9 15h2"/></svg>
        Advanced
      </button>
      {open && (
        <div className="absolute left-0 mt-2 w-64 bg-card border border-rule rounded-xl shadow-lg z-20 origin-top-left animate-modalIn p-3">
          <div className="text-[10px] uppercase tracking-wide text-text-dim font-semibold px-1 mb-1.5">Status (select any)</div>
          <div className="flex flex-wrap gap-1.5 px-1 mb-3 pb-3 border-b border-rule">
            {STATUS_OPTIONS.map(o => (
              <button
                key={o.value}
                onClick={() => toggleStatus(o.value)}
                className={`text-xs font-semibold px-2.5 py-1 rounded-full border transition-colors ${
                  statuses.includes(o.value) ? 'bg-solid border-solid text-white' : 'border-rule text-text-dim hover:border-ink'
                }`}
              >
                {o.label}
              </button>
            ))}
          </div>

          <div className="text-[10px] uppercase tracking-wide text-text-dim font-semibold px-1 mb-1.5">Region</div>
          {allRegions.length === 0 && <div className="text-xs text-text-dim px-1 py-1">No regions recorded yet</div>}
          {allRegions.map(r => (
            <label key={r} className="flex items-center gap-2.5 px-1 py-1.5 text-sm cursor-pointer hover:bg-paper rounded-lg">
              <input type="checkbox" checked={regions.includes(r)} onChange={() => toggleRegion(r)} className="accent-accent-bright w-4 h-4" />
              {r}
            </label>
          ))}

          <div className="flex justify-between items-center mt-3 pt-2 border-t border-rule px-1">
            <button onClick={clearAll} className="text-xs text-text-dim hover:text-accent">Clear all</button>
            <button onClick={() => setOpen(false)} className="text-xs font-semibold text-accent-bright">Done</button>
          </div>
        </div>
      )}
    </div>
  );
}

function AgentsSkeleton({ mode }: { mode: ViewMode }) {
  if (mode === 'list') {
    return (
      <div className="border border-rule rounded-2xl overflow-hidden">
        {Array.from({ length: 5 }).map((_, i) => (
          <div key={i} className="h-12 border-b border-rule last:border-0 flex items-center px-5">
            <div className="h-3.5 w-40 rounded skeleton animate-shimmer" />
          </div>
        ))}
      </div>
    );
  }
  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
      {Array.from({ length: 6 }).map((_, i) => (
        <div key={i} className="border border-rule rounded-2xl p-5 bg-card-tint flex flex-col gap-3.5" style={{ animationDelay: `${i * 60}ms` }}>
          <div className="h-4 w-2/3 rounded skeleton animate-shimmer" />
          <div className="h-3 w-1/3 rounded skeleton animate-shimmer" />
          <div className="h-5 w-20 rounded-full skeleton animate-shimmer" />
          <div className="h-9 w-full rounded skeleton animate-shimmer" />
        </div>
      ))}
    </div>
  );
}

function AgentDetail({ agent, onClose, onToggleActive, onDelete, onResendOtp, onSaveDetails }: {
  agent: Agent;
  onClose: () => void;
  onToggleActive: () => void;
  onDelete: () => void;
  onResendOtp: () => void;
  onSaveDetails: (updates: { phoneNumber?: string; name?: string; region?: string }) => Promise<void>;
}) {
  const [loans, setLoans] = useState<Application[] | null>(null);
  const [editing, setEditing] = useState(false);
  const [nameDraft, setNameDraft] = useState(agent.name || '');
  const [phoneDraft, setPhoneDraft] = useState(agent.phone_number);
  const [regionDraft, setRegionDraft] = useState(agent.region || '');
  const [saving, setSaving] = useState(false);
  const status = statusOf(agent);

  useEffect(() => {
    setLoans(null);
    requestJson(`/applications?agent_phone=${encodeURIComponent(agent.phone_number)}`).then(r => setLoans(r.applications));
    setNameDraft(agent.name || '');
    setPhoneDraft(agent.phone_number);
    setRegionDraft(agent.region || '');
  }, [agent.id, agent.phone_number]);

  async function saveDetails(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    try {
      await onSaveDetails({ phoneNumber: phoneDraft, name: nameDraft, region: regionDraft });
      setEditing(false);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 bg-black/40 backdrop-blur-sm z-50 animate-overlayIn" onClick={onClose}>
      <div
        className="fixed top-0 right-0 h-full w-full sm:w-1/2 bg-card overflow-y-auto p-6 sm:p-8 shadow-2xl animate-panelIn"
        onClick={e => e.stopPropagation()}
      >
        <div className="flex justify-between items-start mb-5">
          <div>
            <div className="font-mono-brand text-xs text-text-dim">{agent.phone_number}</div>
            <h2 className="font-display text-xl font-bold">{agent.name || 'Field Agent'}</h2>
          </div>
          <button onClick={onClose} className="text-text-dim hover:text-ink text-2xl leading-none transition-colors">×</button>
        </div>

        <div className="flex items-center gap-2 mb-6">
          <span className={`text-[10.5px] font-bold uppercase tracking-wide px-2.5 py-1 rounded-full ${STATUS_PILL[status]}`}>
            {status === 'PENDING' ? 'Pending OTP' : status === 'ACTIVE' ? 'Active' : 'Deactivated'}
          </span>
          {agent.region && <span className="text-xs text-text-dim">{agent.region}</span>}
          <button onClick={() => setEditing(o => !o)} className="ml-auto text-xs font-semibold text-accent-bright hover:underline">
            {editing ? 'Cancel' : 'Edit'}
          </button>
        </div>

        {editing && (
          <form onSubmit={saveDetails} className="border border-rule rounded-xl p-4 mb-6 flex flex-wrap gap-3 items-end bg-paper">
            <div className="flex-1 min-w-[160px]">
              <label className="block text-[11px] uppercase tracking-wide text-text-dim mb-1.5">Phone (WhatsApp)</label>
              <input required value={phoneDraft} onChange={e => setPhoneDraft(e.target.value)} className="border border-rule rounded-lg px-3 py-2 text-sm w-full bg-card" />
            </div>
            <div className="flex-1 min-w-[140px]">
              <label className="block text-[11px] uppercase tracking-wide text-text-dim mb-1.5">Name</label>
              <input value={nameDraft} onChange={e => setNameDraft(e.target.value)} className="border border-rule rounded-lg px-3 py-2 text-sm w-full bg-card" />
            </div>
            <div className="flex-1 min-w-[140px]">
              <label className="block text-[11px] uppercase tracking-wide text-text-dim mb-1.5">Region</label>
              <input value={regionDraft} onChange={e => setRegionDraft(e.target.value)} className="border border-rule rounded-lg px-3 py-2 text-sm w-full bg-card" />
            </div>
            <button type="submit" disabled={saving} className="bg-solid hover:bg-solid-hover text-white text-sm font-semibold px-4 py-2 rounded-lg disabled:opacity-60 transition-colors">
              {saving ? 'Saving…' : 'Save'}
            </button>
          </form>
        )}

        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-6">
          <MiniCard label="Total Loans" value={String(agent.performance.total)} />
          <MiniCard label="Pending" value={String(agent.performance.pending)} />
          <MiniCard label="Approved" value={String(agent.performance.approved)} />
          <MiniCard label="Remuneration" value={`$${agent.performance.totalRemuneration.toFixed(2)}`} />
        </div>

        <div className="flex gap-2 mb-6 flex-wrap">
          <WhatsAppChatButton phone={agent.phone_number} />
          {!agent.verified && (
            <button onClick={onResendOtp} className="bg-solid hover:bg-solid-hover text-white text-sm font-semibold px-4 py-2 rounded-lg transition-colors">
              Resend Code
            </button>
          )}
          {agent.verified && (
            <button
              onClick={onToggleActive}
              className={`text-white text-sm font-semibold px-4 py-2 rounded-lg hover:opacity-90 transition-opacity ${agent.active ? 'bg-accent-deep' : 'bg-sage'}`}
            >
              {agent.active ? 'Deactivate Agent' : 'Activate Agent'}
            </button>
          )}
          <button onClick={onDelete} className="border border-rule text-sm font-semibold px-4 py-2 rounded-lg hover:border-accent hover:text-accent transition-colors">
            Delete Agent
          </button>
        </div>

        <div className="text-xs uppercase tracking-wide text-text-dim mb-3 font-semibold">Loans Brought In</div>
        {loans === null && (
          <div className="flex flex-col gap-2">
            {Array.from({ length: 3 }).map((_, i) => <div key={i} className="h-9 rounded-lg skeleton animate-shimmer" />)}
          </div>
        )}
        {loans !== null && loans.length === 0 && <div className="text-sm text-text-dim">No loans yet.</div>}
        {loans && loans.length > 0 && (
          <div className="border border-rule rounded-xl overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-sm min-w-[480px]">
                <thead>
                  <tr className="text-left text-[10.5px] uppercase tracking-wide text-text-dim border-b border-rule bg-paper">
                    <th className="px-4 py-2.5">Reference</th><th className="px-4 py-2.5">Client</th><th className="px-4 py-2.5">Category</th>
                    <th className="px-4 py-2.5">Amount</th><th className="px-4 py-2.5">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {loans.map(l => (
                    <tr key={l.id} className="border-b border-rule last:border-0">
                      <td className="px-4 py-2.5 font-mono-brand text-text-dim">{l.reference_number}</td>
                      <td className="px-4 py-2.5 font-semibold">{l.full_name}</td>
                      <td className="px-4 py-2.5">{CATEGORY_LABELS[l.category]}</td>
                      <td className="px-4 py-2.5 font-mono-brand">${Number(l.loan_amount).toFixed(2)}</td>
                      <td className="px-4 py-2.5">{l.status.replace('_', ' ')}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

const AGENT_APP_REJECT_REASONS = [
  'Area already covered',
  'Could not verify identity',
  'Incomplete information',
  'Not currently recruiting',
];

function CheckIcon() {
  return <svg width="14" height="14" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M4 10.5l4 4 8-9"/></svg>;
}
function XIcon() {
  return <svg width="13" height="13" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M5 5l10 10M15 5 5 15"/></svg>;
}

function AgentApplicationsSection() {
  const [applications, setApplications] = useState<AgentApplication[]>([]);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<AgentApplication | null>(null);
  const [pendingAction, setPendingAction] = useState<{ app: AgentApplication; mode: 'approve' | 'reject' } | null>(null);

  async function load() {
    const r = await requestJson('/agent-applications?status=PENDING_REVIEW');
    setApplications(r.applications);
    setLoading(false);
  }

  useEffect(() => { load(); }, []);

  async function decide(id: string, status: 'APPROVED' | 'REJECTED', note?: string) {
    const r = await requestJson(`/agent-applications/${id}/status`, { method: 'PATCH', body: JSON.stringify({ status, note }) });
    setPendingAction(null);
    setSelected(null);
    await load();
    // On approval the agent is PENDING with a 6-digit activation code — open
    // a WhatsApp chat pre-filled with it so the officer can hand it over.
    if (status === 'APPROVED' && r?.activationMessage) {
      openWhatsApp(r.applicantPhone, r.activationMessage);
    }
  }

  if (!loading && applications.length === 0) return null;

  return (
    <div className="mt-10">
      <h2 className="font-display font-bold text-lg mb-5">Agent Applications <span className="text-text-dim font-normal text-sm">("Become an Agent" via WhatsApp)</span></h2>

      {loading && (
        <div className="border border-rule rounded-2xl overflow-hidden">
          <div className="h-14 flex items-center px-5"><div className="h-3.5 w-40 rounded skeleton animate-shimmer" /></div>
        </div>
      )}

      {!loading && (
        <div className="border border-rule rounded-2xl overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm min-w-[560px]">
              <thead>
                <tr className="text-left text-[10.5px] uppercase tracking-wide text-text-dim border-b border-rule">
                  <th className="px-5 py-3">Name</th><th className="px-5 py-3">Phone</th><th className="px-5 py-3">National ID</th>
                  <th className="px-5 py-3">Area</th><th className="px-5 py-3"></th>
                </tr>
              </thead>
              <tbody>
                {applications.map(a => (
                  <tr key={a.id} onClick={() => setSelected(a)} className="border-b border-rule last:border-0 cursor-pointer hover:bg-paper">
                    <td className="px-5 py-3.5 font-semibold">{a.full_name}</td>
                    <td className="px-5 py-3.5 font-mono-brand text-text-dim">{a.applicant_phone}</td>
                    <td className="px-5 py-3.5">{a.national_id}</td>
                    <td className="px-5 py-3.5">{a.area}</td>
                    <td className="px-5 py-3.5">
                      <div className="flex gap-1.5" onClick={e => e.stopPropagation()}>
                        <button onClick={() => openWhatsApp(a.applicant_phone)} title="Open WhatsApp chat" className="w-7 h-7 rounded-full border border-rule flex items-center justify-center text-text-dim hover:border-sage hover:text-sage transition-colors">
                          <svg width="13" height="13" viewBox="0 0 20 20" fill="currentColor"><path d="M10 2a8 8 0 0 0-6.9 12l-1 3.6 3.7-1A8 8 0 1 0 10 2Zm4.6 11.4c-.2.5-1.1 1-1.5 1-.4 0-.9.1-2.9-.8-2.4-1-4-3.4-4.1-3.6-.1-.2-1-1.3-1-2.5s.6-1.8.9-2c.2-.2.5-.3.7-.3h.5c.2 0 .4 0 .6.4.2.5.7 1.7.8 1.8.1.2.1.3 0 .5-.1.2-.2.3-.3.5-.2.2-.3.3-.1.6.2.3.8 1.3 1.7 2.1 1.2 1 2.1 1.4 2.4 1.5.3.1.5.1.6-.1.2-.2.7-.8.9-1 .2-.3.4-.2.6-.1l1.6.8c.2.1.3.2.4.3.1.2.1.7-.1 1.2Z"/></svg>
                        </button>
                        <button onClick={() => setPendingAction({ app: a, mode: 'approve' })} title="Approve" className="w-7 h-7 rounded-full border border-rule flex items-center justify-center text-text-dim hover:border-sage hover:text-sage transition-colors">
                          <CheckIcon />
                        </button>
                        <button onClick={() => setPendingAction({ app: a, mode: 'reject' })} title="Reject" className="w-7 h-7 rounded-full border border-rule flex items-center justify-center text-text-dim hover:border-accent hover:text-accent transition-colors">
                          <XIcon />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {selected && (
        <AgentApplicationDetail
          application={selected}
          onClose={() => setSelected(null)}
          onRequestDecision={mode => setPendingAction({ app: selected, mode })}
        />
      )}

      {pendingAction && (
        <AgentApplicationConfirmModal
          application={pendingAction.app}
          mode={pendingAction.mode}
          onCancel={() => setPendingAction(null)}
          onConfirm={note => decide(pendingAction.app.id, pendingAction.mode === 'approve' ? 'APPROVED' : 'REJECTED', note)}
        />
      )}
    </div>
  );
}

function AgentApplicationDetail({ application, onClose, onRequestDecision }: {
  application: AgentApplication;
  onClose: () => void;
  onRequestDecision: (mode: 'approve' | 'reject') => void;
}) {
  const [documents, setDocuments] = useState<DocType[]>([]);
  const [docsLoading, setDocsLoading] = useState(true);

  useEffect(() => {
    setDocsLoading(true);
    requestJson(`/agent-applications/${application.id}/documents`)
      .then(r => setDocuments(r.documents))
      .finally(() => setDocsLoading(false));
  }, [application.id]);

  return (
    <div className="fixed inset-0 bg-black/40 backdrop-blur-sm z-50 animate-overlayIn" onClick={onClose}>
      <div
        className="fixed top-0 right-0 h-full w-full sm:w-1/2 bg-card overflow-y-auto p-6 sm:p-8 shadow-2xl animate-panelIn"
        onClick={e => e.stopPropagation()}
      >
        <div className="flex justify-between items-start mb-6">
          <div>
            <div className="font-mono-brand text-xs text-text-dim">{application.applicant_phone}</div>
            <h2 className="font-display text-xl font-bold">{application.full_name}</h2>
          </div>
          <button onClick={onClose} className="text-text-dim hover:text-ink text-2xl leading-none transition-colors">×</button>
        </div>

        <div className="grid grid-cols-2 gap-4 text-sm mb-6">
          <DetailField label="National ID" value={application.national_id} />
          <DetailField label="Area" value={application.area} />
          <DetailField label="Applicant Phone" value={application.applicant_phone} />
          <DetailField label="Submitted" value={new Date(application.created_at).toLocaleDateString('en-ZW', { timeZone: 'Africa/Harare' })} />
        </div>

        <DocsSection documents={documents} loading={docsLoading} />

        <div className="flex gap-2 flex-wrap">
          <button onClick={() => onRequestDecision('approve')} className="bg-sage text-white text-sm font-semibold px-4 py-2 rounded-lg hover:opacity-90 transition-opacity">Approve</button>
          <button onClick={() => onRequestDecision('reject')} className="bg-accent-deep text-white text-sm font-semibold px-4 py-2 rounded-lg hover:opacity-90 transition-opacity">Reject</button>
          <WhatsAppChatButton phone={application.applicant_phone} />
        </div>
      </div>
    </div>
  );
}

function DetailField({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="text-xs text-text-dim uppercase tracking-wide">{label}</div>
      <div className="font-semibold">{value}</div>
    </div>
  );
}

function AgentApplicationConfirmModal({ application, mode, onCancel, onConfirm }: {
  application: AgentApplication;
  mode: 'approve' | 'reject';
  onCancel: () => void;
  onConfirm: (note?: string) => void;
}) {
  const [reason, setReason] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const isApprove = mode === 'approve';

  async function confirm() {
    setSubmitting(true);
    await onConfirm(reason.trim() || undefined);
    setSubmitting(false);
  }

  return (
    <div className="fixed inset-0 bg-black/40 backdrop-blur-sm flex items-center justify-center z-[60] p-6 animate-overlayIn" onClick={onCancel}>
      <div className="bg-card rounded-2xl max-w-sm w-full p-6 animate-modalIn" onClick={e => e.stopPropagation()}>
        <div className={`w-11 h-11 rounded-full flex items-center justify-center mb-4 ${isApprove ? 'bg-sage-bg text-sage' : 'bg-accent-wash text-accent-deep'}`}>
          {isApprove ? <div className="scale-150"><CheckIcon /></div> : <div className="scale-150"><XIcon /></div>}
        </div>

        <h3 className="font-display font-bold text-lg mb-1">
          {isApprove ? 'Approve this agent application?' : 'Reject this agent application?'}
        </h3>
        <div className="text-sm text-text-dim mb-5">
          {application.full_name} · {application.applicant_phone} · {application.area}
        </div>

        {isApprove && (
          <div className="text-sm text-text-dim mb-5">
            This registers the applicant as a pending field agent and generates a 6-digit activation code.
            A WhatsApp chat opens pre-filled with a message telling them to send that code to the Soledd bot;
            once they do, their field agent account goes live.
          </div>
        )}

        {!isApprove && (
          <div className="mb-5">
            <div className="text-xs uppercase tracking-wide text-text-dim font-semibold mb-2">Reason (sent to the applicant)</div>
            <div className="flex flex-wrap gap-1.5 mb-2.5">
              {AGENT_APP_REJECT_REASONS.map(r => (
                <button
                  key={r}
                  onClick={() => setReason(r)}
                  className={`text-xs font-semibold px-2.5 py-1.5 rounded-full border transition-colors ${
                    reason === r ? 'bg-solid border-solid text-white' : 'border-rule text-text-dim hover:border-ink'
                  }`}
                >
                  {r}
                </button>
              ))}
            </div>
            <textarea
              value={reason}
              onChange={e => setReason(e.target.value)}
              placeholder="Or type a custom reason…"
              rows={2}
              className="w-full border border-rule rounded-lg px-3 py-2 text-sm bg-paper focus:outline-none focus:border-accent resize-none"
            />
          </div>
        )}

        <div className="flex gap-2">
          <button onClick={onCancel} className="flex-1 border border-rule text-sm font-semibold px-4 py-2.5 rounded-lg hover:border-ink transition-colors">
            Cancel
          </button>
          <button
            onClick={confirm}
            disabled={submitting}
            className={`flex-1 text-white text-sm font-semibold px-4 py-2.5 rounded-lg transition-opacity hover:opacity-90 disabled:opacity-60 ${isApprove ? 'bg-sage' : 'bg-accent-deep'}`}
          >
            {submitting ? 'Working…' : isApprove ? 'Approve' : 'Reject'}
          </button>
        </div>
      </div>
    </div>
  );
}

function MiniStat({ value, label, color }: { value: string; label: string; color?: string }) {
  return (
    <div>
      <div className={`font-display text-2xl font-bold ${color || ''}`}>{value}</div>
      <div className="text-xs text-text-dim mt-1">{label}</div>
    </div>
  );
}

function MiniCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="bg-paper rounded-xl p-3">
      <div className="text-[10px] uppercase tracking-wide text-text-dim mb-1">{label}</div>
      <div className="font-display text-lg font-bold">{value}</div>
    </div>
  );
}
