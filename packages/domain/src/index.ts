/**
 * Domain model — the shared contract for the whole monorepo (spec 2.2).
 * Canonical entities live in `src/entities.ts`; Zod schemas mirror them in
 * `src/schemas/` for every runtime boundary (spec 4.1, 9.1, 9.4). The
 * canonical store (FND-04) lives in `src/store/`.
 */
export * from './entities';
export * from './schemas';
export * from './store/types';
export * from './store/errors';
export * from './store/patch';
export * from './store/commands';
export * from './store/store';
