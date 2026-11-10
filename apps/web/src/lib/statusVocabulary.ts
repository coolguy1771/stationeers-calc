/**
 * Intent topology status vocabulary (spec 3.5) — DERIVED for a ConnectionIntent,
 * never stored (9.1).
 *
 * Kept in `lib` so both the derivation (`state/intentTopology.ts`) and the
 * display components (`components/status/`) can name the same five states
 * without either layer importing the other. Deliberately separate from the
 * result TopologyStatus (buildable/conceptual): different question, different
 * words, different shapes.
 */
export type IntentTopologyStatus =
  | 'unrouted'
  | 'routed'
  | 'routed-with-warnings'
  | 'conflicting'
  | 'not-buildable';
