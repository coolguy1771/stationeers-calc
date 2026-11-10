import { BadgeCheck, CircleSlash, DraftingCompass, FlaskConical, Hammer, Info, OctagonAlert, TriangleAlert } from 'lucide-react';
import type { DataQuality, ModelStatus, Severity, TopologyStatus } from '@stationeers/domain';
import type { IntentTopologyStatus } from '../../lib/statusVocabulary';

export type { IntentTopologyStatus };

/*
 * Status vocabulary styling — spec-critical (3.5, 5.2, 6.5, 8).
 *
 * Visual grammar (must stay teachable and honest):
 *   FILLED chip            = model status   — is the mechanic validated?
 *   FILLED + DASHED border = experimental (Unverified) — never styled as success
 *   SOLID OUTLINE          = topology: Buildable — can it physically exist?
 *   DOTTED OUTLINE         = topology: Conceptual — assumed/unrealized topology
 *
 * Model and topology status are INDEPENDENT (3.5): Verified+Conceptual means
 * "correct mechanics, assumed topology" and must never render as exact.
 * Only Verified AND Buildable earns the exact verdict.
 */

export interface StatusConfig {
  label: string;
  icon: typeof BadgeCheck;
  className: string;
  /** Shown as tooltip/aria title; cites the spec rule the status comes from. */
  title: string;
}

export const MODEL_STATUS_CONFIG: Record<ModelStatus, StatusConfig> = {
  verified: {
    label: 'Verified',
    icon: BadgeCheck,
    className: 'border-emerald-600/40 bg-emerald-500/15 text-emerald-700 dark:text-emerald-300',
    title: 'Verified — matches in-game reference fixtures for the pinned build, within the declared validity envelope (spec 5.2).',
  },
  unverified: {
    label: 'Unverified',
    icon: FlaskConical,
    // Dashed border + fill = experimental output; never a success color treatment.
    className: 'border-dashed border-amber-600/60 bg-amber-500/10 text-amber-700 dark:text-amber-300',
    title: 'Unverified — experimental output, shown only with explicit opt-in; never presented as exact (spec 5.2).',
  },
  unsupported: {
    label: 'Unsupported',
    icon: CircleSlash,
    className: 'border-border bg-muted text-muted-foreground',
    title: 'Unsupported — no usable implementation or insufficient verified information. An unsupported result is not a pass (spec 5.2, 8).',
  },
  incompatible: {
    label: 'Incompatible',
    icon: OctagonAlert,
    className: 'border-red-600/50 bg-red-500/10 text-red-700 dark:text-red-300',
    title: 'Incompatible — known not to match the selected game build (spec 5.2).',
  },
};

export const TOPOLOGY_STATUS_CONFIG: Record<TopologyStatus, StatusConfig> = {
  buildable: {
    label: 'Buildable',
    icon: Hammer,
    // Outline language: topology, not verification. Solid outline = physically realizable.
    className: 'border-emerald-600/50 bg-transparent text-emerald-700 dark:text-emerald-300',
    title: 'Buildable — all participating networks resolve from physical placement with verified footprints and connectors (spec 3.5).',
  },
  conceptual: {
    label: 'Conceptual',
    icon: DraftingCompass,
    // Dotted outline = assumed/provisional topology; distinct from any model-status style.
    className: 'border-dotted border-blue-500/60 bg-transparent text-blue-700 dark:text-blue-300',
    title: 'Conceptual — depends on an unrouted intent, unplaced device, unverified footprint, or assumed volume (spec 3.5, 4.7).',
  },
};

export interface DataQualityConfig {
  label: string;
  /** Dot fill; hollow dot for `missing` (absence, not a value). */
  dotClassName: string;
  title: string;
}

export const DATA_QUALITY_CONFIG: Record<DataQuality, DataQualityConfig> = {
  'extracted-and-validated': {
    label: 'Validated',
    dotClassName: 'bg-emerald-500',
    title: 'Extracted and validated — the only level a Verified capability may consume (spec 6.5).',
  },
  'extracted-unverified': {
    label: 'Extracted (unverified)',
    dotClassName: 'bg-amber-500',
    title: 'Extracted but not semantically verified — consuming this downgrades results to Unverified (spec 6.5).',
  },
  inferred: {
    label: 'Inferred',
    dotClassName: 'bg-blue-500',
    title: 'Inferred/derived — must identify its calculation and dependencies (spec 6.5).',
  },
  missing: {
    label: 'Missing',
    dotClassName: 'border border-border bg-transparent',
    title: 'Missing — reported explicitly, never fabricated or defaulted (spec 4.7, 7.6).',
  },
  conflicting: {
    label: 'Conflicting',
    dotClassName: 'bg-red-500',
    title: 'Conflicting between sources (spec 6.5).',
  },
};

export const SEVERITY_CONFIG: Record<Severity, StatusConfig> = {
  error: {
    label: 'Error',
    icon: OctagonAlert,
    className: 'border-red-600/50 bg-red-500/10 text-red-700 dark:text-red-300',
    title: 'Error diagnostic — blocks the affected capability (spec 8).',
  },
  warning: {
    label: 'Warning',
    icon: TriangleAlert,
    className: 'border-amber-600/60 bg-amber-500/10 text-amber-700 dark:text-amber-300',
    title: 'Warning diagnostic — design risk reported to the user (spec 8).',
  },
  info: {
    label: 'Info',
    icon: Info,
    className: 'border-sky-600/40 bg-sky-500/10 text-sky-700 dark:text-sky-300',
    title: 'Informational diagnostic (spec 8).',
  },
};

/** The single honest verdict for a model×topology pair (spec 3.5). */
export type ResultVerdict =
  | { exact: true; label: 'Exact'; tone: 'positive'; title: string }
  | { exact: false; label: string; tone: 'caution' | 'neutral' | 'negative'; title: string };

export function resultVerdict(modelStatus: ModelStatus, topologyStatus: TopologyStatus): ResultVerdict {
  if (modelStatus === 'verified' && topologyStatus === 'buildable') {
    return {
      exact: true,
      label: 'Exact',
      tone: 'positive',
      title: 'Verified AND Buildable — the only combination labeled exact (spec 3.5).',
    };
  }
  if (modelStatus === 'verified' && topologyStatus === 'conceptual') {
    return {
      exact: false,
      label: 'Correct mechanics — assumed topology',
      tone: 'caution',
      title: 'Verified mechanics, but topology depends on an assumption; never displayed as exact (spec 3.5).',
    };
  }
  if (modelStatus === 'unverified') {
    return {
      exact: false,
      label: topologyStatus === 'conceptual' ? 'Experimental — assumed topology' : 'Experimental — not exact',
      tone: 'caution',
      title: 'Unverified output is experimental and never carries the exact designation (spec 5.2).',
    };
  }
  if (modelStatus === 'unsupported') {
    return {
      exact: false,
      label: 'Unsupported — not a pass',
      tone: 'neutral',
      title: 'An unsupported result is not a pass (spec 8).',
    };
  }
  return {
    exact: false,
    label: 'Incompatible — not exact',
    tone: 'negative',
    title: 'Incompatible with the pinned build; the result is not valid for this build (spec 5.2).',
  };
}

export const VERDICT_TONE_CLASS: Record<ResultVerdict['tone'], string> = {
  positive: 'border-emerald-600/50 bg-emerald-500/20 text-emerald-700 dark:text-emerald-300',
  caution: 'border-amber-600/60 bg-amber-500/10 text-amber-700 dark:text-amber-300 border-dashed',
  neutral: 'border-border bg-muted text-muted-foreground',
  negative: 'border-red-600/50 bg-red-500/10 text-red-700 dark:text-red-300',
};

/**
 * Intent topology status (spec 3.5) — outline-styled chips for the derived
 * vocabulary in `lib/statusVocabulary.ts`, never stored (9.1).
 */
export const INTENT_STATUS_CONFIG: Record<IntentTopologyStatus, StatusConfig> = {
  unrouted: {
    label: 'Unrouted',
    icon: DraftingCompass,
    className: 'border-amber-600/60 bg-transparent text-amber-700 dark:text-amber-300',
    title: 'Unrouted — the intent has no physical route yet (spec 3.5).',
  },
  routed: {
    label: 'Routed',
    icon: Hammer,
    className: 'border-emerald-600/50 bg-transparent text-emerald-700 dark:text-emerald-300',
    title: 'Routed — physical connectivity satisfies the intent (SYNC-005).',
  },
  'routed-with-warnings': {
    label: 'Routed · warnings',
    icon: TriangleAlert,
    className: 'border-amber-600/60 bg-transparent text-amber-700 dark:text-amber-300',
    title: 'Routed with warnings — routed, but validation reports risks (spec 8).',
  },
  conflicting: {
    label: 'Conflicting',
    icon: OctagonAlert,
    className: 'border-red-600/50 bg-transparent text-red-700 dark:text-red-300',
    title: 'Conflicting — a physical change broke the route; the intent is retained (SYNC-008).',
  },
  'not-buildable': {
    label: 'Not buildable',
    icon: CircleSlash,
    className: 'border-border bg-transparent text-muted-foreground',
    title: 'Not buildable — the intent cannot be realized with current placement (spec 3.5).',
  },
};

