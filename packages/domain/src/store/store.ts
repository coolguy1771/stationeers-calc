/**
 * The canonical model store (FND-04; spec 2.2.1, 2.2, 5.6).
 *
 * The single authoritative holder of the project document. React Flow, PixiJS,
 * and Zustand state are views over this store, never the model (2.2).
 *
 * Contract implemented here:
 * - All mutations are commands; a command validates against the current state,
 *   produces a patch (RFC 6902), and the store derives its exact inverse
 *   structurally (2.2.1). Nothing else mutates the state.
 * - Every committed change — dispatch, undo, and redo alike — increments a
 *   monotonic revision ID (2.2.1, 5.6). Worker jobs tag their revision via
 *   `revisionId`; `isStale()` implements "a result older than the current
 *   revision is discarded or shown as stale; it never overwrites newer state".
 * - Undo/redo replays recorded inverse/forward patches through one cursor.
 *   A new dispatch after undo truncates the redo tail (linear history).
 * - The command log is bounded (front eviction) and exported as plain JSON
 *   data for persistence (see the seam comment on `exportLog`).
 * - The store core reads no clock and no randomness (5.1.1). Timestamps are
 *   the persistence layer's concern; anything time-based is injected.
 *
 * Persistence seam (spec 2.2.1, wiring owned by packages/persistence —
 * deliberately NOT implemented here):
 * 1. Save: debounce and write `serializeProject(store.state)` (the snapshot
 *    bundle FND-03 already persists) together with `store.exportLog()`.
 * 2. Load: `parseProjectBundle(bundle)` → `createStore({ project, initialRevision:
 *    snapshotBaseRevision })`; validate the stored log's shape and its
 *    `baseRevision` chain (each entry's `baseRevision` must equal the previous
 *    entry's `baseRevision + 1`, and the first must equal the snapshot's
 *    revision); then replay retained entries from the stored `cursor` onward
 *    with `applyPatch` (a store-external call, so loading does not grow the
 *    log) and set the store's revision to the last replayed revision.
 * 3. The exported snapshot is deep-frozen, deep-cloned plain data, so the
 *    persistence layer can hand it to structuredClone/JSON safely.
 */
import type { Project } from '../entities';
import { bundleToProject, serializeProject } from '../schemas';
import type {
  CommandLogEntry,
  CommandLogSnapshot,
  Patch,
  PatchOp,
  RevisionId,
  StoreCommit,
  StoreListener,
  StoreRejection,
  StoreResult,
} from './types';
import { buildCommandPatch } from './commands';
import type { Command } from './commands';
import { StoreError, StoreErrorCode, asStoreError } from './errors';
import { applyPatch, applyWithInverse, deepCloneJson } from './patch';

/** Default bounded command log length (spec 2.2.1: "a bounded command log"). */
export const DEFAULT_MAX_LOG_ENTRIES = 500;

export interface StoreOptions {
  /** Initial canonical state. Validated and sanitized at the boundary (9.4). */
  readonly project: Project;
  /** Log bound; oldest entries are evicted first. Default 500. */
  readonly maxLogEntries?: number;
  /** Starting revision; persistence resumes a project's revision stream with it. Default 0. */
  readonly initialRevision?: number;
  /**
   * Deep-freeze every committed state. Cost is O(state) per commit, so this is
   * a development/test aid for enforcing the immutability discipline, not a
   * default: game-scale projects have tens of thousands of nodes (9.4 bounds).
   */
  readonly freezeState?: boolean;
}

/** The canonical store API. `state` is shared structure — treat it as immutable. */
export interface Store {
  /** Current canonical state; changes only on a successful commit. */
  readonly state: Project;
  /** Monotonic revision counter (increments on every commit, including undo/redo). */
  readonly revision: number;
  /** `String(revision)` — the engine's `RevisionId` (5.6). */
  readonly revisionId: RevisionId;
  readonly canUndo: boolean;
  readonly canRedo: boolean;
  /** Validates and applies a command; never throws, never mutates on failure. */
  dispatch(command: Command): StoreResult;
  /** Replays the inverse of the last applied entry; bumps the revision. */
  undo(): StoreResult;
  /** Replays the forward patch of the next entry; bumps the revision. */
  redo(): StoreResult;
  /** True when `revisionId` names a revision older than the current one (5.6). */
  isStale(revisionId: RevisionId): boolean;
  /** True when `revisionId` names exactly the current revision. */
  isCurrent(revisionId: RevisionId): boolean;
  /** Serializable, frozen command-log snapshot for the persistence layer. */
  exportLog(): CommandLogSnapshot;
  /** Notified after every committed change; listeners may throw to their caller. */
  subscribe(listener: StoreListener): () => void;
}

interface RevisionExhausted {
  readonly ok: false;
  readonly error: StoreError;
}

function parseRevisionId(revisionId: string): number {
  return /^\d+$/.test(revisionId) ? Number(revisionId) : -1;
}

function deepFreeze<T>(value: T): T {
  if (value !== null && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value as Record<string, unknown>)) deepFreeze(child);
  }
  return value;
}

function clonePatch(patch: Patch): Patch {
  return patch.map((op) => deepCloneJson(op) as PatchOp);
}

/**
 * Creates the canonical store. The initial project is validated and sanitized
 * against the current bundle schema (9.4): an invalid project throws a
 * `ProjectBundleError` with a stable code before any store exists.
 */
export function createStore(options: StoreOptions): Store {
  const { maxLogEntries, initialRevision, freezeState } = options;
  if (maxLogEntries !== undefined && (!Number.isSafeInteger(maxLogEntries) || maxLogEntries < 1)) {
    throw new RangeError(`maxLogEntries must be a safe integer >= 1 (got ${maxLogEntries}).`);
  }
  if (initialRevision !== undefined && (!Number.isSafeInteger(initialRevision) || initialRevision < 0)) {
    throw new RangeError(`initialRevision must be a safe integer >= 0 (got ${initialRevision}).`);
  }
  const logBound = maxLogEntries ?? DEFAULT_MAX_LOG_ENTRIES;

  const snapshot = serializeProject(options.project);
  let state: Project = bundleToProject(snapshot);
  if (freezeState) deepFreeze(state);

  let revision = initialRevision ?? 0;
  let cursor = 0;
  let nextSeq = 1;
  /** Retained log entries, oldest first; `cursor` entries are applied. */
  const entries: CommandLogEntry[] = [];
  const listeners = new Set<StoreListener>();

  function notify(): void {
    for (const listener of listeners) listener();
  }

  function revisionExhausted(): RevisionExhausted | undefined {
    if (revision >= Number.MAX_SAFE_INTEGER) {
      return {
        ok: false,
        error: new StoreError(
          StoreErrorCode.RevisionExhausted,
          'Revision ids exhausted; the monotonic revision counter hit MAX_SAFE_INTEGER.',
        ),
      };
    }
    return undefined;
  }

  /** Increments the revision, installs the new state, and notifies listeners. */
  function advance(next: Project): StoreCommit {
    revision += 1;
    state = freezeState ? deepFreeze(next) : next;
    notify();
    return { ok: true, revision, revisionId: String(revision) };
  }

  function freezeEntry(entry: CommandLogEntry): CommandLogEntry {
    const ops = entry.ops.map((op) => Object.freeze({ ...op }) as PatchOp);
    const inverse = entry.inverse.map((op) => Object.freeze({ ...op }) as PatchOp);
    return Object.freeze({
      seq: entry.seq,
      baseRevision: entry.baseRevision,
      ops: Object.freeze(ops),
      inverse: Object.freeze(inverse),
    });
  }

  function commit(command: Command): StoreResult {
    let ops: Patch;
    try {
      ops = buildCommandPatch(state, command);
    } catch (error) {
      return { ok: false, error: asStoreError(error) };
    }
    const exhausted = revisionExhausted();
    if (exhausted) return exhausted;
    let outcome: { next: unknown; inverse: Patch };
    try {
      outcome = applyWithInverse(state, ops);
    } catch (error) {
      // Copy-on-write application: the partial result is discarded and the
      // previous state object is untouched.
      return { ok: false, error: asStoreError(error) };
    }
    // A new command discards the redo tail (linear history).
    if (cursor < entries.length) entries.length = cursor;
    const { next, inverse } = outcome;
    entries.push(freezeEntry({ seq: nextSeq, baseRevision: revision, ops, inverse }));
    nextSeq += 1;
    if (entries.length > logBound) entries.shift();
    cursor = entries.length;
    // Commands validate against the Project state, so the result is a Project;
    // the patch engine is generic, hence the narrowing at this single chokepoint.
    return advance(next as Project);
  }

  function applyUndo(): StoreResult {
    if (cursor === 0) {
      return {
        ok: false,
        error: new StoreError(
          StoreErrorCode.NothingToUndo,
          'Nothing left to undo (the log bound may have evicted older commands).',
        ),
      };
    }
    const exhausted = revisionExhausted();
    if (exhausted) return exhausted;
    const entry = entries[cursor - 1]!;
    let next: Project;
    try {
      next = applyPatch(state, entry.inverse) as Project;
    } catch (error) {
      return { ok: false, error: asStoreError(error) };
    }
    cursor -= 1;
    return advance(next);
  }

  function applyRedo(): StoreResult {
    if (cursor >= entries.length) {
      return {
        ok: false,
        error: new StoreError(
          StoreErrorCode.NothingToRedo,
          'Nothing to redo; the redo tail was truncated by a newer command.',
        ),
      };
    }
    const exhausted = revisionExhausted();
    if (exhausted) return exhausted;
    const entry = entries[cursor]!;
    let next: Project;
    try {
      next = applyPatch(state, entry.ops) as Project;
    } catch (error) {
      return { ok: false, error: asStoreError(error) };
    }
    cursor += 1;
    return advance(next);
  }

  function rejection(error: StoreError): StoreRejection {
    return { ok: false, error };
  }

  const store: Store = {
    get state() {
      return state;
    },
    get revision() {
      return revision;
    },
    get revisionId() {
      return String(revision);
    },
    get canUndo() {
      return cursor > 0;
    },
    get canRedo() {
      return cursor < entries.length;
    },
    dispatch: (command) => {
      try {
        return commit(command);
      } catch (error) {
        return rejection(asStoreError(error));
      }
    },
    undo: () => {
      try {
        return applyUndo();
      } catch (error) {
        return rejection(asStoreError(error));
      }
    },
    redo: () => {
      try {
        return applyRedo();
      } catch (error) {
        return rejection(asStoreError(error));
      }
    },
    // A malformed candidate does not name any revision, so it cannot be
    // "older than the current one" — only numeric ids compare against `revision`
    // (5.6).
    isStale: (candidate) => {
      const parsed = parseRevisionId(candidate);
      return parsed >= 0 && parsed < revision;
    },
    isCurrent: (candidate) => parseRevisionId(candidate) === revision,
    exportLog(): CommandLogSnapshot {
      const exported = entries.map((entry) => ({
        seq: entry.seq,
        baseRevision: entry.baseRevision,
        ops: clonePatch(entry.ops),
        inverse: clonePatch(entry.inverse),
      }));
      // Deep-clone + deep-freeze: the snapshot must be inert even though the
      // internal entries share prior-value subtrees with historical state.
      return deepFreeze({
        format: 'stationeers.command-log' as const,
        version: 1 as const,
        baseRevision: entries.length > 0 ? entries[0]!.baseRevision : revision,
        entries: exported,
        cursor,
      });
    },
    subscribe(listener: StoreListener): () => void {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
  return store;
}
