import { describe, expect, it } from 'vitest';
import type { PortRef, Project } from '@stationeers/domain';
import { demoProject } from '../mocks/demoProject';
import {
  checkPortConnection,
  ConnectionRejectionCode,
  createConnectionIntent,
  deviceDeletionImpact,
} from './schematicEditing';

const INTENT = demoProject.intents[0]!;
const AV_GAS: PortRef = { instanceId: 'mock.inst.active-vent-1', portId: 'mock.port.av1.gas' };
const AV_POWER: PortRef = { instanceId: 'mock.inst.active-vent-1', portId: 'mock.port.av1.power' };
const MIXER_IN_A: PortRef = { instanceId: 'mock.inst.mixer-1', portId: 'mock.port.gm1.in-a' };
const MIXER_OUT: PortRef = { instanceId: 'mock.inst.mixer-1', portId: 'mock.port.gm1.out' };
const PV_GAS: PortRef = { instanceId: 'mock.inst.passive-vent-1', portId: 'mock.port.pv1.gas' };

function cloneProject(): Project {
  return structuredClone(demoProject);
}

describe('checkPortConnection — typed ports (4.3)', () => {
  it('accepts two ports of the same medium and reports the medium', () => {
    const check = checkPortConnection(demoProject, AV_GAS, MIXER_OUT);
    expect(check).toEqual({ ok: true, medium: 'gas-pipe', from: AV_GAS, to: MIXER_OUT });
  });

  it('refuses different media and names both endpoints', () => {
    const check = checkPortConnection(demoProject, AV_POWER, MIXER_IN_A);
    expect(check.ok).toBe(false);
    if (check.ok) return;
    expect(check.code).toBe(ConnectionRejectionCode.MediumMismatch);
    expect(check.reason).toContain('power');
    expect(check.reason).toContain('gas');
    expect(check.reason).toContain('spec 4.3');
  });

  it('refuses connecting a device to itself', () => {
    const check = checkPortConnection(demoProject, AV_GAS, AV_GAS);
    expect(check.ok).toBe(false);
    if (check.ok) return;
    expect(check.code).toBe(ConnectionRejectionCode.SameInstance);
  });

  it('refuses duplicating an existing intent (either direction)', () => {
    for (const [from, to] of [
      [INTENT.from, INTENT.to],
      [INTENT.to, INTENT.from],
    ] as const) {
      const check = checkPortConnection(demoProject, from, to);
      expect(check.ok).toBe(false);
      if (check.ok) continue;
      expect(check.code).toBe(ConnectionRejectionCode.DuplicateIntent);
    }
  });

  it('refuses an intent for ports a physical connection already joins (SYNC-014)', () => {
    const project = cloneProject();
    project.connections = [
      { id: 'mock.conn.1', medium: 'gas-pipe', elements: [], endpoints: [MIXER_OUT, PV_GAS] },
    ];
    const check = checkPortConnection(project, MIXER_OUT, PV_GAS);
    expect(check.ok).toBe(false);
    if (check.ok) return;
    expect(check.code).toBe(ConnectionRejectionCode.AlreadyRouted);
  });

  it('refuses an endpoint the project does not resolve', () => {
    const check = checkPortConnection(demoProject, AV_GAS, {
      instanceId: 'mock.inst.gone',
      portId: 'mock.port.gone',
    });
    expect(check.ok).toBe(false);
    if (check.ok) return;
    expect(check.code).toBe(ConnectionRejectionCode.EndpointMissing);
    expect(check.reason).toContain('mock.inst.gone');
  });
});

describe('createConnectionIntent', () => {
  it('builds a canonical intent that needs no physical route (SYNC-014)', () => {
    const creation = createConnectionIntent(demoProject, AV_GAS, MIXER_OUT, 'mock.intent.new');
    expect(creation.ok).toBe(true);
    if (!creation.ok) return;
    expect(creation.intent).toEqual({
      id: 'mock.intent.new',
      medium: 'gas-pipe',
      from: AV_GAS,
      to: MIXER_OUT,
    });
    expect(creation.intent).not.toHaveProperty('status');
  });

  it('returns the refusal instead of an intent for mismatched media', () => {
    const creation = createConnectionIntent(demoProject, AV_POWER, MIXER_IN_A, 'mock.intent.new');
    expect(creation.ok).toBe(false);
  });
});

describe('deviceDeletionImpact — confirmation rule (SYNC-011/012/013)', () => {
  it('requires confirmation when a device owns intents and settings', () => {
    const impact = deviceDeletionImpact(demoProject, 'mock.inst.active-vent-1');
    expect(impact).toBeDefined();
    expect(impact?.intentIds).toEqual([INTENT.id]);
    expect(impact?.hasSettings).toBe(true);
    expect(impact?.requiresConfirmation).toBe(true);
    expect(impact?.reasons.some((reason) => reason.includes('SYNC-013'))).toBe(true);
  });

  it('does not ask for a bare unplaced device with no intents, settings, or inventory', () => {
    const impact = deviceDeletionImpact(demoProject, 'mock.inst.pipe-sensor-1');
    expect(impact?.requiresConfirmation).toBe(false);
    expect(impact?.reasons).toEqual([]);
  });

  it('reports inventory as a reason to confirm', () => {
    const project = cloneProject();
    project.devices = project.devices.map((device) =>
      device.id === 'mock.inst.pipe-sensor-1'
        ? {
            ...device,
            inventory: {
              species: [],
              thermal: { kind: 'temperature', value: 293.15, unit: 'K' },
            },
          }
        : device,
    );
    const impact = deviceDeletionImpact(project, 'mock.inst.pipe-sensor-1');
    expect(impact?.hasInventory).toBe(true);
    expect(impact?.requiresConfirmation).toBe(true);
  });

  it('returns undefined for an unknown device', () => {
    expect(deviceDeletionImpact(demoProject, 'mock.inst.gone')).toBeUndefined();
  });
});
