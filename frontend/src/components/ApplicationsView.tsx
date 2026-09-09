import { useEffect, useMemo, useRef, useState } from 'react';
import { requestJson, requestBlob, downloadBlob } from '../services/api';
import {
  Application, Stats, CATEGORY_LABELS, CategoryCode, ApplicationStatus, Document, Agent,
  LoanProduct, BorrowerType, RepaymentType, LOAN_PRODUCT_LABELS, CalculatorResult as CalculatorResultType,
} from '../types';
import CalculatorResult, { AmortisationTable, CalculatorResultSkeleton } from './CalculatorResult';
import Dropdown from './Dropdown';
import ViewToggle, { ViewMode } from './ViewToggle';
import DocsSection from './DocsSection';

const REFRESH_INTERVAL_MS = 5 * 60 * 1000;

const STATUS_PILL: Record<ApplicationStatus, string> = {
  IN_REVIEW: 'bg-warn-bg text-warn',
  APPROVED: 'bg-sage-bg text-sage',
  REJECTED: 'bg-accent-wash text-accent-deep',
};

const CAT_STYLE: Record<CategoryCode, string> = {
  SSB: 'bg-info-bg text-info',
  GOVT_PENSIONER: 'bg-info-bg text-info',
  SME: 'bg-accent-wash text-accent',
  PRIVATE_SECTOR: 'bg-warn-bg text-warn',
};

const CATEGORY_CHIPS: { id: string; label: string }[] = [
  { id: 'all', label: 'All' },
  { id: 'SSB', label: 'Civil Servants' },
  { id: 'GOVT_PENSIONER', label: 'Pensioners' },
  { id: 'SME', label: 'SME' },
  { id: 'PRIVATE_SECTOR', label: 'Private Sector' },
];

const STATUS_OPTIONS = [
  { value: 'IN_REVIEW', label: 'In Review' },
  { value: 'APPROVED', label: 'Approved' },
  { value: 'REJECTED', label: 'Rejected' },
];

function openWhatsApp(phone: string, message: string) {
  const clean = (phone || '').replace(/[^0-9]/g, '');
  const text = message.trim() ? `?text=${encodeURIComponent(message.trim())}` : '';
  window.open(`https://wa.me/${clean}${text}`, '_blank', 'noopener');
}

export default function ApplicationsView() {
  const [allApps, setAllApps] = useState<Application[]>([]);
  const [stats, setStats] = useState<Stats | null>(null);
  const [categories, setCategories] = useState<string[]>([]);
  const [statuses, setStatuses] = useState<string[]>([]);
  const [minAmount, setMinAmount] = useState('');
  const [maxAmount, setMaxAmount] = useState('');
  const [search, setSearch] = useState('');
  const [selected, setSelected] = useState<Application | null>(null);
  const [pendingAction, setPendingAction] = useState<{ app: Application; mode: 'approve' | 'reject' } | null>(null);
  const [loading, setLoading] = useState(true);
  const [viewMode, setViewMode] = useState<ViewMode>(() => (localStorage.getItem('soledd_queue_view') as ViewMode) || 'grid');

  function setMode(m: ViewMode) {
    setViewMode(m);
    localStorage.setItem('soledd_queue_view', m);
  }

  async function load() {
    const [appsRes, statsRes] = await Promise.all([
      requestJson('/applications'),
      requestJson('/applications/stats'),
    ]);
    setAllApps(appsRes.applications);
    setStats(statsRes);
    setLoading(false);
  }

  // Load once, then refresh from the DB every 5 minutes. Filtering below
  // happens entirely against the already-loaded list — switching chips,
  // status, or typing a search never re-hits the database.
  useEffect(() => {
    load();
    const interval = setInterval(load, REFRESH_INTERVAL_MS);
    return () => clearInterval(interval);
  }, []);

  const apps = useMemo(() => {
    const q = search.trim().toLowerCase();
    const min = minAmount.trim() ? parseFloat(minAmount) : null;
    const max = maxAmount.trim() ? parseFloat(maxAmount) : null;
    return allApps.filter(a => {
      if (categories.length > 0 && !categories.includes(a.category)) return false;
      if (statuses.length > 0 && !statuses.includes(a.status)) return false;
      if (min !== null && !Number.isNaN(min) && Number(a.loan_amount) < min) return false;
      if (max !== null && !Number.isNaN(max) && Number(a.loan_amount) > max) return false;
      if (q && !a.full_name.toLowerCase().includes(q) && !a.reference_number.toLowerCase().includes(q) && !(a.national_id || '').toLowerCase().includes(q)) return false;
      return true;
    });
  }, [allApps, categories, statuses, minAmount, maxAmount, search]);

  const advancedActive = categories.length > 1 || statuses.length > 0 || !!minAmount.trim() || !!maxAmount.trim();

  function clearAdvanced() {
    setCategories([]);
    setStatuses([]);
    setMinAmount('');
    setMaxAmount('');
  }

  async function updateStatus(id: string, s: ApplicationStatus, note?: string) {
    await requestJson(`/applications/${id}/status`, { method: 'PATCH', body: JSON.stringify({ status: s, note }) });
    setAllApps(prev => prev.map(a => a.id === id ? { ...a, status: s } : a));
    if (selected?.id === id) setSelected({ ...selected, status: s });
  }

  async function updateLoanTerms(id: string, terms: Partial<Pick<Application, 'loan_product' | 'borrower_type' | 'disbursement_date'>>) {
    await requestJson(`/applications/${id}/loan-terms`, { method: 'PATCH', body: JSON.stringify(terms) });
    setAllApps(prev => prev.map(a => a.id === id ? { ...a, ...terms } : a));
    setSelected(prev => prev && prev.id === id ? { ...prev, ...terms } : prev);
  }

  async function updateAgentAssignment(id: string, agentPhone: string | null) {
    await requestJson(`/applications/${id}/agent`, { method: 'PATCH', body: JSON.stringify({ agent_phone: agentPhone }) });
    setAllApps(prev => prev.map(a => a.id === id ? { ...a, agent_phone: agentPhone } : a));
    setSelected(prev => prev && prev.id === id ? { ...prev, agent_phone: agentPhone } : prev);
  }

  async function confirmPendingAction(note?: string) {
    if (!pendingAction) return;
    await updateStatus(pendingAction.app.id, pendingAction.mode === 'approve' ? 'APPROVED' : 'REJECTED', note);
    setPendingAction(null);
  }

  async function exportPdf(id: string, ref: string) {
    const blob = await requestBlob(`/applications/${id}/pdf`);
    downloadBlob(blob, `${ref}.pdf`);
  }

  async function exportCrystal() {
    const blob = await requestBlob('/applications/export/crystal');
    downloadBlob(blob, `soledd_loans_export_${new Date().toISOString().slice(0, 10)}.xlsx`);
  }

  return (
    <div>
      {/* Hero */}
      <div className="flex flex-col sm:flex-row sm:items-end gap-8 sm:gap-14 mb-10 sm:mb-14">
        <div>
          <div className="text-xs font-bold text-accent uppercase tracking-wide mb-2.5">Application Queue</div>
          <div className="font-display font-bold leading-none tracking-tight" style={{ fontSize: 'clamp(44px, 9vw, 76px)' }}>
            {stats?.pendingReview ?? '-'}<span className="text-2xl sm:text-3xl font-semibold text-text-dim ml-1.5">pending review</span>
          </div>
          <div className="text-sm text-text-dim mt-2">{allApps.length} applications received via WhatsApp</div>
        </div>
        {stats && (
          <div className="flex gap-6 sm:gap-9 pb-1 flex-wrap">
            <MiniStat value={String(stats.approvedToday)} label="Approved today" color="text-sage" />
            <MiniStat value={`$${stats.disbursedThisMonth.toLocaleString()}`} label="Disbursed, month" />
            <MiniStat value={String(stats.activeFieldAgents)} label="Active field agent" />
          </div>
        )}
        <button
          onClick={exportCrystal}
          className="sm:ml-auto bg-solid hover:bg-solid-hover text-white text-sm font-semibold px-4 py-2.5 rounded-lg transition-colors whitespace-nowrap"
        >
          Export to Excel
        </button>
      </div>

      {/* Toolbar */}
      <div className="flex flex-col sm:flex-row sm:items-center gap-4 mb-5">
        <h2 className="font-display font-bold text-lg">All Applications</h2>

        <div className="flex flex-wrap gap-2">
          {CATEGORY_CHIPS.map(c => {
            const active = c.id === 'all' ? categories.length === 0 : categories.length === 1 && categories[0] === c.id;
            return (
              <button
                key={c.id}
                onClick={() => setCategories(c.id === 'all' ? [] : [c.id])}
                className={`shrink-0 px-3.5 py-1.5 text-xs font-semibold rounded-full border transition-colors duration-150 ${
                  active ? 'bg-solid border-solid text-white' : 'border-rule text-text-dim hover:border-ink'
                }`}
              >
                {c.label}
              </button>
            );
          })}
          <AdvancedFilter
            categories={categories}
            onCategoriesChange={setCategories}
            statuses={statuses}
            onStatusesChange={setStatuses}
            minAmount={minAmount}
            maxAmount={maxAmount}
            onMinAmountChange={setMinAmount}
            onMaxAmountChange={setMaxAmount}
            active={advancedActive}
          />
        </div>

        <div className="flex items-center gap-2 sm:ml-auto flex-wrap">
          <input
            placeholder="Search applicant or reference…"
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
          {categories.length > 1 && categories.map(c => (
            <span key={c} className="text-xs font-semibold px-2.5 py-1 rounded-full bg-info-bg text-info">
              {CATEGORY_LABELS[c as CategoryCode]}
            </span>
          ))}
          {statuses.map(s => (
            <span key={s} className="text-xs font-semibold px-2.5 py-1 rounded-full bg-info-bg text-info">
              {STATUS_OPTIONS.find(o => o.value === s)?.label}
            </span>
          ))}
          {minAmount.trim() && (
            <span className="text-xs font-semibold px-2.5 py-1 rounded-full bg-info-bg text-info">≥ ${minAmount}</span>
          )}
          {maxAmount.trim() && (
            <span className="text-xs font-semibold px-2.5 py-1 rounded-full bg-info-bg text-info">≤ ${maxAmount}</span>
          )}
          <button onClick={clearAdvanced} className="text-xs text-accent font-semibold hover:underline">Clear</button>
        </div>
      )}

      {loading && <SkeletonGrid />}

      {!loading && apps.length === 0 && <div className="text-center py-16 text-text-dim text-sm">No applications match these filters</div>}

      {!loading && apps.length > 0 && viewMode === 'grid' && (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {apps.map(a => (
            <button
              key={a.id}
              onClick={() => setSelected(a)}
              className="text-left border border-rule rounded-2xl p-5 bg-card-tint flex flex-col gap-3.5 hover:border-ink hover:-translate-y-0.5 hover:shadow-sm transition-all duration-150"
            >
              <div className="flex justify-between items-start gap-2">
                <div>
                  <div className="font-display font-bold text-base">{a.full_name}</div>
                  <div className="text-xs text-text-dim mt-0.5">{a.employer_name || '-'}</div>
                </div>
                <span className="font-mono-brand text-[11px] text-text-dim shrink-0">{a.reference_number}</span>
              </div>
              <span className={`inline-flex w-fit items-center text-[10.5px] font-bold uppercase tracking-wide px-2.5 py-1 rounded-full ${STATUS_PILL[a.status]}`}>
                {a.status.replace('_', ' ')}
              </span>
              <div className="flex justify-between items-center border-t border-rule pt-3.5">
                <span className="font-mono-brand font-bold text-base">${Number(a.loan_amount).toFixed(2)}</span>
                <span className={`text-[11px] px-2.5 py-1 rounded-full border border-rule ${CAT_STYLE[a.category]}`}>{CATEGORY_LABELS[a.category]}</span>
              </div>
              <div className="text-[11px] text-text-dim">{a.agent_phone ? `Agent: ${a.agent_phone}` : 'No agent'}</div>
            </button>
          ))}
        </div>
      )}

      {!loading && apps.length > 0 && viewMode === 'list' && (
        <div className="border border-rule rounded-2xl overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm min-w-[720px]">
              <thead>
                <tr className="text-left text-[10.5px] uppercase tracking-wide text-text-dim border-b border-rule">
                  <th className="px-5 py-3">Reference</th>
                  <th className="px-5 py-3">Applicant</th>
                  <th className="px-5 py-3">Category</th>
                  <th className="px-5 py-3">Amount</th>
                  <th className="px-5 py-3">Agent</th>
                  <th className="px-5 py-3">Status</th>
                  <th className="px-5 py-3"></th>
                </tr>
              </thead>
              <tbody>
                {apps.map(a => (
                  <tr key={a.id} onClick={() => setSelected(a)} className="border-b border-rule last:border-0 hover:bg-card-tint cursor-pointer transition-colors">
                    <td className="px-5 py-3.5 font-mono-brand text-text-dim">{a.reference_number}</td>
                    <td className="px-5 py-3.5">
                      <div className="font-semibold">{a.full_name}</div>
                      <div className="text-xs text-text-dim">{a.employer_name || '-'}</div>
                    </td>
                    <td className="px-5 py-3.5"><span className={`text-xs font-semibold px-2.5 py-1 rounded-full ${CAT_STYLE[a.category]}`}>{CATEGORY_LABELS[a.category]}</span></td>
                    <td className="px-5 py-3.5 font-mono-brand font-semibold">${Number(a.loan_amount).toFixed(2)}</td>
                    <td className="px-5 py-3.5 text-text-dim">{a.agent_phone || '-'}</td>
                    <td className="px-5 py-3.5"><span className={`text-[10.5px] font-bold uppercase tracking-wide px-2.5 py-1 rounded-full ${STATUS_PILL[a.status]}`}>{a.status.replace('_', ' ')}</span></td>
                    <td className="px-5 py-3.5">
                      <div className="flex gap-1.5" onClick={e => e.stopPropagation()}>
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
          <div className="px-5 py-3 text-xs text-text-dim border-t border-rule">Showing {apps.length} application{apps.length === 1 ? '' : 's'}</div>
        </div>
      )}

      {selected && (
        <ApplicationDetail
          application={selected}
          onClose={() => setSelected(null)}
          onRequestStatusChange={mode => setPendingAction({ app: selected, mode })}
          onExportPdf={() => exportPdf(selected.id, selected.reference_number)}
          onLoanTermsChange={terms => updateLoanTerms(selected.id, terms)}
          onAssignAgent={phone => updateAgentAssignment(selected.id, phone)}
        />
      )}

      {pendingAction && (
        <StatusConfirmModal
          application={pendingAction.app}
          mode={pendingAction.mode}
          onCancel={() => setPendingAction(null)}
          onConfirm={confirmPendingAction}
        />
      )}
    </div>
  );
}

function CheckIcon() {
  return <svg width="14" height="14" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M4 10.5l4 4 8-9"/></svg>;
}

function XIcon() {
  return <svg width="13" height="13" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M5 5l10 10M15 5 5 15"/></svg>;
}

const REJECT_REASONS = [
  'Insufficient documents',
  'Failed verification',
  'Does not meet eligibility criteria',
  'Suspected fraud',
  'Existing outstanding loan',
];

function StatusConfirmModal({ application, mode, onCancel, onConfirm }: {
  application: Application;
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
          {isApprove ? 'Approve this application?' : 'Reject this application?'}
        </h3>
        <div className="text-sm text-text-dim mb-5">
          {application.full_name} · {application.reference_number} · ${Number(application.loan_amount).toFixed(2)}
        </div>

        {!isApprove && (
          <div className="mb-5">
            <div className="text-xs uppercase tracking-wide text-text-dim font-semibold mb-2">Reason (sent to the applicant)</div>
            <div className="flex flex-wrap gap-1.5 mb-2.5">
              {REJECT_REASONS.map(r => (
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

const ADVANCED_CATEGORIES = CATEGORY_CHIPS.filter(c => c.id !== 'all');

function AdvancedFilter({
  categories, onCategoriesChange,
  statuses, onStatusesChange,
  minAmount, maxAmount, onMinAmountChange, onMaxAmountChange,
  active,
}: {
  categories: string[]; onCategoriesChange: (c: string[]) => void;
  statuses: string[]; onStatusesChange: (s: string[]) => void;
  minAmount: string; maxAmount: string; onMinAmountChange: (v: string) => void; onMaxAmountChange: (v: string) => void;
  active: boolean;
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

  function toggleCategory(id: string) {
    onCategoriesChange(categories.includes(id) ? categories.filter(c => c !== id) : [...categories, id]);
  }

  function toggleStatus(id: string) {
    onStatusesChange(statuses.includes(id) ? statuses.filter(s => s !== id) : [...statuses, id]);
  }

  function clearAll() {
    onCategoriesChange([]);
    onStatusesChange([]);
    onMinAmountChange('');
    onMaxAmountChange('');
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
          <div className="text-[10px] uppercase tracking-wide text-text-dim font-semibold px-1 mb-1.5">Combine categories</div>
          {ADVANCED_CATEGORIES.map(c => (
            <label key={c.id} className="flex items-center gap-2.5 px-1 py-1.5 text-sm cursor-pointer hover:bg-paper rounded-lg">
              <input
                type="checkbox"
                checked={categories.includes(c.id)}
                onChange={() => toggleCategory(c.id)}
                className="accent-accent-bright w-4 h-4"
              />
              {c.label}
            </label>
          ))}

          <div className="text-[10px] uppercase tracking-wide text-text-dim font-semibold px-1 mb-1.5 mt-3 pt-3 border-t border-rule">Status (select any)</div>
          <div className="flex flex-wrap gap-1.5 px-1">
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

          <div className="text-[10px] uppercase tracking-wide text-text-dim font-semibold px-1 mb-1.5 mt-3 pt-3 border-t border-rule">Loan amount (USD)</div>
          <div className="flex items-center gap-2 px-1">
            <input
              type="number"
              placeholder="Min"
              value={minAmount}
              onChange={e => onMinAmountChange(e.target.value)}
              className="w-full border border-rule rounded-lg px-2.5 py-1.5 text-xs bg-paper focus:outline-none focus:border-accent"
            />
            <span className="text-text-dim text-xs">to</span>
            <input
              type="number"
              placeholder="Max"
              value={maxAmount}
              onChange={e => onMaxAmountChange(e.target.value)}
              className="w-full border border-rule rounded-lg px-2.5 py-1.5 text-xs bg-paper focus:outline-none focus:border-accent"
            />
          </div>

          <div className="flex justify-between items-center mt-3 pt-2 border-t border-rule px-1">
            <button onClick={clearAll} className="text-xs text-text-dim hover:text-accent">Clear all</button>
            <button onClick={() => setOpen(false)} className="text-xs font-semibold text-accent-bright">Done</button>
          </div>
        </div>
      )}
    </div>
  );
}

function SkeletonGrid() {
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

function MiniStat({ value, label, color }: { value: string; label: string; color?: string }) {
  return (
    <div>
      <div className={`font-display text-2xl font-bold ${color || ''}`}>{value}</div>
      <div className="text-xs text-text-dim mt-1">{label}</div>
    </div>
  );
}

function ApplicationDetail({ application, onClose, onRequestStatusChange, onExportPdf, onLoanTermsChange, onAssignAgent }: {
  application: Application;
  onClose: () => void;
  onRequestStatusChange: (mode: 'approve' | 'reject') => void;
  onExportPdf: () => void;
  onLoanTermsChange: (terms: Partial<Pick<Application, 'loan_product' | 'borrower_type' | 'disbursement_date'>>) => void;
  onAssignAgent: (agentPhone: string | null) => Promise<void>;
}) {
  const [documents, setDocuments] = useState<Document[]>([]);
  const [docsLoading, setDocsLoading] = useState(true);

  useEffect(() => {
    setDocsLoading(true);
    requestJson(`/applications/${application.id}/documents`)
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
            <div className="font-mono-brand text-xs text-text-dim">{application.reference_number}</div>
            <h2 className="font-display text-xl font-bold">{application.full_name}</h2>
          </div>
          <button onClick={onClose} className="text-text-dim hover:text-ink text-2xl leading-none transition-colors">×</button>
        </div>

        <div className="grid grid-cols-2 gap-4 text-sm mb-6">
          <Field label="Category" value={CATEGORY_LABELS[application.category]} />
          <Field label="Status" value={application.status.replace('_', ' ')} />
          <Field label="National ID" value={application.national_id} />
          <Field label="Employer/Business" value={application.employer_name || '-'} />
          <Field label="Loan Amount" value={`$${Number(application.loan_amount).toFixed(2)}`} />
          <Field label="Repayment Period" value={`${application.repayment_months} months`} />
          <Field label="Applicant Phone" value={application.applicant_phone} />
        </div>

        <div className="mb-6">
          <FieldAgentAssignment agentPhone={application.agent_phone} onAssign={onAssignAgent} />
        </div>

        <LoanRepaymentCalculator application={application} onTermsChange={onLoanTermsChange} />

        {extraDetailEntries(application.extra_details).length > 0 && (
          <div className="border-t border-rule pt-4 mb-6 max-h-64 overflow-y-auto">
            <div className="text-xs uppercase tracking-wide text-text-dim mb-3 font-semibold">Full Application Details</div>
            {extraDetailEntries(application.extra_details).map(([k, v]) => (
              <div key={k} className="mb-2.5 text-sm">
                <div className="text-xs text-text-dim">{humanizeFieldKey(k)}</div>
                <div>{String(v)}</div>
              </div>
            ))}
          </div>
        )}

        <DocsSection documents={documents} loading={docsLoading} />

        <div className="flex gap-2 mb-4 flex-wrap">
          <button onClick={() => onRequestStatusChange('approve')} className="bg-sage text-white text-sm font-semibold px-4 py-2 rounded-lg hover:opacity-90 transition-opacity">Approve</button>
          <button onClick={() => onRequestStatusChange('reject')} className="bg-accent-deep text-white text-sm font-semibold px-4 py-2 rounded-lg hover:opacity-90 transition-opacity">Reject</button>
          <button onClick={onExportPdf} className="border border-rule text-sm font-semibold px-4 py-2 rounded-lg hover:border-ink transition-colors">Export PDF</button>
        </div>

        <div className="border-t border-rule pt-4">
          <div className="text-xs uppercase tracking-wide text-text-dim mb-2 font-semibold">Request More Info</div>
          <div className="text-xs text-text-dim mb-3">Opens a WhatsApp chat with the applicant so you can send it yourself.</div>
          <button
            onClick={() => openWhatsApp(application.applicant_phone, '')}
            className="bg-[#25D366] hover:opacity-90 text-white text-sm font-semibold px-4 py-2 rounded-lg flex items-center justify-center gap-2 transition-opacity w-fit"
          >
            <svg width="15" height="15" viewBox="0 0 20 20" fill="currentColor"><path d="M10 2a8 8 0 0 0-6.9 12l-1 3.6 3.7-1A8 8 0 1 0 10 2Zm4.6 11.4c-.2.5-1.1 1-1.5 1-.4 0-.9.1-2.9-.8-2.4-1-4-3.4-4.1-3.6-.1-.2-1-1.3-1-2.5s.6-1.8.9-2c.2-.2.5-.3.7-.3h.5c.2 0 .4 0 .6.4.2.5.7 1.7.8 1.8.1.2.1.3 0 .5-.1.2-.2.3-.3.5-.2.2-.3.3-.1.6.2.3.8 1.3 1.7 2.1 1.2 1 2.1 1.4 2.4 1.5.3.1.5.1.6-.1.2-.2.7-.8.9-1 .2-.3.4-.2.6-.1l1.6.8c.2.1.3.2.4.3.1.2.1.7-.1 1.2Z"/></svg>
            Open WhatsApp Chat
          </button>
        </div>
      </div>
    </div>
  );
}

// Already shown in the summary Fields grid above — don't repeat them here.
const SUMMARY_FIELD_KEYS = new Set(['nameLine', 'surname', 'nationalId', 'employerName', 'loanAmount', 'repaymentMonths']);

function extraDetailEntries(extraDetails: Record<string, any> | null | undefined): [string, any][] {
  return Object.entries(extraDetails || {}).filter(([k, v]) => !SUMMARY_FIELD_KEYS.has(k) && v !== null && v !== undefined && v !== '');
}

function humanizeFieldKey(key: string): string {
  return key.replace(/([a-z])([A-Z])/g, '$1 $2').replace(/^./, c => c.toUpperCase());
}

function FieldAgentAssignment({ agentPhone, onAssign }: { agentPhone: string | null; onAssign: (phone: string | null) => Promise<void> }) {
  const [agents, setAgents] = useState<Agent[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    // All agents, not just verified+active — a just-added agent (still
    // pending OTP) should still be assignable, not invisible in this list.
    requestJson('/agents').then(r => setAgents(r.agents));
  }, []);

  if (!agents) return <div className="h-14 rounded-lg skeleton animate-shimmer" />;

  function agentLabel(a: Agent) {
    const status = !a.verified ? ' (pending OTP)' : !a.active ? ' (deactivated)' : '';
    return `${a.name || a.phone_number} (${a.phone_number})${status}`;
  }

  const options = [
    { value: '', label: 'Unassigned' },
    ...agents.map(a => ({ value: a.phone_number, label: agentLabel(a) })),
  ];

  const currentKnown = agentPhone && agents.some(a => a.phone_number === agentPhone);

  async function handleChange(v: string) {
    setError(null);
    try {
      await onAssign(v || null);
    } catch (err: any) {
      setError(err.message || 'Could not assign agent.');
    }
  }

  return (
    <div>
      <Dropdown
        label="Field Agent"
        value={agentPhone && currentKnown ? agentPhone : ''}
        onChange={handleChange}
        options={agentPhone && !currentKnown ? [{ value: agentPhone, label: `${agentPhone} (not in agent list)` }, ...options] : options}
      />
      {error && <div className="text-xs text-accent mt-1.5">{error}</div>}
    </div>
  );
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="text-xs text-text-dim uppercase tracking-wide">{label}</div>
      <div className="font-semibold">{value}</div>
    </div>
  );
}

// Sensible starting points only — category doesn't determine product 1:1
// (e.g. an SME loan could be Standard USD or Farm Shop), so these are just
// what the panel pre-selects; the officer can change either.
const DEFAULT_PRODUCT_FOR_CATEGORY: Record<CategoryCode, LoanProduct> = {
  SSB: 'SSB',
  GOVT_PENSIONER: 'PENSIONS',
  SME: 'SME_STANDARD',
  PRIVATE_SECTOR: 'STANDARD_USD',
};

const DEFAULT_BORROWER_TYPE_FOR_CATEGORY: Record<CategoryCode, BorrowerType> = {
  SSB: 'SALARIED',
  GOVT_PENSIONER: 'SALARIED',
  SME: 'NON_SALARIED',
  PRIVATE_SECTOR: 'SALARIED',
};

const BORROWER_TYPES: { key: BorrowerType; label: string }[] = [
  { key: 'SALARIED', label: 'Salaried' },
  { key: 'NON_SALARIED', label: 'Non-Salaried' },
];

const NEGOTIATED_REPAYMENT_TYPES: { key: RepaymentType; label: string }[] = [
  { key: 'EQUAL_INSTALMENTS', label: 'Equal Instalments' },
  { key: 'INTEREST_ONLY_PRINCIPAL_AT_END', label: 'Interest Only + Principal at End' },
];

function LoanRepaymentCalculator({ application, onTermsChange }: {
  application: Application;
  onTermsChange: (terms: Partial<Pick<Application, 'loan_product' | 'borrower_type' | 'disbursement_date'>>) => void;
}) {
  const [product, setProduct] = useState<LoanProduct>(application.loan_product || DEFAULT_PRODUCT_FOR_CATEGORY[application.category]);
  const [borrowerType, setBorrowerType] = useState<BorrowerType>(application.borrower_type || DEFAULT_BORROWER_TYPE_FOR_CATEGORY[application.category]);
  const [disbursementDate, setDisbursementDate] = useState(application.disbursement_date || new Date().toISOString().slice(0, 10));
  const [repaymentStartDate, setRepaymentStartDate] = useState('');
  const [tenor, setTenor] = useState(application.repayment_months);
  const [result, setResult] = useState<CalculatorResultType | null>(null);
  const [computing, setComputing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // SME Negotiated only — not persisted to the application, re-entered per review.
  const [negotiatedRatePct, setNegotiatedRatePct] = useState(10);
  const [negotiatedImmtPct, setNegotiatedImmtPct] = useState(0);
  const [negotiatedBankPct, setNegotiatedBankPct] = useState(0);
  const [negotiatedEstablishmentPct, setNegotiatedEstablishmentPct] = useState(5);
  const [repaymentType, setRepaymentType] = useState<RepaymentType>('EQUAL_INSTALMENTS');
  const isNegotiated = product === 'SME_NEGOTIATED';

  async function compute(p: LoanProduct, b: BorrowerType, d: string, rsd: string, t: number) {
    setComputing(true);
    setError(null);
    try {
      const r = await requestJson('/calculator/compute', {
        method: 'POST',
        body: JSON.stringify({
          product: p, borrowerType: b, amountRequired: application.loan_amount,
          disbursementDate: d, repaymentStartDate: rsd || undefined, tenorMonths: t,
          negotiatedRates: p === 'SME_NEGOTIATED' ? {
            monthlyRatePct: negotiatedRatePct, immtPct: negotiatedImmtPct,
            bankChargePct: negotiatedBankPct, establishmentFeePct: negotiatedEstablishmentPct,
          } : undefined,
          repaymentType: p === 'SME_NEGOTIATED' ? repaymentType : undefined,
        }),
      });
      setResult(r);
    } catch (e: any) {
      setError(e.message || 'Failed to compute');
    } finally {
      setComputing(false);
    }
  }

  useEffect(() => {
    compute(product, borrowerType, disbursementDate, repaymentStartDate, tenor);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [application.id]);

  function changeProduct(p: LoanProduct) {
    setProduct(p);
    onTermsChange({ loan_product: p });
    compute(p, borrowerType, disbursementDate, repaymentStartDate, tenor);
  }
  function changeBorrowerType(b: BorrowerType) {
    setBorrowerType(b);
    onTermsChange({ borrower_type: b });
    compute(product, b, disbursementDate, repaymentStartDate, tenor);
  }
  function changeDate(d: string) {
    setDisbursementDate(d);
    onTermsChange({ disbursement_date: d });
    compute(product, borrowerType, d, repaymentStartDate, tenor);
  }
  function changeRepaymentStartDate(rsd: string) {
    setRepaymentStartDate(rsd);
    compute(product, borrowerType, disbursementDate, rsd, tenor);
  }
  function changeTenor(t: number) {
    setTenor(t);
    compute(product, borrowerType, disbursementDate, repaymentStartDate, t);
  }
  function recomputeNegotiated() {
    compute(product, borrowerType, disbursementDate, repaymentStartDate, tenor);
  }

  return (
    <div className="border-t border-rule pt-4 mb-6">
      <div className="text-xs uppercase tracking-wide text-text-dim mb-3 font-semibold">
        Repayment Calculator <span className="normal-case font-normal text-text-dim">for ${Number(application.loan_amount).toFixed(2)} requested</span>
      </div>
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5 mb-3">
        <Dropdown
          compact
          label="Product"
          value={product}
          onChange={changeProduct}
          options={Object.entries(LOAN_PRODUCT_LABELS).map(([k, v]) => ({ value: k as LoanProduct, label: v }))}
        />
        <Dropdown
          compact
          label="Borrower Type"
          value={borrowerType}
          onChange={changeBorrowerType}
          options={BORROWER_TYPES.map(b => ({ value: b.key, label: b.label }))}
        />
        <div>
          <label className="block text-[10.5px] text-text-dim mb-1">Disbursement Date</label>
          <input type="date" value={disbursementDate} onChange={e => changeDate(e.target.value)} className="w-full border border-rule rounded-lg px-2.5 py-2 text-xs bg-card" />
        </div>
        <div>
          <label className="block text-[10.5px] text-text-dim mb-1">Tenor (Months)</label>
          <input type="number" min={1} max={36} value={tenor} onChange={e => changeTenor(Number(e.target.value))} className="w-full border border-rule rounded-lg px-2.5 py-2 text-xs bg-card" />
        </div>
      </div>

      <div className="mb-4">
        <label className="block text-[10.5px] text-text-dim mb-1">Repayment Start Date (optional override)</label>
        <input
          type="date" value={repaymentStartDate} onChange={e => changeRepaymentStartDate(e.target.value)}
          placeholder="Auto from disbursement date"
          className="w-full sm:w-56 border border-rule rounded-lg px-2.5 py-2 text-xs bg-card"
        />
      </div>

      {isNegotiated && (
        <div className="border border-rule rounded-xl p-3.5 mb-4 bg-paper">
          <div className="text-[10.5px] uppercase tracking-wide text-text-dim font-semibold mb-2.5">Negotiated terms</div>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5 mb-2.5">
            <div>
              <label className="block text-[10.5px] text-text-dim mb-1">Monthly Rate (%)</label>
              <input type="number" step={0.1} value={negotiatedRatePct} onChange={e => setNegotiatedRatePct(Number(e.target.value))} onBlur={recomputeNegotiated} className="w-full border border-rule rounded-lg px-2.5 py-2 text-xs bg-card" />
            </div>
            <div>
              <label className="block text-[10.5px] text-text-dim mb-1">Establishment (%)</label>
              <input type="number" step={0.1} value={negotiatedEstablishmentPct} onChange={e => setNegotiatedEstablishmentPct(Number(e.target.value))} onBlur={recomputeNegotiated} className="w-full border border-rule rounded-lg px-2.5 py-2 text-xs bg-card" />
            </div>
            <div>
              <label className="block text-[10.5px] text-text-dim mb-1">IMMT (%)</label>
              <input type="number" step={0.1} value={negotiatedImmtPct} onChange={e => setNegotiatedImmtPct(Number(e.target.value))} onBlur={recomputeNegotiated} className="w-full border border-rule rounded-lg px-2.5 py-2 text-xs bg-card" />
            </div>
            <div>
              <label className="block text-[10.5px] text-text-dim mb-1">Bank Charge (%)</label>
              <input type="number" step={0.1} value={negotiatedBankPct} onChange={e => setNegotiatedBankPct(Number(e.target.value))} onBlur={recomputeNegotiated} className="w-full border border-rule rounded-lg px-2.5 py-2 text-xs bg-card" />
            </div>
          </div>
          <Dropdown
            compact
            label="Repayment Type"
            value={repaymentType}
            onChange={v => { setRepaymentType(v); compute(product, borrowerType, disbursementDate, repaymentStartDate, tenor); }}
            options={NEGOTIATED_REPAYMENT_TYPES.map(rt => ({ value: rt.key, label: rt.label }))}
          />
        </div>
      )}

      {computing && !result && <CalculatorResultSkeleton />}
      {error && <div className="text-xs text-accent">{error}</div>}
      {result && (
        <>
          <CalculatorResult result={result} />
          <AmortisationTable result={result} />
        </>
      )}
    </div>
  );
}
