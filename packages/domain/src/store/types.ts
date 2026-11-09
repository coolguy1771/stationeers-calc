/**
 * Store data shapes (FND-04; spec 2.2.1, 5.6, 8).
 *
 * Everything here is plain, serializable data. Patches are RFC 6902 JSON Patch
 * operations so the command log can be written to disk, replayed by the
 * persistence layer, and validated with schemas at every boundary (9.4).
 */
import type { StoreError } from './errors';

/**
 * Monotonic project revision (spec 2.2.1, 5.6). A decimal string so the
 * engine's `RevisionId` (FND-05) accepts it directly; every committed change
 * — dispatch, undo, redo — produces a strictly larger value.
 */
export type RevisionId = string;

/** One RFC 6902 JSON Patch operation. */
export type PatchOp =
  | { readonly op: 'add'; readonly path: string; readonly value: unknown }
  | { readonly op: 'remove'; readonly path: string }
  | { readonly op: 'replace'; readonly path: string; readonly value: unknown }
  | { readonly op: 'move'; readonly from: string; readonly path: string }
  | { readonly op: 'copy'; readonly from: string; readonly path: string }
  | { readonly op: 'test'; readonly path: string; readonly value: unknown };

/** A patch: an ordered list of operations applied atomically. */
export type Patch = readonly PatchOp[];

/** One committed command in the log: its forward patch and its exact inverse. */
export interface CommandLogEntry {
  /** Monotonic log sequence, independent of revisions. */
  readonly seq: number;
  /** Revision the state was on before this entry applied. */
  readonly baseRevision: number;
  /** Forward patch (state before → state after). */
  readonly ops: Patch;
  /** Inverse patch (state after → state before), derived structurally. */
  readonly inverse: Patch;
}

/**
 * Serializable export of the command log (spec 2.2.1: "snapshots plus the
 * command log since the last snapshot"). Plain data; JSON-safe end to end.
 */
export interface CommandLogSnapshot {
  readonly format: 'stationeers.command-log';
  readonly version: 1;
  /**
   * Revision the log's oldest retained entry builds on. With no entries the
   * log describes the current state, so this equals the current revision.
   */
  readonly baseRevision: number;
  /** Retained entries, oldest first. */
  readonly entries: readonly CommandLogEntry[];
  /** Number of entries currently applied; `entries[cursor]` is the next redo. */
  readonly cursor: number;
}

/** Successful dispatch/undo/redo: the revision the commit produced. */
export interface StoreCommit {
  readonly ok: true;
  readonly revision: number;
  readonly revisionId: RevisionId;
}

/** Failed dispatch/undo/redo: a stable diagnostic, nothing changed. */
export interface StoreRejection {
  readonly ok: false;
  readonly error: StoreError;
}

/** Result of any store mutation attempt. Never throws across the boundary. */
export type StoreResult = StoreCommit | StoreRejection;

/** Notified after every committed change (dispatch, undo, redo). */
export type StoreListener = () => void;
