/**
 * Game-data pack runtime (spec 6.4, 6.5, 6.7, 9.4): versioned pack schema, the
 * builder that turns extractor output into a pack, the untrusted-input loader,
 * the §6.5 data-quality link, and the semantic diff of two packs (EXT-04).
 *
 * EXT-03 owns the schema, builder, and loader; EXT-04 owns `diff.ts` (semantic
 * diff + §6.6 step 6 feed), `provenance-coverage.ts` (the coverage/publish-gate
 * report), and `invalidation.ts` (applying a diff to the model registry). See
 * `README.md` for the manifest fields, the promotion rule, and what still blocks
 * a published pack.
 */
export * from './errors';
export * from './limits';
export * from './schema';
export * from './input';
export * from './quality';
export * from './build';
export * from './load';
export * from './diff';
export * from './provenance-coverage';
export * from './invalidation';
export { canonicalJson, compareStrings, contentHashOf, sha256Hex, withoutContentHash } from './canonical';
export { deepFreeze } from './immutable';

