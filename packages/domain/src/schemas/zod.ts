/**
 * Single place where every boundary schema obtains the Zod v4 toolkit.
 *
 * zod 4.6.x publishes an ESM entry whose named `z` export does not survive
 * Vitest's CJS interop, while its class factories do; importing through here
 * keeps that quirk out of the rest of the codebase and pins us to the v4 API
 * required by the repo conventions.
 */
import * as Zod from 'zod';

/** The zod v4 API surface (`z.string()`, `z.record(key, value)`, …). */
export const z = Zod;

/** Namespace types (`Z.ZodType`, `Z.infer`, …) for type positions. */
export type { z as Z } from 'zod';
