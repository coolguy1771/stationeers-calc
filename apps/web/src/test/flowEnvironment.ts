/**
 * React Flow under jsdom (test-only support).
 *
 * Imported for its side effects by the test files that mount the schematic
 * canvas. Two browser APIs React Flow relies on are missing from jsdom:
 *
 * - `ResizeObserver` (node/handle measurement) — a no-op stub is enough; nodes
 *   render unmeasured, which is fine because the tests assert content, not
 *   rendered edge geometry.
 * - `document.elementFromPoint` (hit-testing the handle under the pointer) —
 *   React Flow falls back to the handle it resolved from the event, which is
 *   what makes click-to-connect work in tests exactly as it does in a browser.
 *
 * This is test scaffolding, not application code: nothing in `src/` imports it
 * outside `*.test.tsx` files.
 */
class ResizeObserverStub {
  observe(): void {}
  unobserve(): void {}
  disconnect(): void {}
}

export function installReactFlowTestEnvironment(): void {
  if (typeof globalThis.ResizeObserver === 'undefined') {
    globalThis.ResizeObserver = ResizeObserverStub as unknown as typeof ResizeObserver;
  }
  if (typeof document !== 'undefined' && typeof document.elementFromPoint !== 'function') {
    document.elementFromPoint = () => null;
  }
}

/**
 * A mouse event d3-drag can start from: jsdom rejects the `view` constructor
 * field under Vitest's global proxy, so it is attached afterwards.
 */
export function mouseEventWithView(type: string, init: MouseEventInit): MouseEvent {
  const event = new MouseEvent(type, {
    bubbles: true,
    cancelable: true,
    button: 0,
    ...init,
  });
  Object.defineProperty(event, 'view', { value: window });
  return event;
}

installReactFlowTestEnvironment();
