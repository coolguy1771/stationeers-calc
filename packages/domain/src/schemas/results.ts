/** Behavior models, calculation results, and diagnostics (5.2, 5.3, 8). */
import { z } from './zod';
import { DefinitionIdSchema, EntityIdSchema, ModelStatusSchema, PackIdSchema, SeveritySchema, TopologyStatusSchema } from './atoms';
import { MAX_INPUTS_PER_ENVELOPE, MAX_CONTRIBUTING_MODELS, MAX_EXPLANATION_LINES, MAX_ENTITY_IDS_PER_DIAGNOSTIC } from './limits';
import { boundedRecord } from './records';

/** Input ranges the recorded fixtures cover (5.2.1). */
export const ValidityEnvelopeSchema = z.object({
  /** Named inputs, e.g. `temperatureK: { min: 3, max: 1500 }`. */
  inputs: boundedRecord(
    z.string(),
    z.object({ min: z.number().finite().optional(), max: z.number().finite().optional() }).strict(),
    MAX_INPUTS_PER_ENVELOPE,
  ),
  notes: z.string().optional(),
}).strict();

/**
 * A versioned game-mechanics implementation (5.3). Declares the pack properties
 * and constants it consumes so pack diffs can invalidate it (6.6).
 */
export const BehaviorModelSchema = z.object({
  id: DefinitionIdSchema,
  version: z.string().min(1),
  domain: z.string().min(1),
  consumes: z.object({ properties: z.array(z.string()), constants: z.array(z.string()) }).strict(),
  envelope: ValidityEnvelopeSchema,
  status: ModelStatusSchema,
  fixtureIds: z.array(z.string()),
}).strict();

/** A calculation result with its two independent statuses (3.5, 5.2.2). */
export const CalculationResultSchema = z.object({
  id: EntityIdSchema,
  capabilityId: z.string().min(1),
  /** Network or subgraph reference the result describes. */
  networkRef: EntityIdSchema,
  modelStatus: ModelStatusSchema,
  topologyStatus: TopologyStatusSchema,
  /** Every contributing model and its status (5.2.2). */
  contributingModels: z
    .array(z.object({ modelId: z.string().min(1), status: ModelStatusSchema }).strict())
    .max(MAX_CONTRIBUTING_MODELS),
  inputs: z.record(z.string(), z.unknown()),
  outputs: z.record(z.string(), z.unknown()),
  /** Human-readable explanation: inputs, assumptions, sources, envelope (1.1 #7). */
  explanation: z.array(z.string()).max(MAX_EXPLANATION_LINES),
  computedWith: z
    .object({ packHash: z.string().min(1), behaviorEngineVersion: z.string().min(1), scenarioDigest: z.string().min(1) })
    .strict(),
}).strict();

/** Diagnostic vocabulary and shape (8). */
export const ValidationDiagnosticSchema = z.object({
  /** Stable code, e.g. 'CONN-UNROUTED'. */
  code: z.string().min(1),
  severity: SeveritySchema,
  entityIds: z.array(EntityIdSchema).max(MAX_ENTITY_IDS_PER_DIAGNOSTIC),
  message: z.string().min(1),
  packId: PackIdSchema.optional(),
  rule: z.string().min(1),
  suggestion: z.string().optional(),
}).strict();
