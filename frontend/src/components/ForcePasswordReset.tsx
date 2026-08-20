import { useState } from 'react';
import { resetOwnPassword } from '../services/api';

export default function ForcePasswordReset({ onDone }: { onDone: () => void }) {
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    if (newPassword.length < 8) {
      setError('Password must be at least 8 characters.');
      return;
    }
    if (newPassword !== confirmPassword) {
      setError('Passwords do not match.');
      return;
    }
    setSaving(true);
    try {
      await resetOwnPassword(newPassword);
      onDone();
    } catch (err: any) {
      setError(err.message || 'Could not set password.');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-paper px-4">
      <form onSubmit={submit} className="bg-card border border-rule rounded-2xl p-8 sm:p-10 w-full max-w-sm">
        <div className="font-display text-2xl font-bold text-ink mb-1">Welcome</div>
        <div className="text-xs uppercase tracking-wider text-accent font-bold mb-6">Set your password</div>
        <div className="text-sm text-text-dim mb-6">You signed in with a temporary password. Choose a new one to continue.</div>

        <label className="block text-xs uppercase tracking-wide text-text-dim mb-2">New password</label>
        <input
          type="password"
          value={newPassword}
          onChange={e => setNewPassword(e.target.value)}
          className="w-full border border-rule rounded-lg px-3.5 py-2.5 text-sm mb-4 focus:outline-none focus:border-accent"
          autoFocus
        />
        <label className="block text-xs uppercase tracking-wide text-text-dim mb-2">Confirm password</label>
        <input
          type="password"
          value={confirmPassword}
          onChange={e => setConfirmPassword(e.target.value)}
          className="w-full border border-rule rounded-lg px-3.5 py-2.5 text-sm mb-4 focus:outline-none focus:border-accent"
        />
        {error && <div className="text-accent text-sm mb-4">{error}</div>}
        <button
          type="submit"
          disabled={saving}
          className="w-full bg-accent hover:bg-accent-deep text-white font-semibold py-2.5 rounded-lg text-sm transition-colors disabled:opacity-60"
        >
          {saving ? 'Saving…' : 'Set password and continue'}
        </button>
      </form>
    </div>
  );
}
