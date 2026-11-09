# @stationeers/engine

Engineering engine (spec §2.2 layer 3): deterministic numerics (FND-05a) and
revision-aware job infrastructure (FND-05b). Spec sections of record:
5.1.1 (numeric representation), 5.5 (determinism), 5.6 (runtime performance).

## Numerics (`src/numerics/`)

### Precision discipline — when to fround

Every behavior model **documents** the float precision of its mechanic and
the exact points where values are stored into a 32-bit game variable or
participate in a 32-bit arithmetic step (spec 5.1.1). Then:

- Use `addF32`/`subF32`/`mulF32`/`divF32` at those documented 32-bit steps,
  and `roundToGamePrecision(x, 'f32')` where a double result is stored into
  a float field. Nothing rounds anywhere else.
- Never fround "generally": rounding at extra points diverges from the game
  exactly as much as missing rounding.
- `sqrtF32(x)` is the correctly rounded binary32 square root (fround of the
  exact double sqrt — safe by the 2p+2 double-rounding condition). Which of
  `sqrt`/`sqrtF32` a mechanic uses is a fixture-confirmed decision, per
  behavior model.
- `*F64` helpers are the plain double operations; they exist so call sites
  state their precision intent and so precision greps are exhaustive.

For binary32 *inputs*, the f32 helpers are exact emulations of binary32
arithmetic (binary64 carries 53 ≥ 2·24+2 significand bits, the classical
double-rounding safety condition, subnormals included).

### Ordered summation

Floating addition is not associative, and the game's accumulation order can
change results at the ulp level. `sumOrdered(values, { precision })` sums
strictly left-to-right with rounding after every operation. Pass values in
the order the behavior model documents for the game — reordering is a
modeling decision, not an optimization.

### Transcendentals (`exp`, `log`, `log2`, `pow`, `sqrt`)

Backed by **decimal.js** running in an isolated constructor:
`Decimal.clone({ precision: 50, rounding: ROUND_HALF_UP })`. decimal.js does
its own base-10⁷ limb arithmetic with fixed rounding and never calls libm,
so identical inputs and configuration are bit-identical on every platform
(spec 5.5) without depending on browser `Math` (spec 5.1.1).

Per-call pipeline:

1. IEEE/C99 edge cases (NaN/±Inf/±0/negative domains, the full `pow`
   special-case table) resolve in plain JS.
2. The double is converted to the **exact** decimal value of its bits
   (`doubleToExactDecimal`: BigInt mantissa × power-of-two — a terminating
   decimal — never the shortest round-trip string).
3. Evaluated at 50 significant digits.
4. `.toNumber()` converts back through the ECMAScript string→Number
   conversion, which the language spec requires to be correctly rounded.

With 50 correct digits feeding a 16-digit target, results are correctly
rounded doubles in practice (worst case ≤ 1 ulp by construction). The suite
asserts **exact** bit equality against 60-digit decimal references for 88
fixtures spanning subnormals, ±10¹⁰, near-threshold overflow/underflow, and
the log2(√2) cancellation points — all exact.

`exp`/`pow` make their overflow/underflow cliff decisions against exact
decimal boundaries (`OVERFLOW_LN` = ln((2−2⁻⁵³)·2¹⁰²³), `UNDERFLOW_LN` =
ln(2⁻¹⁰⁷⁶)), so results become ±Inf/±0 exactly where binary64 rounding puts
the boundary.

Cost note: digit-limb arithmetic is orders of magnitude slower than libm.
Fine for Verified static/offline calculations; avoid per-tick hot loops.

**Config ownership:** the cloned constructor lives in
`transcendentals.ts`; other modules must not call `Decimal.set` — the
global decimal.js configuration is untouched by this package.

**Reference regeneration** (when adding fixtures): compute true values with
Python's stdlib decimal and freeze the bit patterns:

```python
from decimal import Decimal, getcontext
import struct
getcontext().prec = 60
x = 2.718281828459045  # the double under test
print('%08X_%08X' % struct.unpack('>II', struct.pack('>d', float(Decimal(x).ln()))))
```

`float(Decimal)` is correctly rounded in CPython, so the printed pattern is
the true value's double. `pow(x, y)` ≈ `Decimal(x) ** Decimal(y)`,
`log2(x)` ≈ `Decimal(x).ln() / Decimal(2).ln()`, `sqrt(x)` ≈
`Decimal(x).sqrt()`.

### Exact scaling and bit access

- `scalbn(x, n)` — exact ×2ⁿ via power-of-two multiplication with the
  subnormal-range double-rounding fix (musl-derived). Hand-rolled on
  purpose: it is exact arithmetic, not an approximation, and needs no
  decimal pipeline.
- `bits.ts` — `f64Words`/`f64FromWords`/`f32Word`/… word access with an
  explicit byte order (endianness-independent), plus `ulpDistance` for
  fixture comparisons. Test-support grade, deterministic.

## Jobs (`src/jobs/`)

Spec 5.6: graph-intensive/time-stepped calculations run in workers with
cancellation and progress; every job carries the revision ID it started on;
a result older than the current revision is flagged stale or discarded and
**never overwrites newer state**.

### Inline runner (tests, cheap static calculations)

```ts
const runner = createJobRunner({
  getCurrentRevision: () => store.revisionId,
  onStale: 'flag', // or 'discard' to withhold stale values entirely
});

const handle = runner.submit(computePressure, {
  // revisionId defaults to getCurrentRevision() at submit time
  label: 'network pressure',
  onProgress: (p, msg) => ui.showProgress(p, msg),
});
const outcome = await handle.result; // resolves, never rejects
if (outcome.status === 'completed' && !outcome.isStale) apply(outcome.value);
```

Outcomes:

| status | when |
|---|---|
| `completed` | body settled; `isStale` flags a moved revision (`'flag'` policy) |
| `discarded` | stale under the `'discard'` policy — value withheld |
| `cancelled` | `cancel()`/`cancelAll()` (delivered immediately), or the body threw `JobCancelledError` |
| `failed` | body threw anything else, or `getCurrentRevision()` itself threw |

Cancellation is cooperative: the body polls `ctx.signal.aborted`, calls
`signal.throwIfAborted()`, or registers `signal.onAbort(...)`. After
`cancel()` the outcome is always `cancelled` — a body that finishes anyway
has its value dropped. A body that never polls keeps running but can no
longer delay or affect the outcome.

### Worker adapter (real browsers, framework-agnostic)

Functions cannot cross `postMessage`, so worker jobs are addressed by name.
The protocol is Zod-validated on both ends (Zod v4 — runtime validation
boundary per repo convention; note `z` imports as a namespace:
`import * as z from 'zod'`).

```ts
// main thread
const jobs = createWorkerAdapter(() => new Worker('./engine.worker'), {
  getCurrentRevision: () => store.revisionId,
});
const handle = jobs.run({ name: 'transient-solve', payload: scenario }, {
  revisionId, label: 'transient', onProgress,
});

// inside the worker module
serveWorkerJobs({ 'transient-solve': solve }, self);
```

Payloads and results must be structured-cloneable. `dispose()` terminates
the worker and settles pending jobs as cancelled. The core semantics
(revision tagging, staleness, cancellation, progress) are shared with the
inline runner via `core.ts` and fully testable without Workers — the
adapter tests drive the same code through an in-memory postMessage pair.

## Validation

`bun run typecheck && bun run test` from the repo root. Spec 5.5's
multi-engine enforcement lands with QA-01's Playwright matrix; the golden
fixtures here are engine-independent by construction.
