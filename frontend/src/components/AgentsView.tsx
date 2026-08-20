import { useEffect, useMemo, useRef, useState } from 'react';
import { requestJson } from '../services/api';
import { Agent, Application, CATEGORY_LABELS } from '../types';
import ViewToggle, { ViewMode } from './ViewToggle';

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
        <button
          onClick={() => setShowAdd(o => !o)}
          className="sm:ml-auto bg-accent hover:bg-accent-deep text-white text-sm font-semibold px-4 py-2.5 rounded-lg transition-colors whitespace-nowrap"
        >
          {showAdd ? 'Cancel' : '+ Add Agent'}
        </button>
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
                onClick={() => a.verified && setSelected(a)}
                disabled={!a.verified}
                className={`text-left border border-rule rounded-2xl p-5 bg-card-tint flex flex-col gap-3.5 transition-all duration-150 ${
                  a.verified ? 'hover:border-ink hover:-translate-y-0.5 hover:shadow-sm' : 'opacity-70 cursor-default'
                }`}
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
                  {status === 'PENDING' && <button onClick={() => resendOtp(a.id)} className="text-accent-bright font-semibold">Resend Code</button>}
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
                    <tr key={a.id} onClick={() => a.verified && setSelected(a)} className={`border-b border-rule last:border-0 ${a.verified ? 'cursor-pointer hover:bg-paper' : ''}`}>
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
                        <div className="flex gap-2" onClick={e => e.stopPropagation()}>
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
        />
      )}
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

function AgentDetail({ agent, onClose, onToggleActive, onDelete }: {
  agent: Agent;
  onClose: () => void;
  onToggleActive: () => void;
  onDelete: () => void;
}) {
  const [loans, setLoans] = useState<Application[] | null>(null);
  const status = statusOf(agent);

  useEffect(() => {
    setLoans(null);
    requestJson(`/applications?agent_phone=${encodeURIComponent(agent.phone_number)}`).then(r => setLoans(r.applications));
  }, [agent.phone_number]);

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
        </div>

        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-6">
          <MiniCard label="Total Loans" value={String(agent.performance.total)} />
          <MiniCard label="Pending" value={String(agent.performance.pending)} />
          <MiniCard label="Approved" value={String(agent.performance.approved)} />
          <MiniCard label="Remuneration" value={`$${agent.performance.totalRemuneration.toFixed(2)}`} />
        </div>

        <div className="flex gap-2 mb-6 flex-wrap">
          <button
            onClick={onToggleActive}
            className={`text-white text-sm font-semibold px-4 py-2 rounded-lg hover:opacity-90 transition-opacity ${agent.active ? 'bg-accent-deep' : 'bg-sage'}`}
          >
            {agent.active ? 'Deactivate Agent' : 'Activate Agent'}
          </button>
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
