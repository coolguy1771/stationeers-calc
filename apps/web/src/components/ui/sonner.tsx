import { Toaster as Sonner, type ToasterProps } from 'sonner';
import { useThemeStore } from '../../state/themeStore';

/** App-wide toast host; theme follows the theme store so toasts match the panel. */
function Toaster(props: ToasterProps) {
  const theme = useThemeStore((state) => state.theme);
  return <Sonner theme={theme} position="bottom-right" {...props} />;
}

export { Toaster };
