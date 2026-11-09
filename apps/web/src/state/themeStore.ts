import { create } from 'zustand';

/**
 * Theme is transient UI state (spec 2.1) and may live in Zustand.
 * Dark is the shipped default (UI-01); `index.html` already carries class="dark"
 * so first paint matches before hydration. Persisted locally; offline-safe.
 */
export type Theme = 'dark' | 'light';

const STORAGE_KEY = 'stationeers-engineer.theme';

function readInitialTheme(): Theme {
  if (typeof window === 'undefined') return 'dark';
  try {
    const stored = window.localStorage.getItem(STORAGE_KEY);
    return stored === 'light' || stored === 'dark' ? stored : 'dark';
  } catch {
    return 'dark';
  }
}

function applyThemeClass(theme: Theme): void {
  const root = document.documentElement;
  root.classList.toggle('dark', theme === 'dark');
  root.classList.toggle('light', theme === 'light');
}

interface ThemeState {
  theme: Theme;
  setTheme: (theme: Theme) => void;
  toggleTheme: () => void;
}

export const useThemeStore = create<ThemeState>()((set, get) => {
  const initial = readInitialTheme();
  applyThemeClass(initial);
  return {
    theme: initial,
    setTheme: (theme) => {
      applyThemeClass(theme);
      try {
        window.localStorage.setItem(STORAGE_KEY, theme);
      } catch {
        // storage may be unavailable (private mode); theme still applies for the session
      }
      set({ theme });
    },
    toggleTheme: () => {
      get().setTheme(get().theme === 'dark' ? 'light' : 'dark');
    },
  };
});
