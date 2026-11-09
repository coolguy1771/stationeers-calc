/**
 * Game-data pack runtime (spec 6.4, 6.5, 6.7, 9.4): versioned pack schema, the
 * builder that turns extractor output into a pack, the untrusted-input loader,
 * and the §6.5 data-quality link.
 *
 * EXT-03 owns the schema, builder, and loader; `diff.ts` is the documented seam
 * for EXT-04's semantic diff. See `README.md` for the manifest fields, the
 * promotion rule, and what still blocks a published pack.
 */
export * from './errors';
export * from './limits';
export * from './schema';
export * from './input';
export * from './quality';
export * from './build';
export * from './load';
export * from './diff';
export { canonicalJson, contentHashOf, sha256Hex, withoutContentHash } from './canonical';
export { deepFreeze } from './immutable';

