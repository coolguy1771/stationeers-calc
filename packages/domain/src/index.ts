/**
 * Domain model — the shared contract for the whole monorepo (spec 2.2).
 * Canonical entities live in `src/entities.ts`; Zod schemas mirror them in
 * `src/schemas/` for every runtime boundary (spec 4.1, 9.1, 9.4).
 */
export * from './entities';
export * from './schemas';
