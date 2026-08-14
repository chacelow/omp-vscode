# OMP webview refactor — handoff

Continuation guide for any agent (or human) picking up mid-flight. Reads in ≤2 minutes and tells you exactly where we are, what to do next, and how to verify without opening the VS Code extension.

Last updated: 2026-08-14. Two of four tickets landed on `main` (`23f07d8`, `9140a77`). One is executing in the background as of this write. One is queued.

---

## 1. Project scope

Refactor `packages/omp-vscode`'s webview UI into a modular architecture, then vendor & swap four visual surfaces from `assistant-ui/assistant-ui` (Phase 1 visual polish). `packages/omp-web` is archived reference and is NEVER modified.

Full context: GitHub issue [#1 (retitled Ticket 3)](https://github.com/chacelow/omp-vscode/issues/1) + its addendum comment, plus tickets [#2](https://github.com/chacelow/omp-vscode/issues/2), [#3](https://github.com/chacelow/omp-vscode/issues/3), [#4](https://github.com/chacelow/omp-vscode/issues/4).

## 2. Ticket state (chacelow/omp-vscode)

| Tracker # | Nickname | Status | Commit |
|---|---|---|---|
| **#2** | **T1 skeleton + settings slice** | ✅ landed | `23f07d8` |
| **#3** | **T2 part registry** | ✅ landed | `9140a77` |
| **#4** | **T4 useAgentSession decomp Phase A** | ✅ landed | `feb904a` |
| **#1** | **T3 vendor + 4 assistant-ui swap** | ✅ landed | `f741088` |
| **#5** | **T5 Phase A cont. (tools + permissions + subagents)** | ✅ landed | `fa065ba` |

Phase 1 + Phase A cont. complete. Bundle 1,846,459 → **1,852,471 gzip bytes** (+6,012 B / +30 KB budget = 20% used). vitest 38/38 pass. tsc silent for `omp-vscode`. `subscribeAcp` has one non-bridge caller (`transport/acp-events.ts`). `useAgentSession.ts` is 1623 lines; Phase A contract step (delete facade) is deferred to a future ticket.

## 3. Established conventions (MUST follow for future tickets)

Landed in `23f07d8`. Do NOT deviate.

- Directory layout under `packages/omp-vscode/src/ui/omp/`:
  - `state/` — zustand v5 slices, `immer` middleware. `create<T>()(immer((set) => ({...})))`.
  - `transport/` — the ONLY layer allowed to touch `../bridge.ts` (`hostCall`, `acpRequest`, `subscribeAcp`, ACP wire types).
  - `domain/` — pure functions, no React, no I/O.
  - `hooks/` — selector-shaped React bindings. Never inline `useSettingsStore(sel)` in components; wrap it here.
  - `components/chat/parts/` — one file per part type; `parts/tools/` for per-tool renderers. Dispatched via `parts/registry.ts` (`partRegistry`, `toolRenderers`).
- One-way dependency rule: `components → hooks → state → transport / domain`. Enforced by review.
- Path alias: `@` → `src/ui/omp/`.
- Build: `pnpm --filter omp-vscode build`. Typecheck: `cd packages/omp-vscode && pnpm exec tsc --noEmit`.
- Bundle baseline (as of `9140a77`): **1,846,611 bytes gzip**. Budget for the full Phase 1 (through ticket #1) is +30 KB total vs `23f07d8` (1,846,459).
- No test runner in `packages/omp-vscode`. Do NOT add one until ticket #1 (adapter unit tests earn their weight there).
- `omp-web/hooks/useTheme.ts` has pre-existing typecheck errors (`startViewTransition`). NOT this refactor's concern.

## 4. What has already changed (files you should NOT re-derive)

### `23f07d8` (Ticket #2)

- New: `state/settings-store.ts`, `transport/settings-transport.ts`, `hooks/useSettings.ts`.
- Rewritten: `hooks/usePreferences.tsx` → facade shim over the store; public API preserved verbatim.
- New READMEs: `state/`, `transport/`, `domain/`, `hooks/` — each documents the one-way dep rule.
- New deps: `zustand`, `immer`, `@tanstack/react-query`, `@tanstack/react-virtual`, `anser`, `nanoid`.

### `9140a77` (Ticket #3)

- Trimmed: `components/MessageView.tsx` (no `switch` on part type remains), `components/chat/ToolLine.tsx` (no `switch` on tool name remains).
- New: `components/chat/parts/registry.ts`, `types.ts`, `tools.tsx`.
- New part renderers: `TextPart`, `ThinkingPart`, `ToolCallPart`, `ImagePart`, `DebugPart` (stub extensibility proof).
- New tool renderers under `parts/tools/`: `Bash`, `Edit`, `Fetch`, `Glob`, `Grep`, `Read`, `Todo`, `WebSearch`, `Write`.
- New empty stubs in `domain/`: `parts.ts`, `ansi.ts`, `diff.ts`, `timing.ts` — bodies land in ticket #1.

## 5. How to verify — no VS Code extension required

**Full verification recipe**, runnable from repo root without launching the webview:

```bash
# 1. tree cleanliness
git status --short                                  # only intentional changes tracked
git log --oneline -6                                # confirm 23f07d8 and 9140a77 present

# 2. static correctness
cd packages/omp-vscode && pnpm exec tsc --noEmit    # must be silent
cd ../..                                            # back to repo root

# 3. bundle build + gzip budget
pnpm --filter omp-vscode build                      # must succeed
gzip -c packages/omp-vscode/dist/webview.js | wc -c # compare to baseline in §3

# 4. structural invariants (grep-based, no runtime)
#    4a. No part-type switch in MessageView, no tool-name switch in ToolLine
grep -nE 'switch\s*\(' packages/omp-vscode/src/ui/omp/components/MessageView.tsx
grep -nE 'switch\s*\(' packages/omp-vscode/src/ui/omp/components/chat/ToolLine.tsx
# Both MAY still contain other switches (e.g. on message.role); confirm none of the
# printed lines discriminate on part.type or tool.name.

#    4b. bridge access outside transport/ — transitional; each ticket shrinks this set
grep -rn 'from ["'\'']\.\./\.\./bridge' packages/omp-vscode/src/ui/omp/ \
  | grep -v '/transport/'
# Expected as of commit 9140a77 (14 callers). Ticket #4 shrinks this to ~13
# (hooks/useAgentSession removed); ticket #1 adds none. The end-state is
# transport-only after later tickets extract the remaining slices.

#    4c. registry sizes — proves per-type extensibility landed
grep -c ': ' packages/omp-vscode/src/ui/omp/components/chat/parts/registry.ts
# Should print >= 20 (part types + tool aliases).

#    4d. useAgentSession public API preserved (baseline for #4 verification)
grep -nE '^\s*(export\s+)?(function|const|type|interface)\s+\w+' \
  packages/omp-vscode/src/ui/omp/hooks/useAgentSession.ts \
  | tee /tmp/useAgentSession-api.after
# Before #4 lands, snapshot the same into /tmp/useAgentSession-api.before via git show HEAD~1:…
```

**Manual smoke via code (no extension launch)** — for ticket #1 (Phase 1 visual swap) later:

```bash
# Fixture-based smoke: build the webview into a plain HTML shell driven by
# stub bridge messages. The `openImageInVSCode` etc. globals must be stubbed.
# A stub harness is NOT yet in the tree; when #1 lands, its adapter unit tests
# provide the equivalent evidence and no HTML harness is required.
```

## 6. Immediate next actions

### 6a. When `SessionDecomp` finishes (in flight)

1. Read its report: `read agent://SessionDecomp`.
2. Verify commit exists: `git log --oneline -3`.
3. Run §5's full recipe.
4. Additional #4-specific checks:
   - `git diff 9140a77 -- packages/omp-vscode/src/ui/omp/hooks/useAgentSession.ts` — every removed export must be re-exported from the new store via the facade. Diff-against-baseline `useAgentSession` public API listed in §5.4c.
   - Grep for any second subscriber to `subscribeAcp`: only `transport/acp-events.ts` should call it for the events it owns. Other pre-existing `subscribeAcp` calls (permissions, tools, subagents) are fine — those slices are NOT extracted yet.
5. Post verdict comment on issue #4 if the subagent already posted, add a follow-up if anything failed.

### 6b. Dispatch ticket #1 (T3 vendor + 4 swap)

1. Read GitHub issue [#1](https://github.com/chacelow/omp-vscode/issues/1) body + addendum comment in full — the addendum contains the pinned SHA `822a3b3`, corrected prop shapes, US #13/#16/#18 revisions, and file list.
2. Spawn a `task` (or `senior-engineer-p7`) subagent with the addendum + this HANDOFF as context. Its acceptance:
   - 6 files vendored under `components/ai/` from `assistant-ui/assistant-ui@822a3b3` with `LICENSE-upstream.md` + `README.md` naming SHA and behavioral deltas.
   - Vendored `collapsible.tsx` rewritten to import `@radix-ui/react-collapsible` directly (already installed).
   - Four pure adapters in `domain/` (`toTerminalStats`, `toDiffLines`, `toReasoningSteps`, `toTimingStats`) with unit tests — this ticket introduces the first test runner. Install `vitest` under `omp-vscode`, add a `test` script.
   - Four part renderers under `parts/` and/or `parts/tools/` updated to consume vendored components.
   - Bundle delta ≤ +30 KB gzipped vs `23f07d8`.
   - Committed to `main` closing #1.
3. Verify with §5's recipe plus adapter tests: `cd packages/omp-vscode && pnpm exec vitest run`.

### 6c. Push to origin

Not yet done. When #1 lands and #4 is verified:

```bash
git push origin main
```

## 7. Deferred (out of Phase 1)

Do NOT drift into these without a new ticket:

- Extract `tools`, `permissions`, `subagents` slices from `useAgentSession` (Phase A follow-up).
- Delete the `useAgentSession` facade (Phase A contract step).
- Phase 2 visuals: parallel-tools grouping, MCP panel, context breakdown.
- Phase 3 structure: thread list, thread search, background runs.
- `omp-web` visual parity (archived reference).

## 8. If everything is broken

- Roll back one ticket: `git revert <sha> --no-edit`. Every commit is atomic and self-contained.
- Restore lockfile if pnpm drifts: `pnpm install --no-frozen-lockfile` from repo root.
- If `omp-web` typecheck blocks you (root `typecheck` script), run typecheck per-package: `cd packages/omp-vscode && pnpm exec tsc --noEmit`.
