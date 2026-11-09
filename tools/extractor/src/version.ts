/**
 * Tool versions recorded in a pack manifest (spec 6.4).
 *
 * `EXTRACTOR_VERSION` mirrors `package.json`; bump both together.
 * `NORMALIZATION_VERSION` is bumped whenever `normalize.ts` changes the IR it
 * produces, because a pack whose IR was normalized differently is a different
 * pack even when the game build is the same.
 */
export const EXTRACTOR_VERSION = '0.0.1';

export const NORMALIZATION_VERSION = '1';
