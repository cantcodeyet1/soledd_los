import { useEffect, useState } from 'react';

export type Theme = 'light' | 'dark';

function applyTheme(theme: Theme) {
  document.documentElement.setAttribute('data-theme', theme);
  localStorage.setItem('soledd_theme', theme);
}

export function getInitialTheme(): Theme {
  const stored = localStorage.getItem('soledd_theme') as Theme | null;
  if (stored === 'light' || stored === 'dark') return stored;
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

export function useTheme() {
  const [theme, setThemeState] = useState<Theme>(getInitialTheme);

  useEffect(() => { applyTheme(theme); }, [theme]);

  function setTheme(t: Theme) {
    setThemeState(t);
  }

  function toggleTheme() {
    setThemeState(t => (t === 'dark' ? 'light' : 'dark'));
  }

  return { theme, setTheme, toggleTheme };
}
