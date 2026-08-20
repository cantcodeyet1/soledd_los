import { useEffect, useState } from 'react';
import { requestJson, resetOwnPassword } from '../services/api';
import { AuthUser, CalculatorConfig, LoanProduct, LOAN_PRODUCT_LABELS, Officer, UserRole } from '../types';
import Dropdown from './Dropdown';

export default function ProfileView({ user, displayName, onDisplayNameChange }: {
  user: AuthUser;
  displayName: string;
  onDisplayNameChange: (name: string) => void;
}) {
  const [nameDraft, setNameDraft] = useState(displayName);
  const [nameSaved, setNameSaved] = useState(false);

  const isAdmin = user.role === 'ADMIN';
  const isOfficerAccount = user.email !== null;

  function saveName(e: React.FormEvent) {
    e.preventDefault();
    onDisplayNameChange(nameDraft.trim() || 'Tendai Marufu');
    setNameSaved(true);
    setTimeout(() => setNameSaved(false), 2000);
  }

  return (
    <div className="max-w-2xl mx-auto">
      <div className="mb-8 sm:mb-10 text-center">
        <div className="text-xs font-bold text-accent uppercase tracking-wide mb-2.5">Profile</div>
        <h1 className="font-display font-bold text-3xl sm:text-4xl tracking-tight">Account settings</h1>
        <div className="text-sm text-text-dim mt-2">
          {user.email || 'Shared admin login'} · <span className="font-semibold">{isAdmin ? 'System Administrator' : 'Credit Officer'}</span>
        </div>
      </div>

      <div className="border border-rule rounded-2xl p-6 bg-paper mb-6">
        <h2 className="font-display font-bold text-base mb-4">Display name</h2>
        <form onSubmit={saveName} className="flex flex-col sm:flex-row gap-2">
          <input
            value={nameDraft}
            onChange={e => setNameDraft(e.target.value)}
            className="flex-1 border border-rule rounded-lg px-3.5 py-2.5 text-sm bg-card focus:outline-none focus:border-accent"
          />
          <button type="submit" className="bg-solid hover:bg-solid-hover text-white text-sm font-semibold px-5 py-2.5 rounded-lg">
            {nameSaved ? 'Saved ✓' : 'Save'}
          </button>
        </form>
        <div className="text-xs text-text-dim mt-2.5">Shown as your initials in the top-right corner of the dashboard.</div>
      </div>

      {isOfficerAccount ? <OfficerPasswordCard /> : <SharedPasswordCard />}

      {isAdmin && <CalculatorRatesCard />}
      {isAdmin && <AgentCommissionCard />}
      {isAdmin && <CreditOfficersCard />}
    </div>
  );
}

function AgentCommissionCard() {
  const [pct, setPct] = useState<number | null>(null);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    requestJson('/agents/commission-rate').then(r => setPct(r.pct));
  }, []);

  async function save() {
    if (pct === null) return;
    setSaving(true);
    await requestJson('/agents/commission-rate', { method: 'PUT', body: JSON.stringify({ pct }) });
    setSaving(false);
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  }

  if (pct === null) return null;

  return (
    <div className="border border-rule rounded-2xl p-6 bg-paper mt-6">
      <h2 className="font-display font-bold text-base mb-1">Field agent commission</h2>
      <div className="text-xs text-text-dim mb-4">Percentage of the loan amount paid to the referring agent on approved loans.</div>
      <div className="flex items-end gap-3">
        <div className="flex-1 max-w-[160px]">
          <label className="block text-[11px] uppercase tracking-wide text-text-dim mb-1.5">Commission (%)</label>
          <input
            type="number" step={0.1} value={pct}
            onChange={e => setPct(Number(e.target.value))}
            className="w-full border border-rule rounded-lg px-3 py-2 text-sm bg-card"
          />
        </div>
        <button onClick={save} disabled={saving} className="border border-rule text-sm font-semibold px-4 py-2 rounded-lg hover:border-ink disabled:opacity-60">
          {saving ? 'Saving…' : saved ? 'Saved ✓' : 'Save'}
        </button>
      </div>
    </div>
  );
}

function SharedPasswordCard() {
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [pwSaving, setPwSaving] = useState(false);
  const [pwError, setPwError] = useState('');
  const [pwSuccess, setPwSuccess] = useState(false);

  async function changePassword(e: React.FormEvent) {
    e.preventDefault();
    setPwError('');
    setPwSuccess(false);

    if (newPassword.length < 8) {
      setPwError('New password must be at least 8 characters.');
      return;
    }
    if (newPassword !== confirmPassword) {
      setPwError('New password and confirmation do not match.');
      return;
    }

    setPwSaving(true);
    try {
      await requestJson('/profile/password', {
        method: 'POST',
        body: JSON.stringify({ currentPassword, newPassword }),
      });
      localStorage.setItem('soledd_admin_token', newPassword);
      setPwSuccess(true);
      setCurrentPassword(''); setNewPassword(''); setConfirmPassword('');
    } catch (err: any) {
      setPwError(err.message || 'Could not change password.');
    } finally {
      setPwSaving(false);
    }
  }

  return (
    <div className="border border-rule rounded-2xl p-6 bg-paper">
      <h2 className="font-display font-bold text-base mb-1">Change admin password</h2>
      <div className="text-xs text-text-dim mb-4">This changes the shared password used to sign in to this dashboard.</div>
      <form onSubmit={changePassword} className="flex flex-col gap-3">
        <div>
          <label className="block text-[11px] uppercase tracking-wide text-text-dim mb-1.5">Current password</label>
          <input type="password" required value={currentPassword} onChange={e => setCurrentPassword(e.target.value)} className="w-full border border-rule rounded-lg px-3.5 py-2.5 text-sm bg-card focus:outline-none focus:border-accent" />
        </div>
        <div>
          <label className="block text-[11px] uppercase tracking-wide text-text-dim mb-1.5">New password</label>
          <input type="password" required value={newPassword} onChange={e => setNewPassword(e.target.value)} className="w-full border border-rule rounded-lg px-3.5 py-2.5 text-sm bg-card focus:outline-none focus:border-accent" />
        </div>
        <div>
          <label className="block text-[11px] uppercase tracking-wide text-text-dim mb-1.5">Confirm new password</label>
          <input type="password" required value={confirmPassword} onChange={e => setConfirmPassword(e.target.value)} className="w-full border border-rule rounded-lg px-3.5 py-2.5 text-sm bg-card focus:outline-none focus:border-accent" />
        </div>
        {pwError && <div className="text-accent text-sm">{pwError}</div>}
        {pwSuccess && <div className="text-sage text-sm">Password updated.</div>}
        <button type="submit" disabled={pwSaving} className="bg-accent hover:bg-accent-deep text-white text-sm font-semibold px-5 py-2.5 rounded-lg w-fit mx-auto disabled:opacity-60">
          {pwSaving ? 'Updating…' : 'Update password'}
        </button>
      </form>
    </div>
  );
}

function OfficerPasswordCard() {
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [pwSaving, setPwSaving] = useState(false);
  const [pwError, setPwError] = useState('');
  const [pwSuccess, setPwSuccess] = useState(false);

  async function changePassword(e: React.FormEvent) {
    e.preventDefault();
    setPwError('');
    setPwSuccess(false);

    if (newPassword.length < 8) {
      setPwError('New password must be at least 8 characters.');
      return;
    }
    if (newPassword !== confirmPassword) {
      setPwError('New password and confirmation do not match.');
      return;
    }

    setPwSaving(true);
    try {
      await resetOwnPassword(newPassword, currentPassword);
      setPwSuccess(true);
      setCurrentPassword(''); setNewPassword(''); setConfirmPassword('');
    } catch (err: any) {
      setPwError(err.message || 'Could not change password.');
    } finally {
      setPwSaving(false);
    }
  }

  return (
    <div className="border border-rule rounded-2xl p-6 bg-paper">
      <h2 className="font-display font-bold text-base mb-1">Change your password</h2>
      <div className="text-xs text-text-dim mb-4">Only you can sign in with this.</div>
      <form onSubmit={changePassword} className="flex flex-col gap-3">
        <div>
          <label className="block text-[11px] uppercase tracking-wide text-text-dim mb-1.5">Current password</label>
          <input type="password" required value={currentPassword} onChange={e => setCurrentPassword(e.target.value)} className="w-full border border-rule rounded-lg px-3.5 py-2.5 text-sm bg-card focus:outline-none focus:border-accent" />
        </div>
        <div>
          <label className="block text-[11px] uppercase tracking-wide text-text-dim mb-1.5">New password</label>
          <input type="password" required value={newPassword} onChange={e => setNewPassword(e.target.value)} className="w-full border border-rule rounded-lg px-3.5 py-2.5 text-sm bg-card focus:outline-none focus:border-accent" />
        </div>
        <div>
          <label className="block text-[11px] uppercase tracking-wide text-text-dim mb-1.5">Confirm new password</label>
          <input type="password" required value={confirmPassword} onChange={e => setConfirmPassword(e.target.value)} className="w-full border border-rule rounded-lg px-3.5 py-2.5 text-sm bg-card focus:outline-none focus:border-accent" />
        </div>
        {pwError && <div className="text-accent text-sm">{pwError}</div>}
        {pwSuccess && <div className="text-sage text-sm">Password updated.</div>}
        <button type="submit" disabled={pwSaving} className="bg-accent hover:bg-accent-deep text-white text-sm font-semibold px-5 py-2.5 rounded-lg w-fit mx-auto disabled:opacity-60">
          {pwSaving ? 'Updating…' : 'Update password'}
        </button>
      </form>
    </div>
  );
}

function CalculatorRatesCard() {
  const [config, setConfig] = useState<CalculatorConfig | null>(null);
  const [ratesSaving, setRatesSaving] = useState(false);
  const [ratesSaved, setRatesSaved] = useState(false);

  useEffect(() => {
    requestJson('/calculator/rates').then(setConfig);
  }, []);

  function updateProductRate(key: LoanProduct, monthlyRatePct: number) {
    if (!config) return;
    setConfig({ ...config, products: { ...config.products, [key]: { ...config.products[key], monthlyRatePct } } });
  }

  function updateUpfront(key: keyof CalculatorConfig['upfront'], value: number) {
    if (!config) return;
    setConfig({ ...config, upfront: { ...config.upfront, [key]: value } });
  }

  async function saveRates() {
    if (!config) return;
    setRatesSaving(true);
    await requestJson('/calculator/rates', { method: 'PUT', body: JSON.stringify(config) });
    setRatesSaving(false);
    setRatesSaved(true);
    setTimeout(() => setRatesSaved(false), 2000);
  }

  if (!config) return null;

  return (
    <div className="border border-rule rounded-2xl p-6 bg-paper mt-6">
      <h2 className="font-display font-bold text-base mb-1">Loan calculator rates</h2>
      <div className="text-xs text-text-dim mb-4">Applies to every quote and every application's repayment schedule dashboard-wide.</div>

      <div className="text-[11px] uppercase tracking-wide text-text-dim mb-1.5">Monthly rate per product (%)</div>
      <div className="grid grid-cols-2 gap-2.5 mb-4">
        {(Object.keys(config.products) as LoanProduct[]).map(p => (
          <div key={p}>
            <label className="block text-[10.5px] text-text-dim mb-1">{LOAN_PRODUCT_LABELS[p]}</label>
            <input
              type="number" step={0.1} value={config.products[p].monthlyRatePct}
              onChange={e => updateProductRate(p, Number(e.target.value))}
              className="w-full border border-rule rounded-lg px-3 py-2 text-sm bg-card"
            />
          </div>
        ))}
      </div>

      <div className="text-[11px] uppercase tracking-wide text-text-dim mb-1.5">Upfront charges &amp; collection fee (%)</div>
      <div className="grid grid-cols-2 gap-2.5">
        <UpfrontField label="IMMT" value={config.upfront.immtPct} onChange={v => updateUpfront('immtPct', v)} />
        <UpfrontField label="Bank Charge" value={config.upfront.bankChargePct} onChange={v => updateUpfront('bankChargePct', v)} />
        <UpfrontField label="ZiG Bank Charge" value={config.upfront.zigBankChargePct} onChange={v => updateUpfront('zigBankChargePct', v)} />
        <UpfrontField label="ZiG Bank Charge Min ($)" value={config.upfront.zigBankChargeMin} onChange={v => updateUpfront('zigBankChargeMin', v)} />
        <UpfrontField label="Establishment Fee" value={config.upfront.establishmentFeePct} onChange={v => updateUpfront('establishmentFeePct', v)} />
        <UpfrontField label="Loan Protection" value={config.upfront.loanProtectionFeePct} onChange={v => updateUpfront('loanProtectionFeePct', v)} />
        <UpfrontField label="Collection Fee" value={config.upfront.collectionFeePct} onChange={v => updateUpfront('collectionFeePct', v)} />
      </div>

      <button onClick={saveRates} disabled={ratesSaving} className="border border-rule text-sm font-semibold px-4 py-2 rounded-lg hover:border-ink mt-4 disabled:opacity-60 w-full sm:w-auto">
        {ratesSaving ? 'Saving…' : ratesSaved ? 'Saved ✓' : 'Save Rates'}
      </button>
    </div>
  );
}

const ROLE_LABELS: Record<UserRole, string> = { STAFF: 'Staff', ADMIN: 'Administrator' };

function inviteMailto(notice: { name: string; email: string; tempPassword: string }): string {
  const firstName = notice.name.trim().split(/\s+/)[0] || notice.name;
  const subject = 'Your Soledd Loans dashboard login';
  const body = [
    `Hi ${firstName},`,
    '',
    "You've been added as a credit officer on the Soledd Loans dashboard. Here's your temporary login:",
    '',
    `Email: ${notice.email}`,
    `Temporary password: ${notice.tempPassword}`,
    '',
    "Sign in with the link I gave you. You'll be asked to set your own password on first login.",
    '',
    'This password is temporary; please don\'t share it beyond your own login.',
  ].join('\n');
  return `mailto:${notice.email}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
}

function CreditOfficersCard() {
  const [officers, setOfficers] = useState<Officer[]>([]);
  const [showAddOfficer, setShowAddOfficer] = useState(false);
  const [officerName, setOfficerName] = useState('');
  const [officerEmail, setOfficerEmail] = useState('');
  const [officerBranch, setOfficerBranch] = useState('');
  const [officerRole, setOfficerRole] = useState<UserRole>('STAFF');
  const [officerSaving, setOfficerSaving] = useState(false);
  const [inviteNotice, setInviteNotice] = useState<{ name: string; email: string; tempPassword: string; emailSent: boolean } | null>(null);

  useEffect(() => { loadOfficers(); }, []);

  async function loadOfficers() {
    const r = await requestJson('/officers');
    setOfficers(r.officers);
  }

  async function addOfficer(e: React.FormEvent) {
    e.preventDefault();
    setOfficerSaving(true);
    try {
      const r = await requestJson('/officers', {
        method: 'POST',
        body: JSON.stringify({ name: officerName, email: officerEmail, branch: officerBranch, role: officerRole }),
      });
      setInviteNotice({ name: r.officer.name, email: r.officer.email, tempPassword: r.tempPassword, emailSent: r.emailSent });
      setShowAddOfficer(false);
      setOfficerName(''); setOfficerEmail(''); setOfficerBranch(''); setOfficerRole('STAFF');
      await loadOfficers();
    } finally {
      setOfficerSaving(false);
    }
  }

  async function resendInvite(o: Officer) {
    const r = await requestJson(`/officers/${o.id}/resend-invite`, { method: 'POST' });
    setInviteNotice({ name: o.name, email: o.email || '', tempPassword: r.tempPassword, emailSent: r.emailSent });
    await loadOfficers();
  }

  async function removeOfficer(id: string) {
    if (!confirm('Remove this credit officer?')) return;
    await requestJson(`/officers/${id}`, { method: 'DELETE' });
    await loadOfficers();
  }

  return (
    <div className="border border-rule rounded-2xl p-6 bg-paper mt-6">
      <div className="flex justify-between items-start mb-1 gap-3">
        <h2 className="font-display font-bold text-base">Credit officers</h2>
        <button onClick={() => setShowAddOfficer(o => !o)} className="text-xs font-semibold text-accent-bright hover:underline shrink-0">
          {showAddOfficer ? 'Cancel' : '+ Add officer'}
        </button>
      </div>
      <div className="text-xs text-text-dim mb-4">Identified by email, not phone. Each gets their own dashboard login.</div>

      {inviteNotice && (
        <div className="border border-accent-bright/40 bg-accent-wash rounded-xl p-4 mb-4 text-sm">
          <div className="font-semibold mb-1">{inviteNotice.name} can now sign in</div>
          {inviteNotice.emailSent ? (
            <div className="text-text-dim mb-2">An invite with a temporary password was emailed to {inviteNotice.email}.</div>
          ) : (
            <div className="mb-2">
              <div className="text-text-dim mb-1">Email wasn't sent (no email service configured yet). Share this temporary password with them directly:</div>
              <div className="font-mono-brand font-bold text-base">{inviteNotice.tempPassword}</div>
            </div>
          )}
          <div className="flex items-center gap-3">
            <a href={inviteMailto(inviteNotice)} className="text-xs font-semibold text-accent-bright hover:underline">Open in Email App</a>
            <button onClick={() => setInviteNotice(null)} className="text-xs text-accent-bright font-semibold">Dismiss</button>
          </div>
        </div>
      )}

      {showAddOfficer && (
        <form onSubmit={addOfficer} className="border border-rule rounded-xl p-4 mb-4 flex flex-wrap gap-3 items-end bg-card">
          <div className="flex-1 min-w-[140px]">
            <label className="block text-[11px] uppercase tracking-wide text-text-dim mb-1.5">Name</label>
            <input required value={officerName} onChange={e => setOfficerName(e.target.value)} className="border border-rule rounded-lg px-3 py-2 text-sm w-full bg-paper" />
          </div>
          <div className="flex-1 min-w-[180px]">
            <label className="block text-[11px] uppercase tracking-wide text-text-dim mb-1.5">Email</label>
            <input type="email" required value={officerEmail} onChange={e => setOfficerEmail(e.target.value)} className="border border-rule rounded-lg px-3 py-2 text-sm w-full bg-paper" />
          </div>
          <div className="flex-1 min-w-[120px]">
            <label className="block text-[11px] uppercase tracking-wide text-text-dim mb-1.5">Branch</label>
            <input value={officerBranch} onChange={e => setOfficerBranch(e.target.value)} className="border border-rule rounded-lg px-3 py-2 text-sm w-full bg-paper" />
          </div>
          <div className="min-w-[140px]">
            <Dropdown
              label="Role"
              value={officerRole}
              onChange={setOfficerRole}
              options={[{ value: 'STAFF', label: 'Staff' }, { value: 'ADMIN', label: 'Administrator' }]}
            />
          </div>
          <button type="submit" disabled={officerSaving} className="bg-solid hover:bg-solid-hover text-white text-sm font-semibold px-4 py-2 rounded-lg disabled:opacity-60 transition-colors">
            {officerSaving ? 'Adding…' : 'Add & Invite'}
          </button>
        </form>
      )}

      <div className="border border-rule rounded-xl overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm min-w-[560px]">
            <thead>
              <tr className="text-left text-[10.5px] uppercase tracking-wide text-text-dim border-b border-rule bg-card">
                <th className="px-4 py-2.5">Name</th><th className="px-4 py-2.5">Email</th><th className="px-4 py-2.5">Role</th><th className="px-4 py-2.5">Branch</th><th className="px-4 py-2.5"></th>
              </tr>
            </thead>
            <tbody>
              {officers.map(o => (
                <tr key={o.id} className="border-b border-rule last:border-0">
                  <td className="px-4 py-2.5 font-semibold">{o.name}</td>
                  <td className="px-4 py-2.5 font-mono-brand text-text-dim">{o.email || '-'}</td>
                  <td className="px-4 py-2.5">
                    <span className="text-[10.5px] font-bold uppercase px-2 py-0.5 rounded-full bg-info-bg text-info">{ROLE_LABELS[o.role]}</span>
                    {o.must_reset_password && <span className="ml-1.5 text-[10.5px] font-bold uppercase px-2 py-0.5 rounded-full bg-warn-bg text-warn">Pending</span>}
                  </td>
                  <td className="px-4 py-2.5">{o.branch || '-'}</td>
                  <td className="px-4 py-2.5">
                    <div className="flex gap-2.5">
                      <button onClick={() => resendInvite(o)} className="text-xs text-accent-bright font-semibold">Resend Invite</button>
                      <button onClick={() => removeOfficer(o.id)} className="text-xs text-accent font-semibold">Remove</button>
                    </div>
                  </td>
                </tr>
              ))}
              {officers.length === 0 && <tr><td colSpan={5} className="text-center py-8 text-text-dim text-sm">No credit officers yet</td></tr>}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

function UpfrontField({ label, value, onChange }: { label: string; value: number; onChange: (v: number) => void }) {
  return (
    <div>
      <label className="block text-[10.5px] text-text-dim mb-1">{label}</label>
      <input
        type="number" step={0.1} value={value}
        onChange={e => onChange(Number(e.target.value))}
        className="w-full border border-rule rounded-lg px-3 py-2 text-sm bg-card"
      />
    </div>
  );
}
