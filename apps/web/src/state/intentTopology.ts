import type {
  ConnectionIntent,
  EntityId,
  PortRef,
  Project,
  ValidationDiagnostic,
} from '@stationeers/domain';
import { MEDIUM_LABEL } from '../lib/mediums';
import type { IntentTopologyStatus } from '../lib/statusVocabulary';
import { describePortRef, portRefResolves, samePortPair } from './deviceCatalog';

/**
 * Derived intent topology status (spec 3.5; SYNC-005/007/008/009).
 *
 * Intents are stored bare canonical entities (3.3); their status is COMPUTED on
 * read and never serialized (9.1). This module is the single derivation, so the
 * node badges, the intents panel, and the §8 diagnostics can never disagree.
 */

/** One derived status, with the human-readable reason behind it. */
export interface IntentStatusEntry {
  readonly intentId: EntityId;
  readonly status: IntentTopologyStatus;
  /** Why the status is what it is; shown in the intents panel and diagnostics. */
  readonly detail: string;
}

/** A physical route that satisfies an intent. */
export interface PhysicalRoute {
  readonly connectionId: EntityId;
  /** Non-blocking validation warnings (spec 8); non-empty ⇒ Routed with warnings. */
  readonly warnings: readonly string[];
}

/**
 * DOM-01 SEAM — physical route resolution.
 *
 * Everything above this function is final: intent status is whatever this
 * resolver reports. It is deliberately the only function that knows how a
 * route is found, so DOM-01 (typed ports, placement geometry, resolved
 * connectivity) replaces this body and nothing else.
 *
 * Until DOM-01 lands there is no resolved physical topology, so a route exists
 * exactly when `Project.connections` already stores a physical connection
 * between the same two port references (either direction). That is why the
 * physical editor cannot yet clear an intent; when the real resolver lands it
 * returns a connection id for routes that traverse pipe segments and junctions
 * (SYNC-005/006), `warnings` for routed-with-warnings, and `undefined` for
 * routes that placement makes impossible (Not buildable is reported by the
 * caller using the resolver's refusal reason once it carries one).
 */
export function resolvePhysicalRoute(
  project: Project,
  from: PortRef,
  to: PortRef,
): PhysicalRoute | undefined {
  const connection = project.connections.find(
    (candidate) => samePortPair(candidate.endpoints, from, to),
  );
  return connection === undefined ? undefined : { connectionId: connection.id, warnings: [] };
}

function intentName(intent: ConnectionIntent): string {
  return intent.label ?? `${MEDIUM_LABEL[intent.medium]} intent ${intent.id}`;
}

/**
 * Derives every intent's topology status from the current project.
 *
 * `not-buildable` is part of the 3.5 vocabulary but is only produced once the
 * DOM-01 resolver can refuse a route for geometric reasons; the seam above
 * returns routes today, so this leaves that state unreachable rather than
 * inventing it.
 */
export function deriveIntentTopology(
  project: Project,
): ReadonlyMap<EntityId, IntentStatusEntry> {
  const entries = new Map<EntityId, IntentStatusEntry>();
  for (const intent of project.intents) {
    const missing = [intent.from, intent.to].filter((ref) => !portRefResolves(project, ref));
    if (missing.length > 0) {
      entries.set(intent.id, {
        intentId: intent.id,
        status: 'conflicting',
        detail: `Endpoint no longer exists: ${missing
          .map((ref) => describePortRef(project, ref))
          .join('; ')}. The intent is retained (SYNC-008/009).`,
      });
      continue;
    }
    const route = resolvePhysicalRoute(project, intent.from, intent.to);
    if (route === undefined) {
      entries.set(intent.id, {
        intentId: intent.id,
        status: 'unrouted',
        detail: 'No physical route yet (SYNC-007).',
      });
      continue;
    }
    entries.set(
      intent.id,
      route.warnings.length > 0
        ? {
            intentId: intent.id,
            status: 'routed-with-warnings',
            detail: `Routed, with warnings: ${route.warnings.join(' ')}`,
          }
        : {
            intentId: intent.id,
            status: 'routed',
            detail: `Routed by physical connection ${route.connectionId} (SYNC-005).`,
          },
    );
  }
  return entries;
}

/** Stable codes this module owns; other diagnostic sources must not duplicate them. */
export const INTENT_DIAGNOSTIC_CODES: readonly string[] = ['CONN-UNROUTED', 'CONN-CONFLICTING'];

/**
 * §8 diagnostics for the derived statuses: every Unrouted intent is reported
 * (7.3 "identify unrouted and conflicting intents") and every Conflicting one
 * is an error, because the design no longer matches the stored intent.
 */
export function intentDiagnostics(
  project: Project,
  statuses: ReadonlyMap<EntityId, IntentStatusEntry> = deriveIntentTopology(project),
): ValidationDiagnostic[] {
  const diagnostics: ValidationDiagnostic[] = [];
  for (const intent of project.intents) {
    const entry = statuses.get(intent.id);
    if (entry === undefined) continue;
    if (entry.status === 'unrouted') {
      diagnostics.push({
        code: 'CONN-UNROUTED',
        severity: 'warning',
        entityIds: [intent.id, intent.from.instanceId, intent.to.instanceId],
        message: `Connection intent “${intentName(intent)}” has no physical route yet (${MEDIUM_LABEL[intent.medium]}).`,
        rule: 'SYNC-007 (spec 3.4)',
        suggestion:
          'Route the run in the physical layout editor to resolve this intent; an intent is valid without a route (SYNC-014).',
      });
    } else if (entry.status === 'conflicting') {
      diagnostics.push({
        code: 'CONN-CONFLICTING',
        severity: 'error',
        entityIds: [intent.id, intent.from.instanceId, intent.to.instanceId],
        message: `Connection intent “${intentName(intent)}” no longer resolves. ${entry.detail}`,
        rule: 'SYNC-008 (spec 3.4)',
        suggestion:
          'Reconnect the intent to ports that exist, or delete the intent; nothing was silently discarded (SYNC-009).',
      });
    }
  }
  return diagnostics;
}

/** Counts per status for the panel header. */
export interface IntentTopologySummary {
  readonly total: number;
  readonly counts: Record<IntentTopologyStatus, number>;
}

export function summarizeIntentStatuses(
  statuses: ReadonlyMap<EntityId, IntentStatusEntry>,
): IntentTopologySummary {
  const counts: Record<IntentTopologyStatus, number> = {
    unrouted: 0,
    routed: 0,
    'routed-with-warnings': 0,
    conflicting: 0,
    'not-buildable': 0,
  };
  for (const entry of statuses.values()) counts[entry.status] += 1;
  return { total: statuses.size, counts };
}
