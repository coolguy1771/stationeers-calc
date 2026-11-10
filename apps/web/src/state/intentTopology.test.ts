import { describe, expect, it } from 'vitest';
import type {
  ConnectionMedium,
  PhysicalConnection,
  PortRef,
  Project,
} from '@stationeers/domain';
import { demoProject } from '../mocks/demoProject';
import {
  deriveIntentTopology,
  intentDiagnostics,
  resolvePhysicalRoute,
  summarizeIntentStatuses,
} from './intentTopology';

const INTENT = demoProject.intents[0]!;
const FROM: PortRef = INTENT.from;
const TO: PortRef = INTENT.to;

function cloneProject(): Project {
  return structuredClone(demoProject);
}

function connection(
  id: string,
  endpoints: [PortRef, PortRef],
  medium: ConnectionMedium = 'gas-pipe',
): PhysicalConnection {
  return { id, medium, elements: [], endpoints };
}

/** The seeded intent, routed by a stored physical connection (either direction). */
function routedProject(): Project {
  return {
    ...cloneProject(),
    connections: [connection('mock.conn.1', [TO, FROM])],
  };
}

function conflictingDeviceProject(): Project {
  const project = cloneProject();
  return { ...project, devices: project.devices.filter((device) => device.id !== TO.instanceId) };
}

function conflictingPortProject(): Project {
  const project = cloneProject();
  return {
    ...project,
    devices: project.devices.map((device) =>
      device.id === TO.instanceId
        ? { ...device, ports: device.ports.filter((port) => port.id !== TO.portId) }
        : device,
    ),
  };
}

function conflictingDefinitionPortProject(): Project {
  const project = cloneProject();
  return {
    ...project,
    devices: project.devices.map((device) =>
      device.id === TO.instanceId
        ? {
            ...device,
            ports: device.ports.map((port) =>
              port.id === TO.portId ? { ...port, definitionId: 'mock.port.removed-by-pack' } : port,
            ),
          }
        : device,
    ),
  };
}

describe('deriveIntentTopology — derived status, never stored (3.5, 9.1)', () => {
  it('defaults an intent with no physical route to Unrouted (SYNC-007)', () => {
    const statuses = deriveIntentTopology(demoProject);
    const entry = statuses.get(INTENT.id);
    expect(entry?.status).toBe('unrouted');
    expect(entry?.detail).toMatch(/No physical route yet/);
  });

  it('reports Routed when a physical connection joins the same ports (SYNC-005)', () => {
    const statuses = deriveIntentTopology(routedProject());
    expect(statuses.get(INTENT.id)?.status).toBe('routed');
    expect(statuses.get(INTENT.id)?.detail).toContain('mock.conn.1');
  });

  it('reports Conflicting when the endpoint device no longer exists, and keeps the intent', () => {
    const project = conflictingDeviceProject();
    const statuses = deriveIntentTopology(project);
    const entry = statuses.get(INTENT.id);
    expect(entry?.status).toBe('conflicting');
    expect(entry?.detail).toContain('no longer exists');
    // SYNC-008/009: reported, retained — never silently discarded.
    expect(project.intents).toHaveLength(demoProject.intents.length);
  });

  it('reports Conflicting when the endpoint port is gone', () => {
    const statuses = deriveIntentTopology(conflictingPortProject());
    expect(statuses.get(INTENT.id)?.status).toBe('conflicting');
  });

  it('reports Conflicting when the pinned data no longer declares the definition port', () => {
    const statuses = deriveIntentTopology(conflictingDefinitionPortProject());
    const entry = statuses.get(INTENT.id);
    expect(entry?.status).toBe('conflicting');
    expect(entry?.detail).toContain('pinned data');
  });

  it('does not mutate the project and stores no status on the intent', () => {
    const project = cloneProject();
    const before = JSON.stringify(project);
    deriveIntentTopology(project);
    expect(JSON.stringify(project)).toBe(before);
    expect(project.intents[0]).not.toHaveProperty('status');
  });
});

describe('resolvePhysicalRoute — DOM-01 seam', () => {
  it('matches a stored connection regardless of endpoint order', () => {
    const project = routedProject();
    expect(resolvePhysicalRoute(project, FROM, TO)?.connectionId).toBe('mock.conn.1');
    expect(resolvePhysicalRoute(project, TO, FROM)?.connectionId).toBe('mock.conn.1');
  });

  it('returns no route for unrelated ports', () => {
    const project = routedProject();
    expect(resolvePhysicalRoute(project, FROM, { instanceId: FROM.instanceId, portId: TO.portId })).toBeUndefined();
  });
});

describe('intentDiagnostics — §8 reporting', () => {
  it('reports one CONN-UNROUTED warning naming the intent and both endpoints', () => {
    const diagnostics = intentDiagnostics(demoProject);
    expect(diagnostics).toHaveLength(1);
    const diagnostic = diagnostics[0]!;
    expect(diagnostic.code).toBe('CONN-UNROUTED');
    expect(diagnostic.severity).toBe('warning');
    expect(diagnostic.entityIds).toEqual([INTENT.id, INTENT.from.instanceId, INTENT.to.instanceId]);
    expect(diagnostic.rule).toContain('SYNC-007');
    expect(diagnostic.suggestion).toContain('SYNC-014');
  });

  it('reports a CONN-CONFLICTING error when an endpoint is missing', () => {
    const diagnostics = intentDiagnostics(conflictingDeviceProject());
    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0]!.code).toBe('CONN-CONFLICTING');
    expect(diagnostics[0]!.severity).toBe('error');
    expect(diagnostics[0]!.rule).toContain('SYNC-008');
  });

  it('reports nothing for a routed intent', () => {
    expect(intentDiagnostics(routedProject())).toEqual([]);
  });
});

describe('summarizeIntentStatuses', () => {
  it('counts each status present in the derivation', () => {
    expect(summarizeIntentStatuses(deriveIntentTopology(demoProject)).counts.unrouted).toBe(1);
    const routed = summarizeIntentStatuses(deriveIntentTopology(routedProject()));
    expect(routed.counts.routed).toBe(1);
    expect(routed.counts.unrouted).toBe(0);
    expect(routed.total).toBe(1);
  });
});
