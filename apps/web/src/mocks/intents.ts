import type { ConnectionIntent } from '@stationeers/domain';

/**
 * MOCK connection intent (3.3): a user-declared logical connection with no
 * physical route yet. The intent itself is a canonical stored entity; its
 * topology status (Unrouted/Routed/Conflicting) is DERIVED and never stored
 * (9.1) — the display map below stands in for that derivation until DOM-01.
 */
export const mockIntents: ConnectionIntent[] = [
  {
    id: 'mock.intent.1',
    medium: 'gas-pipe',
    from: { instanceId: 'mock.inst.active-vent-1', portId: 'mock.port.av1.gas' },
    to: { instanceId: 'mock.inst.mixer-1', portId: 'mock.port.gm1.in-a' },
    label: 'Mixer feed',
  },
];

/** Stand-in for the derived intent-topology computation (spec 9.1: derived, never serialized). */
export const mockIntentTopology: Record<string, 'unrouted' | 'routed' | 'routed-with-warnings' | 'conflicting' | 'not-buildable'> = {
  'mock.intent.1': 'unrouted',
};
