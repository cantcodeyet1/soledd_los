import { useState } from 'react';

export const ONBOARDING_KEY = 'soledd_onboarding_dismissed';

const STEPS: { title: string; body: string; icon: JSX.Element }[] = [
  {
    title: 'Welcome to Soledd Loans',
    body: "This is your loan origination dashboard. Everything a customer submits via WhatsApp lands here for your team to review.",
    icon: (
      <path d="M10 2 12.2 7.4 18 8l-4.3 3.9L14.9 18 10 14.8 5.1 18l1.2-6.1L2 8l5.8-.6Z" />
    ),
  },
  {
    title: 'Review and decide on loans',
    body: 'Open any application to see full details and submitted documents, then approve or reject with a tap. Export a filled loan agreement PDF in one click.',
    icon: (
      <>
        <path d="M5 2.5h7l3 3V17a.5.5 0 0 1-.5.5h-9A.5.5 0 0 1 5 17V3a.5.5 0 0 1 .5-.5Z" />
        <path d="M7 8h6M7 11h6M7 14h4" />
      </>
    ),
  },
  {
    title: 'Quote any loan instantly',
    body: "Work out instalments and the full repayment schedule for a product before it's even applied for, or open the calculator on any live loan to see its own terms.",
    icon: (
      <>
        <rect x="4" y="2.5" width="12" height="15" rx="1.5" />
        <path d="M7 6h6M7 9.5h1.5M11.5 9.5H13M7 13h1.5M11.5 13H13" />
      </>
    ),
  },
  {
    title: 'Manage your field agents',
    body: "Add agents, track what they've brought in, and review applications from people wanting to become an agent, right from this page.",
    icon: (
      <>
        <circle cx="7" cy="6" r="2.5" />
        <circle cx="14" cy="7.5" r="2" />
        <path d="M2.5 17c.4-3 2.2-4.8 4.5-4.8s4.1 1.8 4.5 4.8M12 12.7c1.9.2 3.2 1.7 3.5 4.3" />
      </>
    ),
  },
  {
    title: 'Follow every conversation',
    body: "The Chats page is your WhatsApp inbox for clients. Filter by abandoned or waiting-on-documents, open a thread to read the full exchange, and tap the header for a profile panel with their details and linked loans.",
    icon: (
      <>
        <path d="M3 5.5A1.5 1.5 0 0 1 4.5 4h11A1.5 1.5 0 0 1 17 5.5v7A1.5 1.5 0 0 1 15.5 14H8l-4 3v-3H4.5A1.5 1.5 0 0 1 3 12.5Z" />
        <path d="M7 8h6M7 10.5h4" />
      </>
    ),
  },
  {
    title: 'Your account, your settings',
    body: 'Update your name and password from Profile. Administrators can also manage calculator rates and credit officer accounts from that same page.',
    icon: (
      <>
        <circle cx="10" cy="10" r="2.5" />
        <path d="M10 3v2M10 15v2M17 10h-2M5 10H3M14.9 5.1l-1.4 1.4M6.5 13.5l-1.4 1.4M14.9 14.9l-1.4-1.4M6.5 6.5 5.1 5.1" />
      </>
    ),
  },
];

export default function OnboardingTour({ onDismiss }: { onDismiss: () => void }) {
  const [step, setStep] = useState(0);
  const isLast = step === STEPS.length - 1;
  const current = STEPS[step];

  function finish() {
    localStorage.setItem(ONBOARDING_KEY, '1');
    onDismiss();
  }

  return (
    <div className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center z-[100] p-6 animate-overlayIn">
      <div className="bg-card rounded-2xl max-w-md w-full p-8 animate-modalIn relative">
        <button onClick={finish} className="absolute top-5 right-5 text-xs font-semibold text-text-dim hover:text-accent-bright transition-colors">
          Skip
        </button>

        <div className="w-14 h-14 rounded-2xl bg-accent-wash text-accent-deep flex items-center justify-center mb-6">
          <svg width="26" height="26" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
            {current.icon}
          </svg>
        </div>

        <h2 className="font-display font-bold text-xl mb-2">{current.title}</h2>
        <p className="text-sm text-text-dim leading-relaxed mb-8">{current.body}</p>

        <div className="flex items-center justify-between">
          <div className="flex gap-1.5">
            {STEPS.map((_, i) => (
              <div key={i} className={`h-1.5 rounded-full transition-all duration-300 ${i === step ? 'w-6 bg-accent-bright' : 'w-1.5 bg-rule'}`} />
            ))}
          </div>

          <div className="flex gap-2">
            {step > 0 && (
              <button onClick={() => setStep(s => s - 1)} className="text-sm font-semibold text-text-dim hover:text-ink px-3 py-2 transition-colors">
                Back
              </button>
            )}
            <button
              onClick={() => isLast ? finish() : setStep(s => s + 1)}
              className="bg-accent hover:bg-accent-deep text-white text-sm font-semibold px-5 py-2 rounded-lg transition-colors"
            >
              {isLast ? 'Get Started' : 'Next'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
