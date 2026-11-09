import type { LucideIcon } from 'lucide-react';
import type * as React from 'react';
import { cn } from '../../lib/utils';

/**
 * Shared shell for status vocabulary chips: icon + label in a bordered chip.
 * The variant classes come from statusConfig; this shell adds no color of its own.
 */
export function StatusChip({
  icon: Icon,
  className,
  title,
  children,
  ...rest
}: React.ComponentProps<'span'> & { icon: LucideIcon; title: string }) {
  return (
    <span
      className={cn(
        'inline-flex shrink-0 items-center gap-1 rounded-sm border px-1.5 py-0.5 text-xs font-medium [&_svg]:size-3 [&_svg]:shrink-0',
        className,
      )}
      title={title}
      {...rest}
    >
      <Icon aria-hidden />
      <span>{children}</span>
    </span>
  );
}
