import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

/** Merge conditional class names, resolving Tailwind conflicts (shadcn convention). */
export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

/** Shorten a content hash for display; provenance stays verifiable via the full hash. */
export function shortHash(hash: string, size = 8): string {
  return hash.length <= size ? hash : hash.slice(0, size);
}

/** Relative time for project cards (7.1); ISO 8601 in, display string out. */
export function formatRelativeTime(isoTimestamp: string, now = new Date()): string {
  const then = new Date(isoTimestamp).getTime();
  const deltaSeconds = Math.round((now.getTime() - then) / 1000);
  type RelativeUnit = 'second' | 'minute' | 'hour' | 'day' | 'week' | 'month' | 'year';
  const table: [number, RelativeUnit][] = [
    [60, 'second'],
    [3600, 'minute'],
    [86400, 'hour'],
    [86400 * 7, 'day'],
    [86400 * 30, 'week'],
    [86400 * 365, 'month'],
    [Number.POSITIVE_INFINITY, 'year'],
  ];
  const divisorFor: Record<RelativeUnit, number> = {
    second: 1,
    minute: 60,
    hour: 3600,
    day: 86400,
    week: 86400 * 7,
    month: 86400 * 30,
    year: 86400 * 365,
  };
  const formatter = new Intl.RelativeTimeFormat('en', { numeric: 'auto' });
  for (const [limit, unit] of table) {
    if (Math.abs(deltaSeconds) < limit) {
      return formatter.format(-Math.round(deltaSeconds / divisorFor[unit]), unit);
    }
  }
  return formatter.format(-Math.round(deltaSeconds / divisorFor.year), 'year');
}
