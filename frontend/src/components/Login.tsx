import { useState } from 'react';
import { login } from '../services/api';
import { AuthUser } from '../types';

export default function Login({ onSuccess }: { onSuccess: (user: AuthUser) => void }) {
  const [useOfficerLogin, setUseOfficerLogin] = useState(false);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError('');
    const user = await login(password, useOfficerLogin ? email : undefined);
    setLoading(false);
    if (user) onSuccess(user);
    else setError('Incorrect credentials.');
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-paper px-4">
      <form onSubmit={submit} className="bg-card border border-rule rounded-2xl p-8 sm:p-10 w-full max-w-sm">
        <div className="font-display text-2xl font-bold text-ink mb-1">Soledd</div>
        <div className="text-xs uppercase tracking-wider text-accent font-bold mb-8">Loan Origination · Admin</div>

        {useOfficerLogin && (
          <>
            <label className="block text-xs uppercase tracking-wide text-text-dim mb-2">Email</label>
            <input
              type="email"
              value={email}
              onChange={e => setEmail(e.target.value)}
              className="w-full border border-rule rounded-lg px-3.5 py-2.5 text-sm bg-card text-ink mb-4 focus:outline-none focus:border-accent"
              autoFocus
            />
          </>
        )}

        <label className="block text-xs uppercase tracking-wide text-text-dim mb-2">{useOfficerLogin ? 'Password' : 'Admin Password'}</label>
        <input
          type="password"
          value={password}
          onChange={e => setPassword(e.target.value)}
          className="w-full border border-rule rounded-lg px-3.5 py-2.5 text-sm bg-card text-ink mb-4 focus:outline-none focus:border-accent"
          autoFocus={!useOfficerLogin}
        />
        {error && <div className="text-accent text-sm mb-4">{error}</div>}
        <button
          type="submit"
          disabled={loading}
          className="w-full bg-accent hover:bg-accent-deep text-white font-semibold py-2.5 rounded-lg text-sm transition-colors disabled:opacity-60"
        >
          {loading ? 'Checking…' : 'Sign in'}
        </button>

        <button
          type="button"
          onClick={() => { setUseOfficerLogin(o => !o); setError(''); }}
          className="w-full text-center text-xs text-text-dim hover:text-accent-bright mt-4 transition-colors"
        >
          {useOfficerLogin ? 'Use the shared admin password instead' : 'Sign in with your officer email instead'}
        </button>
      </form>
    </div>
  );
}
