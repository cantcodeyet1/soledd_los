import { useEffect, useState } from 'react';
import Login from './components/Login';
import ApplicationsView from './components/ApplicationsView';
import ConversationsView from './components/ConversationsView';
import CalculatorView from './components/CalculatorView';
import AgentsView from './components/AgentsView';
import ProfileView from './components/ProfileView';
import ForcePasswordReset from './components/ForcePasswordReset';
import OnboardingTour, { ONBOARDING_KEY } from './components/OnboardingTour';
import { getStoredUser, clearSession } from './services/api';
import { AuthUser } from './types';
import { useTheme } from './hooks/useTheme';

type View = 'queue' | 'chats' | 'calculator' | 'agents' | 'profile';

const NAV: { id: View; label: string }[] = [
  { id: 'queue', label: 'Loans' },
  { id: 'calculator', label: 'Calculators' },
  { id: 'agents', label: 'Field Agents' },
  { id: 'chats', label: 'Chats' },
];

function initialsFrom(name: string) {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return 'TM';
  return (parts[0][0] + (parts[1]?.[0] || '')).toUpperCase();
}

export default function App() {
  const [user, setUser] = useState<AuthUser | null>(() => getStoredUser());
  const [view, setView] = useState<View>('queue');
  const [menuOpen, setMenuOpen] = useState(false);
  const [displayName, setDisplayName] = useState(() => localStorage.getItem('soledd_display_name') || getStoredUser()?.name || 'Tendai Marufu');
  const [showTour, setShowTour] = useState(() => !localStorage.getItem(ONBOARDING_KEY));
  const [jumpApplicationId, setJumpApplicationId] = useState<string | null>(null);
  const { theme, toggleTheme } = useTheme();

  useEffect(() => {
    const onStorage = () => setDisplayName(localStorage.getItem('soledd_display_name') || user?.name || 'Tendai Marufu');
    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  }, [user]);

  if (!user) return <Login onSuccess={u => { setUser(u); setDisplayName(u.name); }} />;

  if (user.mustResetPassword) {
    return <ForcePasswordReset onDone={() => setUser({ ...user, mustResetPassword: false })} />;
  }

  function go(v: View) {
    setView(v);
    setMenuOpen(false);
  }

  function updateDisplayName(name: string) {
    setDisplayName(name);
    localStorage.setItem('soledd_display_name', name);
  }

  function signOut() {
    clearSession();
    setUser(null);
  }

  function openApplication(id: string) {
    setJumpApplicationId(id);
    go('queue');
  }

  return (
    <div className="min-h-screen bg-card">
      <nav className="flex items-center gap-9 px-5 sm:px-8 lg:px-10 h-16 border-b border-rule relative">
        <button onClick={() => go('queue')} className="font-display font-bold text-base text-ink">Soledd</button>

        <div className="hidden md:flex items-center gap-9">
          {NAV.map(n => (
            <button
              key={n.id}
              onClick={() => go(n.id)}
              className={`nav-link text-sm font-semibold pb-1 ${view === n.id ? 'active text-ink' : 'text-text-dim hover:text-ink'}`}
            >
              {n.label}
            </button>
          ))}
        </div>

        <div className="ml-auto flex items-center gap-3">
          <button
            onClick={toggleTheme}
            aria-label="Toggle dark mode"
            className="w-9 h-9 rounded-full border border-rule flex items-center justify-center text-text-dim hover:text-ink hover:border-ink transition-colors"
          >
            {theme === 'dark' ? (
              <svg width="16" height="16" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round"><circle cx="10" cy="10" r="4"/><path d="M10 2v2M10 16v2M18 10h-2M4 10H2M15.5 4.5l-1.4 1.4M5.9 14.1l-1.4 1.4M15.5 15.5l-1.4-1.4M5.9 5.9 4.5 4.5"/></svg>
            ) : (
              <svg width="16" height="16" viewBox="0 0 20 20" fill="currentColor"><path d="M17.3 12.9a7 7 0 0 1-8.6-9.6 7.4 7.4 0 1 0 8.6 9.6Z"/></svg>
            )}
          </button>
          <button
            onClick={() => go('profile')}
            className={`w-[30px] h-[30px] rounded-full bg-info-bg text-info flex items-center justify-center text-xs font-bold transition-transform hover:scale-105 ${view === 'profile' ? 'ring-2 ring-accent-bright' : ''}`}
          >
            {initialsFrom(displayName)}
          </button>
          <button
            onClick={signOut}
            className="hidden sm:block text-xs text-text-dim hover:text-ink"
          >
            Sign out
          </button>
          <button
            onClick={() => setMenuOpen(o => !o)}
            className="md:hidden w-9 h-9 flex items-center justify-center rounded-md border border-rule"
            aria-label="Menu"
          >
            <svg width="18" height="18" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round"><path d="M3 6h14M3 10h14M3 14h14"/></svg>
          </button>
        </div>

        {menuOpen && (
          <div className="absolute top-16 left-0 right-0 bg-card border-b border-rule flex flex-col md:hidden z-20 shadow-sm animate-modalIn">
            {NAV.map(n => (
              <button
                key={n.id}
                onClick={() => go(n.id)}
                className={`text-left px-5 py-3.5 text-sm font-semibold border-b border-rule last:border-0 ${view === n.id ? 'text-accent' : 'text-ink'}`}
              >
                {n.label}
              </button>
            ))}
            <button
              onClick={signOut}
              className="text-left px-5 py-3.5 text-sm text-text-dim"
            >
              Sign out
            </button>
          </div>
        )}
      </nav>

      <main className="max-w-[1440px] mx-auto px-5 sm:px-8 lg:px-10 py-8 sm:py-12 pb-20">
        {view === 'queue' && (
          <ApplicationsView
            initialApplicationId={jumpApplicationId}
            onConsumedInitialApplication={() => setJumpApplicationId(null)}
          />
        )}
        {view === 'chats' && <ConversationsView onOpenApplication={openApplication} />}
        {view === 'calculator' && <CalculatorView />}
        {view === 'agents' && <AgentsView onOpenApplication={openApplication} />}
        {view === 'profile' && (
          <ProfileView
            user={user}
            displayName={displayName}
            onDisplayNameChange={updateDisplayName}
            onReplayTour={() => setShowTour(true)}
          />
        )}
      </main>

      {showTour && <OnboardingTour onDismiss={() => setShowTour(false)} />}
    </div>
  );
}
