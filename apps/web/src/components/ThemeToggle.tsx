import { Moon, Sun } from 'lucide-react';
import { Button } from './ui/button';
import { useThemeStore } from '../state/themeStore';

/** Dark is the shipped default; light is opt-in via the CSS-variable mechanism. */
export function ThemeToggle({ className }: { className?: string }) {
  const theme = useThemeStore((state) => state.theme);
  const toggleTheme = useThemeStore((state) => state.toggleTheme);
  const isDark = theme === 'dark';
  return (
    <Button
      variant="ghost"
      size="icon"
      className={className}
      onClick={toggleTheme}
      title={isDark ? 'Switch to light theme' : 'Switch to dark theme'}
      aria-label={isDark ? 'Switch to light theme' : 'Switch to dark theme'}
    >
      {isDark ? <Sun aria-hidden /> : <Moon aria-hidden />}
    </Button>
  );
}
