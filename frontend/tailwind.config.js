/** @type {import('tailwindcss').Config} */
export default {
  darkMode: ['selector', '[data-theme="dark"]'],
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        ink: 'var(--c-ink)',
        paper: 'var(--c-paper)',
        card: 'var(--c-card)',
        'card-tint': 'var(--c-card-tint)',
        cream: 'var(--c-cream)',
        rule: 'var(--c-rule)',
        solid: 'var(--c-solid)',
        'solid-hover': 'var(--c-solid-hover)',
        accent: 'var(--c-accent)',
        'accent-deep': 'var(--c-accent-deep)',
        'accent-bright': 'var(--c-accent-bright)',
        'accent-wash': 'var(--c-accent-wash)',
        gold: 'var(--c-gold)',
        sage: 'var(--c-sage)',
        'sage-bg': 'var(--c-sage-bg)',
        info: 'var(--c-info)',
        'info-bg': 'var(--c-info-bg)',
        warn: 'var(--c-warn)',
        'warn-bg': 'var(--c-warn-bg)',
        slate: 'var(--c-slate)',
        'slate-bg': 'var(--c-slate-bg)',
        ink2: 'var(--c-ink2)',
        'text-dim': 'var(--c-text-dim)',
      },
      keyframes: {
        modalIn: {
          '0%': { opacity: '0', transform: 'scale(0.96) translateY(4px)' },
          '100%': { opacity: '1', transform: 'scale(1) translateY(0)' },
        },
        overlayIn: {
          '0%': { opacity: '0' },
          '100%': { opacity: '1' },
        },
        shimmer: {
          '0%': { backgroundPosition: '-400px 0' },
          '100%': { backgroundPosition: '400px 0' },
        },
        panelIn: {
          '0%': { transform: 'translateX(100%)' },
          '100%': { transform: 'translateX(0)' },
        },
      },
      animation: {
        modalIn: 'modalIn 0.22s cubic-bezier(0.16,1,0.3,1)',
        overlayIn: 'overlayIn 0.18s ease-out',
        shimmer: 'shimmer 1.4s ease-in-out infinite',
        panelIn: 'panelIn 0.32s cubic-bezier(0.16,1,0.3,1)',
      },
    },
  },
  plugins: [],
}
