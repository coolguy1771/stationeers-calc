/**
 * RFC 6902 JSON Patch engine (FND-04; spec 2.2.1).
 *
 * One recursive, copy-on-write applier produces both the new state and the
 * exact inverse of every operation. Inverses are therefore derived structurally
 * from the state each operation ran on — there is no per-command inverse code
 * that could drift from forward behavior (spec 2.2.1: "All mutations are
 * commands that produce a patch and its inverse").
 *
 * Atomicity: nothing is ever mutated in place. The input document keeps all
 * unchanged subtrees by reference (structural sharing); an operation that
 * fails partway discards the partially built result and leaves the input —
 * and therefore the caller's state — untouched.
 */
import type { Patch, PatchOp } from './types';
import { StoreError, StoreErrorCode } from './errors';
import { buildPointer, parseArrayIndex, parsePointer } from './pointer';

/**
 * A plain JSON document (the engine's contract). Structurally generic — the
 * canonical store applies it to `Project` states; the persistence layer will
 * replay logs against validated snapshots.
 */
export type JsonDocument = unknown;

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Deep-clones plain JSON data. Values in patches and projects are plain data by contract. */
export function deepCloneJson(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(deepCloneJson);
  if (isPlainObject(value)) {
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(value)) out[key] = deepCloneJson(value[key]);
    return out;
  }
  return value;
}

/** Structural equality of plain JSON data (RFC 6902 `test` semantics). */
export function deepEqualJson(a: unknown, b: unknown): boolean {
  if (Object.is(a, b)) return true;
  if (Array.isArray(a)) {
    if (!Array.isArray(b) || a.length !== b.length) return false;
    return a.every((value, index) => deepEqualJson(value, b[index]));
  }
  if (Array.isArray(b)) return false;
  if (isPlainObject(a) && isPlainObject(b)) {
    const keysA = Object.keys(a);
    const keysB = Object.keys(b);
    if (keysA.length !== keysB.length) return false;
    return keysA.every((key) => Object.hasOwn(b, key) && deepEqualJson(a[key], b[key]));
  }
  return false;
}

function pathMissing(message: string, path: string): StoreError {
  return new StoreError(
    StoreErrorCode.PatchPathMissing,
    `${message} (path ${JSON.stringify(path)}).`,
  );
}

function patchInvalid(message: string): StoreError {
  return new StoreError(StoreErrorCode.PatchInvalid, message);
}

/** Rejects root-level (`''`) pointers; the store never operates on the document root. */
function requireNonRoot(pointer: string): readonly string[] {
  const segments = parsePointer(pointer);
  if (segments.length === 0) {
    throw new StoreError(
      StoreErrorCode.PatchRoot,
      `Patch operations cannot target the document root (${JSON.stringify(pointer)}).`,
    );
  }
  return segments;
}

/** Full pointer for error messages and undo operations, from accumulated tokens. */
function pointerAt(prefix: readonly string[], token: string): string {
  return buildPointer([...prefix, token]);
}

/**
 * Validates the operation envelope: known kind, required fields present, no
 * extras, and no `undefined` payloads (patches must survive a JSON round trip).
 */
function validateOpShape(op: PatchOp): void {
  if (op === null || typeof op !== 'object') throw patchInvalid('Patch operation must be an object.');
  switch (op.op) {
    case 'add':
    case 'replace':
    case 'test':
      if (typeof op.path !== 'string') throw patchInvalid(`${op.op} requires a string path.`);
      if (op.value === undefined) throw patchInvalid(`${op.op} requires a JSON value (undefined is not valid).`);
      return;
    case 'remove':
      if (typeof op.path !== 'string') throw patchInvalid('remove requires a string path.');
      return;
    case 'move':
    case 'copy':
      if (typeof op.from !== 'string') throw patchInvalid(`${op.op} requires a string from.`);
      if (typeof op.path !== 'string') throw patchInvalid(`${op.op} requires a string path.`);
      return;
    default:
      throw patchInvalid(`Unknown patch operation ${JSON.stringify((op as { op?: unknown }).op)}.`);
  }
}

interface StepOutcome {
  /** The document with exactly this operation applied. */
  readonly next: unknown;
  /** Operations that revert this step, in application order. */
  readonly undo: readonly PatchOp[];
}

/** Reads the value at a pointer; throws `PatchPathMissing` when it does not exist. */
function getAt(node: unknown, segments: readonly string[], fullPath: string): unknown {
  let current = node;
  for (const token of segments) {
    if (Array.isArray(current)) {
      const index = parseArrayIndex(token, false);
      if (index >= current.length) {
        throw pathMissing(`Array index ${index} does not exist (length ${current.length})`, fullPath);
      }
      current = current[index];
    } else if (isPlainObject(current)) {
      if (!Object.hasOwn(current, token)) {
        throw pathMissing(`Member ${JSON.stringify(token)} does not exist`, fullPath);
      }
      current = current[token];
    } else {
      throw pathMissing('Cannot descend into a non-container', fullPath);
    }
  }
  return current;
}

/** Reads the child at one token, for descending one level during application. */
function childAt(node: unknown, token: string, path: string): unknown {
  if (Array.isArray(node)) {
    const index = parseArrayIndex(token, false);
    if (index >= node.length) {
      throw pathMissing(`Array index ${index} does not exist (length ${node.length})`, path);
    }
    return node[index];
  }
  if (isPlainObject(node)) {
    if (!Object.hasOwn(node, token)) {
      throw pathMissing(`Member ${JSON.stringify(token)} does not exist`, path);
    }
    return node[token];
  }
  throw pathMissing('Cannot descend into a non-container', path);
}

/** Copy-on-write child replacement; indices and containers are pre-validated. */
function setChild(node: unknown, token: string, value: unknown): unknown {
  if (Array.isArray(node)) {
    const copy = node.slice();
    copy[parseArrayIndex(token, false)] = value;
    return copy;
  }
  if (isPlainObject(node)) {
    return { ...node, [token]: value };
  }
  throw patchInvalid(`Internal: cannot set a child on a non-container (token ${JSON.stringify(token)}).`);
}

/** Array index for an existing-position token; `-` is only valid on `add`. */
function requireArrayIndex(token: string, length: number, path: string): number {
  const index = parseArrayIndex(token, false);
  if (index > length) {
    throw pathMissing(`Array index ${index} is beyond length ${length}`, path);
  }
  return index;
}

function applyAddAt(node: unknown, segments: readonly string[], value: unknown, prefix: readonly string[]): StepOutcome {
  if (value === undefined) throw patchInvalid('Cannot add an undefined value; patches must stay JSON-safe.');
  const [head, ...rest] = segments;
  if (head === undefined) throw patchInvalid('Internal: empty path segments.');
  if (rest.length > 0) {
    const child = childAt(node, head, pointerAt(prefix, head));
    const step = applyAddAt(child, rest, value, [...prefix, head]);
    return { next: setChild(node, head, step.next), undo: step.undo };
  }
  if (Array.isArray(node)) {
    const index = head === '-' ? node.length : requireArrayIndex(head, node.length, pointerAt(prefix, head));
    const copy = node.slice();
    copy.splice(index, 0, deepCloneJson(value));
    return {
      next: copy,
      undo: [{ op: 'remove', path: pointerAt(prefix, String(index)) }],
    };
  }
  if (isPlainObject(node)) {
    const existed = Object.hasOwn(node, head);
    const next = { ...node, [head]: deepCloneJson(value) };
    return existed
      ? { next, undo: [{ op: 'replace', path: pointerAt(prefix, head), value: node[head] }] }
      : { next, undo: [{ op: 'remove', path: pointerAt(prefix, head) }] };
  }
  throw pathMissing('Cannot add into a non-container', pointerAt(prefix, head));
}

function applyRemoveAt(node: unknown, segments: readonly string[], prefix: readonly string[]): StepOutcome {
  const [head, ...rest] = segments;
  if (head === undefined) throw patchInvalid('Internal: empty path segments.');
  if (rest.length > 0) {
    const child = childAt(node, head, pointerAt(prefix, head));
    const step = applyRemoveAt(child, rest, [...prefix, head]);
    return { next: setChild(node, head, step.next), undo: step.undo };
  }
  if (Array.isArray(node)) {
    const index = requireArrayIndex(head, node.length, pointerAt(prefix, head));
    if (index >= node.length) {
      throw pathMissing(`Array index ${index} does not exist (length ${node.length})`, pointerAt(prefix, head));
    }
    const copy = node.slice();
    const [prior] = copy.splice(index, 1);
    return { next: copy, undo: [{ op: 'add', path: pointerAt(prefix, head), value: prior }] };
  }
  if (isPlainObject(node)) {
    if (!Object.hasOwn(node, head)) {
      throw pathMissing(`Member ${JSON.stringify(head)} does not exist`, pointerAt(prefix, head));
    }
    const prior = node[head];
    const copy = { ...node };
    delete copy[head];
    return { next: copy, undo: [{ op: 'add', path: pointerAt(prefix, head), value: prior }] };
  }
  throw pathMissing('Cannot remove from a non-container', pointerAt(prefix, head));
}

function applyReplaceAt(node: unknown, segments: readonly string[], value: unknown, prefix: readonly string[]): StepOutcome {
  if (value === undefined) throw patchInvalid('Cannot replace with an undefined value; patches must stay JSON-safe.');
  const [head, ...rest] = segments;
  if (head === undefined) throw patchInvalid('Internal: empty path segments.');
  if (rest.length > 0) {
    const child = childAt(node, head, pointerAt(prefix, head));
    const step = applyReplaceAt(child, rest, value, [...prefix, head]);
    return { next: setChild(node, head, step.next), undo: step.undo };
  }
  const prior = childAt(node, head, pointerAt(prefix, head));
  return {
    next: setChild(node, head, deepCloneJson(value)),
    undo: [{ op: 'replace', path: pointerAt(prefix, head), value: prior }],
  };
}

function stepDocument(document: unknown, op: PatchOp): StepOutcome {
  validateOpShape(op);
  switch (op.op) {
    case 'add': {
      const segments = requireNonRoot(op.path);
      return applyAddAt(document, segments, op.value, []);
    }
    case 'remove': {
      const segments = requireNonRoot(op.path);
      return applyRemoveAt(document, segments, []);
    }
    case 'replace': {
      const segments = requireNonRoot(op.path);
      return applyReplaceAt(document, segments, op.value, []);
    }
    case 'move': {
      // RFC 6902 §4.4: a move is the remove of `from` followed by an add of
      // the removed value. Its undo is therefore the two captured undos in
      // reverse step order: remove the destination (resolved if `-`), then
      // re-add the value at the source.
      const from = requireNonRoot(op.from);
      const path = requireNonRoot(op.path);
      const removed = applyRemoveAt(document, from, []);
      const removedUndo = removed.undo[0];
      if (removedUndo === undefined || removedUndo.op !== 'add') {
        throw patchInvalid('Internal: move could not capture the removed value.');
      }
      const added = applyAddAt(removed.next, path, removedUndo.value, []);
      return {
        next: added.next,
        undo: [...added.undo, ...removed.undo],
      };
    }
    case 'copy': {
      const from = requireNonRoot(op.from);
      const path = requireNonRoot(op.path);
      const value = getAt(document, from, op.from);
      return applyAddAt(document, path, value, []);
    }
    case 'test': {
      const segments = requireNonRoot(op.path);
      const actual = getAt(document, segments, op.path);
      if (!deepEqualJson(actual, op.value)) {
        throw new StoreError(
          StoreErrorCode.PatchTestFailed,
          `Value at ${JSON.stringify(op.path)} does not equal the tested value.`,
        );
      }
      return { next: document, undo: [] };
    }
  }
}

/**
 * Applies a patch to `before` and derives its exact inverse in one pass.
 * Throws a `StoreError` on the first failing operation, leaving `before` untouched.
 */
export function applyWithInverse(before: JsonDocument, ops: Patch): { readonly next: JsonDocument; readonly inverse: Patch } {
  let running: unknown = before;
  const undoLists: (readonly PatchOp[])[] = [];
  for (const op of ops) {
    const outcome = stepDocument(running, op);
    undoLists.push(outcome.undo);
    running = outcome.next;
  }
  // Later steps unwind first; each step's undo group keeps its own order
  // (a move's two-op group re-adds the source after removing the destination).
  const inverse: PatchOp[] = [];
  for (let i = undoLists.length - 1; i >= 0; i -= 1) {
    inverse.push(...undoLists[i]!);
  }
  return { next: running as JsonDocument, inverse };
}

/**
 * Applies a patch; throws a `StoreError` on the first failing operation.
 * Pure: never mutates `before`, never aliases inserted values into it.
 */
export function applyPatch(before: JsonDocument, ops: Patch): JsonDocument {
  return applyWithInverse(before, ops).next;
}

/**
 * The exact inverse of `ops` with respect to the state `before`. Used for
 * validating recorded logs and by tests; the store itself uses
 * `applyWithInverse` so forward and inverse never diverge.
 */
export function invertPatch(before: JsonDocument, ops: Patch): Patch {
  return applyWithInverse(before, ops).inverse;
}
