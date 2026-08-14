# `components/ai/` — vendored assistant-ui surfaces

Verbatim source lifted from [`assistant-ui/assistant-ui`](https://github.com/assistant-ui/assistant-ui) at commit
[`822a3b3`](https://github.com/assistant-ui/assistant-ui/tree/822a3b39dc3d6df1e65d93493a338623d7570ff7)
(MIT — see `LICENSE-upstream.md`). Everything here is a pure presentational
component driven entirely by props; no runtime or state layer from upstream
is adopted.

## Vendored files

Line counts are as measured (`wc -l`) after copy. Small differences from the
counts referenced in the upstream discussion are due to trailing-newline
handling; the content is byte-identical to upstream.

| File | Source path (at pinned SHA) | Lines |
|---|---|---:|
| `terminal-block.tsx`  | `packages/ui/src/components/elements/terminal-block.tsx`  | 111 |
| `code-diff.tsx`       | `packages/ui/src/components/elements/code-diff.tsx`       |  83 |
| `reasoning-panel.tsx` | `packages/ui/src/components/elements/reasoning-panel.tsx` | 100 |
| `message-timing.tsx`  | `packages/ui/src/components/elements/message-timing.tsx`  |  49 |
| `surfaces.tsx`        | `packages/ui/src/components/elements/surfaces.tsx`        | 122 |
| `range.ts`            | `packages/ui/src/components/elements/range.ts`            |  48 |

`LICENSE-upstream.md` reproduces upstream's root `LICENSE` and states the
pinned SHA.

## Behavioral deltas from upstream

Files are byte-identical to the upstream source at
`822a3b39dc3d6df1e65d93493a338623d7570ff7`, with one exception:

- **`terminal-block.tsx`** — the streaming cursor `<span>` was conditionally
  mounted (`{!done && …}`), which removed a line-height of space at
  completion and caused a visible layout jump. We keep the span always
  mounted and toggle `invisible` instead (same box, no reflow).

The only structural note is import-resolution:

- **`reasoning-panel.tsx`** imports `@/components/ui/collapsible`. This
  resolves in our repo to `src/ui/omp/components/ui/collapsible.tsx`, an
  existing shadcn-style shim that re-exports the primitives directly from
  `@radix-ui/react-collapsible`. Upstream's own `ui/radix/collapsible.tsx`
  wraps the `radix-ui` meta-package; we do **not** vendor that file and we
  do **not** add the `radix-ui` meta-package. If the local shim were absent,
  the intended delta on the vendored `collapsible.tsx` would be exactly one
  line — rewriting `from "radix-ui"` to `from "@radix-ui/react-collapsible"`
  — since `@radix-ui/react-collapsible` is already installed.

## How to update the vendor

1. Bump the pinned SHA in `LICENSE-upstream.md` and this file's header.
2. `curl` each vendored file from
   `https://raw.githubusercontent.com/assistant-ui/assistant-ui/<sha>/packages/ui/src/components/elements/<name>`.
3. Re-run `pnpm --filter omp-vscode exec tsc --noEmit` and the adapter
   tests (`pnpm --filter omp-vscode test`).
4. If a new upstream file needs the collapsible primitive and lands as
   `ui/radix/collapsible.tsx`, vendor it here and rewrite its only import
   to `@radix-ui/react-collapsible` per the delta above.

## Consumers

The vendored components are driven by four pure adapters in
`src/ui/omp/domain/`:

- `terminal.ts` → `toTerminalStats(block, result, options?)` → props for
  `<TerminalBlock>`
- `diff.ts` → `toDiffLinesList(block, result, options?)` → one entry per
  hunk for a stack of `<CodeDiff>` cards
- `reasoning.ts` → `toReasoningSteps(block, options?)` → props for
  `<ReasoningPanel>`
- `timing.ts` → `toTimingStats(message, options?)` → props for
  `<MessageTiming>`

Adapters are unit-tested in `src/ui/omp/domain/adapters.test.ts`. Adapters
are pure functions with no React, no bridge, and no I/O — one shape in,
one shape out.

Renderers (in `src/ui/omp/components/chat/parts/`) consume the vendored
components; local wrappers own transient view state (expand/collapse for
terminal blocks, open/close for the reasoning panel, filename-click for
diff cards).
