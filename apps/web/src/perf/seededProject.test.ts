import { parseProjectBundle, serializeProject } from '@stationeers/domain';
import { describe, expect, it } from 'vitest';
import { buildPerfProject, PERF_INSTANCE_COUNT } from './seededProject';

/**
 * Perf seed (spec 11 reference desktop; backlog QA-02).
 *
 * The benchmark is only comparable across runs if the seed is exactly the same
 * project every time, so these tests pin the counts, the referencing between
 * entities, and the determinism of the whole document.
 */
describe('performance harness seed', () => {
  it('seeds exactly the 200-instance target with intents and placements', () => {
    const project = buildPerfProject();

    expect(PERF_INSTANCE_COUNT).toBe(200);
    expect(project.devices).toHaveLength(200);
    expect(project.placements).toHaveLength(200);
    expect(project.intents).toHaveLength(199);
  });

  it('is deterministic: two builds are the same project', () => {
    expect(JSON.stringify(buildPerfProject())).toBe(
      JSON.stringify(buildPerfProject()),
    );
  });

  it('references only entities that exist', () => {
    const project = buildPerfProject();
    const placements = new Set(project.placements.map((placement) => placement.id));
    const devices = new Map(project.devices.map((device) => [device.id, device]));

    for (const device of project.devices) {
      expect(device.placementId).toBeDefined();
      expect(placements.has(device.placementId ?? '')).toBe(true);
    }
    for (const intent of project.intents) {
      for (const ref of [intent.from, intent.to]) {
        const device = devices.get(ref.instanceId);
        expect(device).toBeDefined();
        expect(device?.ports.some((port) => port.id === ref.portId)).toBe(true);
      }
    }
  });

  it('keeps ids unique', () => {
    const project = buildPerfProject();
    const ids = [
      ...project.devices.map((device) => device.id),
      ...project.placements.map((placement) => placement.id),
      ...project.intents.map((intent) => intent.id),
    ];
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('is a valid canonical project, not a shortcut around the schema', () => {
    const project = buildPerfProject({ count: 12 });
    const bundle = serializeProject(project);
    expect(() => parseProjectBundle(bundle)).not.toThrow();
  });

  it('scales with the requested count for smaller spot checks', () => {
    expect(buildPerfProject({ count: 5 }).devices).toHaveLength(5);
    expect(buildPerfProject({ count: 5 }).intents).toHaveLength(4);
    expect(buildPerfProject({ count: 0 }).devices).toHaveLength(0);
    expect(buildPerfProject({ count: 0 }).intents).toHaveLength(0);
  });
});
