# BlockPy Studio Code Standards (M5.3)

Codifies the rules the codebase already follows. CI enforces the
mechanical ones (`pnpm lint` runs with `--max-warnings 0`; typecheck,
tests, and format ride the same workflow). The rest are review policy -
this document is the PR checklist's reference.

## TypeScript

- **No `any`.** `@typescript-eslint/no-explicit-any` stays at _error_
  workspace-wide (M5.2 drove the count to zero - keep it there). Escape
  hatch, in order of preference:
  1. a precise type (the IR unions in `packages/blocks/src/ir/types.ts`
     cover the converter surface; Blockly 11's own types cover most block
     work);
  2. `unknown` + narrowing;
  3. `as unknown as X` for members Blockly's public types genuinely lack,
     with a one-line comment saying _why the cast is safe_;
  4. only when none of those work: `// eslint-disable-next-line` **with a
     justification comment** (see the `astStr.ts` legacy-regex block for
     the expected shape). A bare disable is a review reject.
- **Intentionally unused** parameters/variables take a `_` prefix
  (`argsIgnorePattern`/`varsIgnorePattern` are configured). Dead-but-
  ported legacy bookkeeping keeps its name with the prefix and a comment
  citing the legacy line (`_lineNumberInBody`).
- Prefer `interface` for object shapes, discriminated unions for node
  vocabularies (`_astname` tags in the IR), and `as const` tables over
  enums.

## React

- **Hook deps are exact.** No `react-hooks/exhaustive-deps` disables.
  When a hook needs props, destructure them first and depend on the
  pieces - never on the whole `props` object:

  ```tsx
  const { onCodeChange, runController } = props;
  const handleRun = useCallback(() => { ... }, [runController, onCodeChange]);
  ```

  If a value must be readable without retriggering (event handlers that
  want "latest"), use the ref-mirror pattern
  (`const latest = useRef(props); latest.current = props;`) - see
  `DualEditorView`.

- Construction-time configuration (Blockly workspaces, CM6 views) mounts
  once; changing it means a keyed remount, not a mutating effect
  (`DualEditorView`, the focused-mode height swap).
- Global chrome state lives in the zustand store
  (`packages/editor/src/chrome/store.ts`); persisted display preferences
  use the `BLOCKPY_display.*` localStorage keys and fail soft when
  storage is denied.

## Module layout

- One legacy source file ↔ one Studio module wherever the port allows;
  the module docblock names the legacy file and the semantics ported
  (see any `packages/blocks/src/ast/*` header).
- Packages export through their `src/index.ts`; cross-package imports go
  through the `@blockpy/*` workspace names, never relative paths.
- Wire formats, prefixes, and event names come from the frozen appendices
  (`docs/appendices/A1..A7`) - code cites the appendix, not folklore.

## Comments

- Comments state **constraints** - the legacy `file:line` being ported,
  the quirk being preserved, the invariant the next reader must not
  break. Never narration ("increment the counter"), never provenance of
  the edit itself. If a deviation is deliberate, the comment names the
  ledger entry (LD-nn).

## Tests

- **Conformance suites** (round-trip corpus in `packages/blocks`, API
  replay against golden transcripts, A8 UI-parity checks) pin legacy
  behavior; a failing conformance test is fixed in the code unless a
  ledger entry authorizes the difference - then the test encodes the
  ledger's exact wording.
- **Unit tests** live beside the module (`x.test.ts[x]`), use vitest;
  jsdom files start with `// @vitest-environment jsdom` and register
  `afterEach(cleanup)` when they render React (RTL auto-cleanup is off -
  stale mounts leak window listeners).
- Engine tests that need real wheels gate behind `PEDAL_IT=1`; full
  Pyodide e2e gates behind `PYODIDE_E2E=1`. Neither runs in default CI.

## Behavior changes

- Any observable deviation from the legacy client needs an
  [approved-differences ledger](approved-differences.md) entry (LD-nn)
  BEFORE it merges: legacy behavior, Studio behavior, wire impact.
  Extensions with no legacy analog get an entry too (capability itself).
- New telemetry uses `X-`-prefixed event names only, registered in
  A2 §5.1.
- New settings keys are raw strings per A4 semantics and join the A4
  Studio-extensions table.

## PR checklist

- [ ] `pnpm lint` (zero errors, zero warnings), `pnpm typecheck`,
      `pnpm test` green
- [ ] behavior deltas have a ledger entry; quirks kept on purpose have a
      citing comment
- [ ] new events/settings registered in the appendices
- [ ] tests updated beside the code they gate
