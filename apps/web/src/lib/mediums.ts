import type { ConnectionMedium } from '@stationeers/domain';

/**
 * Presentation vocabulary for connection media (spec 4.3; §7.3 "display network
 * categories").
 *
 * Media are engineering categories, not statuses: these colors mark ports and
 * edges only (small dots, handles, strokes) and never fill a badge or a chip,
 * so they cannot be mistaken for the status vocabulary of 3.5/5.2/8. Unknown
 * media — a missing pack definition — render neutral and are named as unknown
 * rather than guessed (6.5, 4.7).
 */
export const MEDIUM_LABEL: Record<ConnectionMedium, string> = {
  'gas-pipe': 'gas',
  'liquid-pipe': 'liquid',
  electrical: 'power',
  data: 'data',
  chute: 'chute',
  room: 'room',
  thermal: 'thermal',
};

/** One color per medium, shared by port handles, port dots, and intent edges. */
export const MEDIUM_COLOR: Record<ConnectionMedium, string> = {
  'gas-pipe': '#38bdf8',
  'liquid-pipe': '#6366f1',
  electrical: '#fbbf24',
  data: '#c084fc',
  chute: '#fb923c',
  room: '#2dd4bf',
  thermal: '#f472b6',
};

/** Neutral marker for a medium the loaded data does not declare (6.5). */
export const UNKNOWN_MEDIUM_COLOR = '#94a3b8';

export function mediumColor(medium: ConnectionMedium | undefined): string {
  return medium === undefined ? UNKNOWN_MEDIUM_COLOR : MEDIUM_COLOR[medium];
}

export function mediumLabel(medium: ConnectionMedium | undefined): string {
  return medium === undefined ? 'unknown medium' : MEDIUM_LABEL[medium];
}
