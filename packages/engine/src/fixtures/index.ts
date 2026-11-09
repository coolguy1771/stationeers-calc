/**
 * In-game reference fixtures (SIM-01; spec 10.3, 5.2, 5.2.1, 5.4, 6.1 Adapter D).
 *
 * Three parts, all pure data + functions (no I/O, no game access):
 *
 * - `schema.ts` — the fixture document format, plus the structural cross-checks
 *   that make a hand-authored capture trustworthy (initial state vs tick 0,
 *   assertions vs recorded samples, tolerance coverage).
 * - `replay.ts` — replay a model implementation against a fixture and produce a
 *   structured verdict; §5.2 says a failing or out-of-envelope fixture can never
 *   yield 'verified', and `promoteFixture` is the only writer of that status.
 * - `coverage.ts` — which fixtures a model declares, which are missing, pending,
 *   or failing, and which declared envelope ranges no fixture covers.
 *
 * The human half of the workflow lives in `CAPTURE-WORKFLOW.md`; an invented,
 * clearly labelled example document lives in `examples/`.
 */
export * from './limits';
export * from './quantities';
export * from './schema';
export * from './replay';
export * from './coverage';
