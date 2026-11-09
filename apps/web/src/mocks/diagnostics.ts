import type { ValidationDiagnostic } from '@stationeers/domain';

/**
 * MOCK diagnostics (spec 8): stable codes, severity, affected entities, source
 * rule, suggestion. The second one is the reason the mock result is Conceptual.
 */
export const mockDiagnostics: ValidationDiagnostic[] = [
  {
    code: 'CONN-UNROUTED',
    severity: 'warning',
    entityIds: ['mock.intent.1'],
    message: 'Connection intent “Mixer feed” has no physical route yet.',
    packId: 'stationeers.stable',
    rule: 'SYNC-007 (spec 3.4)',
    suggestion: 'Route the pipe run in the physical layout editor to resolve this intent.',
  },
  {
    code: 'VOL-ASSUMED',
    severity: 'info',
    entityIds: ['mock.intent.1', 'mock.inst.mixer-1'],
    message: 'Network volume is assumed from the scenario; the topology status stays Conceptual until the run is routed.',
    packId: 'stationeers.stable',
    rule: 'spec 4.7 — network volume',
    suggestion: 'Place all devices and route the pipe run to restore Buildable status.',
  },
];
