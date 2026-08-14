# Reference patterns: resume, replay, and viewport anchoring

**Method.** Source was read through GitHub raw/API endpoints only (no clone). Line ranges below refer to the pinned URL/revision named in each citation. “No evidence found” means the inspected implementation does not implement that mechanism; it is not a claim about the whole product.

## 1. Zed — ACP reference client

**Source:** `zed-industries/zed` `d89ee32a`, `crates/agent_ui/src/acp/thread_view.rs`; session-list companion `2aa36660`, `crates/agent_ui/src/thread_history.rs`.

### Resume/history delivery

* Zed prefers `load_session` when the connection supports it, and calls `resume_session` only as a fallback. The fallback is explicitly marked `resumed_without_history` ([thread_view.rs:494-507](https://github.com/zed-industries/zed/blob/d89ee32a/crates/agent_ui/src/acp/thread_view.rs#L494-L507)). Thus load is the history-bearing snapshot path; resume is deliberately allowed to have no history.
* On creation, the view reads `thread.entries()` once, creates a bottom-aligned `ListState`, synchronizes every existing entry, and inserts all focus handles ([thread_view.rs:628-665](https://github.com/zed-industries/zed/blob/d89ee32a/crates/agent_ui/src/acp/thread_view.rs#L628-L665)). This is snapshot hydration, not UI replay of every historical transport event.
* After that, live `AcpThreadEvent::NewEntry`, `EntryUpdated`, and `EntriesRemoved` mutate just the affected entry/list range ([thread_view.rs:1002-1044](https://github.com/zed-industries/zed/blob/d89ee32a/crates/agent_ui/src/acp/thread_view.rs#L1002-L1044)).
* The test asserts the fallback’s empty state: `assert!(...resumed_without_history); assert_eq!(...item_count(), 0)` ([thread_view.rs:2735-2772](https://github.com/zed-industries/zed/blob/d89ee32a/crates/agent_ui/src/acp/thread_view.rs#L2735-L2772)). Do not pretend an ACP `resume_session` recreates a transcript.

### Batching and anchoring

* Session-list notifications are coalesced: receive one update, then drain the channel with `try_recv()` into `updates` before one UI update ([thread_history.rs:38-62](https://github.com/zed-industries/zed/blob/2aa36660/crates/agent_ui/src/thread_history.rs#L38-L62)). This is event-loop batching, not a timed/rAF batch.
* Resume starts bottom-aligned (`ListAlignment::Bottom` above). Zed also has an explicit edit/regenerate-style target: `scroll_to_most_recent_user_prompt`; its test expects index 2 in `[User1, Assistant1, User2, Assistant2]`, falling back to bottom when no user exists ([thread_view.rs:4119-4182](https://github.com/zed-industries/zed/blob/d89ee32a/crates/agent_ui/src/acp/thread_view.rs#L4119-L4182)).
* Worth retaining as a contract comment: **“Entries layout is: [User1, Assistant1, User2, Assistant2]”** (Zed test, attribution above). It makes the intended edit/regenerate anchor unambiguous.

## 2. Roo Code — virtualized chat

**Source:** `RooCodeInc/Roo-Code` PR head `6b471355`, `webview-ui/src/components/chat/ChatView.tsx` and `webview-ui/src/hooks/useScrollLifecycle.ts`. The requested `apps/vscode/...` path is not present in this public revision; the linked historical public webview path is the actual Virtuoso implementation.

### Resume/history delivery and batching

* ChatView receives `clineMessages` as state, derives `modifiedMessages`, filters it, and passes the complete visible list to Virtuoso; it does not replay old messages through the streaming callback ([ChatView.tsx:1120-1310](https://github.com/RooCodeInc/Roo-Code/blob/6b471355/webview-ui/src/components/chat/ChatView.tsx#L1120-L1310)). It also explicitly avoids truncation: **“Remove the 500-message limit to prevent array index shifting / Virtuoso is designed to efficiently handle large lists through virtualization”** ([ChatView.tsx:1024-1027](https://github.com/RooCodeInc/Roo-Code/blob/6b471355/webview-ui/src/components/chat/ChatView.tsx#L1024-L1027)).
* It batches *consecutive tool rows* (read, list, edit) into synthesized display rows, rather than batching token/store delivery ([ChatView.tsx:1120-1288](https://github.com/RooCodeInc/Roo-Code/blob/6b471355/webview-ui/src/components/chat/ChatView.tsx#L1120-L1288)). No rAF/16-ms streaming-store coalescer was found in these files.
* Smooth follow is debounced 10 ms, immediate-first: `debounce(...scrollToIndex(..."LAST"...), 10, { immediate: true })` ([useScrollLifecycle.ts:123-131](https://github.com/RooCodeInc/Roo-Code/blob/6b471355/webview-ui/src/hooks/useScrollLifecycle.ts#L123-L131)). This limits repeated layout scroll commands, not state updates.

### Anchoring and rationale

* Task switch enters `HYDRATING_PINNED_TO_BOTTOM`, calls `scrollToIndex({index:"LAST", align:"end", behavior:"auto"})`, and permits one 160-ms retry inside a 600-ms hydration window ([useScrollLifecycle.ts:1-13](https://github.com/RooCodeInc/Roo-Code/blob/6b471355/webview-ui/src/hooks/useScrollLifecycle.ts#L1-L13), [145-210](https://github.com/RooCodeInc/Roo-Code/blob/6b471355/webview-ui/src/hooks/useScrollLifecycle.ts#L145-L210)). So resume lands at bottom, then follows output.
* This is a real state machine: hydration ignores transient `atBottom=false`; upward wheel/keyboard/pointer/row expansion moves to `USER_BROWSING_HISTORY` and prevents forced re-pin ([useScrollLifecycle.ts:1-13](https://github.com/RooCodeInc/Roo-Code/blob/6b471355/webview-ui/src/hooks/useScrollLifecycle.ts#L1-L13), [300-485](https://github.com/RooCodeInc/Roo-Code/blob/6b471355/webview-ui/src/hooks/useScrollLifecycle.ts#L300-L485)).
* Quote worth stealing (attribute Roo Code): **“Retry budget exhausted. Keep anchored follow rather than downgrading to browsing mode due to non-user transient drift.”** ([useScrollLifecycle.ts:178-180](https://github.com/RooCodeInc/Roo-Code/blob/6b471355/webview-ui/src/hooks/useScrollLifecycle.ts#L178-L180)).

## 3. Continue — snapshot session + user-intent follow

**Source:** `continuedev/continue` `main`, `gui/src/redux/thunks/session.ts`, `gui/src/pages/gui/Chat.tsx`, `gui/src/pages/gui/useAutoScroll.ts`.

* `history/load` returns one `Session`; `loadSession` dispatches `newSession(session)` once ([session.ts:20-31](https://github.com/continuedev/continue/blob/main/gui/src/redux/thunks/session.ts#L20-L31), [55-82](https://github.com/continuedev/continue/blob/main/gui/src/redux/thunks/session.ts#L55-L82)). This is snapshot hydration, not replay.
* Chat renders the stored `history` array keyed by message id ([Chat.tsx:390-425](https://github.com/continuedev/continue/blob/main/gui/src/pages/gui/Chat.tsx#L390-L425)). No rAF/microtask/16-ms delivery coalescer appears in the inspected GUI session/stream/scroll path.
* Its `ResizeObserver` scrolls to `scrollHeight` only while `userHasScrolled` is false ([useAutoScroll.ts:20-57](https://github.com/continuedev/continue/blob/main/gui/src/pages/gui/useAutoScroll.ts#L20-L57)). The rationale is unusually concise: **“Only reset scroll state when a new user message is added… We don't want to auto-scroll on new tool response messages.”** and **“We stop auto scrolling if a user manually scrolled up.”** ([useAutoScroll.ts:4-8](https://github.com/continuedev/continue/blob/main/gui/src/pages/gui/useAutoScroll.ts#L4-L8), [31-35](https://github.com/continuedev/continue/blob/main/gui/src/pages/gui/useAutoScroll.ts#L31-L35)).

## 4. assistant-ui — pinned `822a3b3`

**Source:** `assistant-ui/assistant-ui` `822a3b3`, `packages/react/src/primitives/thread/useThreadViewportAutoScroll.ts` and `ThreadViewport.tsx`.

### Resume semantics and batching

* History is runtime-owned; the viewport watches whether `thread.messages.length > 0`. First loaded messages schedule an **instant** bottom scroll; switching a thread does the same ([useThreadViewportAutoScroll.ts:31-49](https://github.com/assistant-ui/assistant-ui/blob/822a3b3/packages/react/src/primitives/thread/useThreadViewportAutoScroll.ts#L31-L49), [196-224](https://github.com/assistant-ui/assistant-ui/blob/822a3b3/packages/react/src/primitives/thread/useThreadViewportAutoScroll.ts#L196-L224)). Its test separately proves asynchronous history import waits until messages are measurable before reaching bottom ([useThreadViewportAutoScroll.test.tsx:194-223](https://github.com/assistant-ui/assistant-ui/blob/822a3b3/packages/react/src/primitives/thread/useThreadViewportAutoScroll.test.tsx#L194-L223)).
* It coalesces scroll *intent* per animation frame: cancel prior `scheduledFrameRef`, then `requestAnimationFrame(scrollToBottom)` ([useThreadViewportAutoScroll.ts:63-80](https://github.com/assistant-ui/assistant-ui/blob/822a3b3/packages/react/src/primitives/thread/useThreadViewportAutoScroll.ts#L63-L80)). This is not runtime-store event batching.

### Anchoring and rationale

* Defaults are explicit: initialized history, run starts, and thread switches all scroll bottom; `turnAnchor:"top"` instead anchors new user messages at the viewport top for focused reading ([ThreadViewport.tsx:25-72](https://github.com/assistant-ui/assistant-ui/blob/822a3b3/packages/react/src/primitives/thread/ThreadViewport.tsx#L25-L72)).
* The hook preserves a pending bottom intent through delayed measurement and cancels it on true user upward motion, avoiding a layout shift being mistaken for intent ([useThreadViewportAutoScroll.ts:84-184](https://github.com/assistant-ui/assistant-ui/blob/822a3b3/packages/react/src/primitives/thread/useThreadViewportAutoScroll.ts#L84-L184)).
* Comments worth retaining (attribute assistant-ui): **“scrollHeight equality rules out content-driven shifts being misread as user scroll-up”** and **“Let the top-anchor reserve own scrolling … to avoid a bottom-scroll race.”** ([useThreadViewportAutoScroll.ts:110-151](https://github.com/assistant-ui/assistant-ui/blob/822a3b3/packages/react/src/primitives/thread/useThreadViewportAutoScroll.ts#L110-L151)).

## What OMP should adopt

| Pattern | Source | OMP insertion point |
|---|---|---|
| Treat `load` as transcript snapshot; treat protocol `resume` without load/history as a distinct empty-history state/notice. Do not replay old deltas into the live reducer. | Zed | ACP/session-resume event controller and `useAgentSession` hydration boundary. |
| Apply historical transcript atomically, then enable normal live-event reducer; batch only live bursts (one rAF or queue drain) into one render. | Zed; assistant-ui | ACP event ingestion before React/store notification. |
| On resume/thread switch, enter an explicit `hydrating → anchored-following → user-browsing` phase; force bottom only during bounded hydration; an upward gesture is an immediate escape hatch. | Roo Code | Chat viewport controller / `useThreadViewportAutoScroll` integration. |
| Use bottom as default resume landing; for edit-regenerate, explicitly anchor the edited/latest user prompt (fallback bottom), rather than relying on incidental append behavior. | Zed; assistant-ui | Edit-resend command handler plus virtual-list `scrollToIndex`. |
| Preserve pending scroll intent across non-overflow and ResizeObserver reflow; distinguish real user scroll-up from content growth. | assistant-ui | Viewport auto-scroll hook state (`scrollHeight`, `scrollTop`, pending intent). |
| Keep virtualization indexes stable: retain full history and virtualize; coalesce display-only consecutive tool rows separately from protocol/history state. | Roo Code | Message projection layer, before virtualized render. |
