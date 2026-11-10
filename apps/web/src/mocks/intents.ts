import type { ConnectionIntent } from '@stationeers/domain';

/**
 * MOCK connection intent (3.3): a user-declared logical connection with no
 * physical route yet. The intent itself is a canonical stored entity; its
 * topology status (Unrouted/Routed/Conflicting) is DERIVED on read and never
 * stored (9.1) — see `apps/web/src/state/intentTopology.ts`.
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
