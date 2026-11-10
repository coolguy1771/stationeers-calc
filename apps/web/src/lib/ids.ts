import type { EntityId } from '@stationeers/domain';

let fallbackCounter = 0;

/**
 * A fresh stable entity id for a user-created instance or intent (4.1: stored
 * entities carry stable identifiers). Randomness belongs to identity creation,
 * never to engineering math (5.1.1).
 */
export function newEntityId(prefix: string): EntityId {
  const uuid = globalThis.crypto?.randomUUID?.();
  if (uuid !== undefined) return `${prefix}.${uuid}`;
  // Very old browsers without crypto.randomUUID: still unique within a session.
  fallbackCounter += 1;
  return `${prefix}.${Date.now().toString(36)}-${fallbackCounter.toString(36)}`;
}
