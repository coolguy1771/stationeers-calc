/**
 * Contract test: every entity in `src/entities.ts` must have a matching schema.
 * The two must not drift (spec 4.1, 9.1).
 */
import { describe, expectTypeOf, it } from 'vitest';
import type { Z } from './zod';
import type {
  BehaviorModel,
  CalculationResult,
  ConnectionIntent,
  ConstructionElement,
  DeviceDefinition,
  DeviceInstance,
  InventoryState,
  PhysicalConnection,
  PhysicalPlacement,
  PortDefinition,
  PortInstance,
  PortRef,
  Project,
  Scenario,
  SpeciesAmount,
  ValidationDiagnostic,
} from '../entities';
import type { ProjectBundle } from './project';
import {
  BehaviorModelSchema,
  CalculationResultSchema,
  ConnectionIntentSchema,
  ConstructionElementSchema,
  DeviceDefinitionSchema,
  DeviceInstanceSchema,
  InventoryStateSchema,
  PhysicalConnectionSchema,
  PhysicalPlacementSchema,
  PortDefinitionSchema,
  PortInstanceSchema,
  PortRefSchema,
  ProjectBundleSchema,
  ScenarioSchema,
  SpeciesAmountSchema,
  ValidationDiagnosticSchema,
  bundleToProject,
} from './index';

describe('domain schema contract', () => {
  it('mirrors every entity type', () => {
    expectTypeOf<Z.infer<typeof PortDefinitionSchema>>().toEqualTypeOf<PortDefinition>();
    expectTypeOf<Z.infer<typeof PortInstanceSchema>>().toEqualTypeOf<PortInstance>();
    expectTypeOf<Z.infer<typeof PortRefSchema>>().toEqualTypeOf<PortRef>();
    expectTypeOf<Z.infer<typeof DeviceDefinitionSchema>>().toEqualTypeOf<DeviceDefinition>();
    expectTypeOf<Z.infer<typeof DeviceInstanceSchema>>().toEqualTypeOf<DeviceInstance>();
    expectTypeOf<Z.infer<typeof PhysicalPlacementSchema>>().toEqualTypeOf<PhysicalPlacement>();
    expectTypeOf<Z.infer<typeof ConstructionElementSchema>>().toEqualTypeOf<ConstructionElement>();
    expectTypeOf<Z.infer<typeof PhysicalConnectionSchema>>().toEqualTypeOf<PhysicalConnection>();
    expectTypeOf<Z.infer<typeof ConnectionIntentSchema>>().toEqualTypeOf<ConnectionIntent>();
    expectTypeOf<Z.infer<typeof SpeciesAmountSchema>>().toEqualTypeOf<SpeciesAmount>();
    expectTypeOf<Z.infer<typeof InventoryStateSchema>>().toEqualTypeOf<InventoryState>();
    expectTypeOf<Z.infer<typeof ScenarioSchema>>().toEqualTypeOf<Scenario>();
    expectTypeOf<Z.infer<typeof BehaviorModelSchema>>().toEqualTypeOf<BehaviorModel>();
    expectTypeOf<Z.infer<typeof CalculationResultSchema>>().toEqualTypeOf<CalculationResult>();
    expectTypeOf<Z.infer<typeof ValidationDiagnosticSchema>>().toEqualTypeOf<ValidationDiagnostic>();
  });

  it('ProjectBundle is Project plus the schemaVersion field', () => {
    expectTypeOf<Z.infer<typeof ProjectBundleSchema>>().toEqualTypeOf<ProjectBundle>();
    expectTypeOf<ProjectBundle['schemaVersion']>().toEqualTypeOf<number>();
    expectTypeOf<ReturnType<typeof bundleToProject>>().toEqualTypeOf<Project>();
  });
});