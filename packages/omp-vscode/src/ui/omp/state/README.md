# state/

Zustand slices, one file per domain concern. Each slice is a small store with an `immer` reducer for ACP-event-driven or user-driven mutations.

## Dependency direction (one-way, enforced by review)

    components → hooks → state → transport / domain

- A `state/` module MAY import from `transport/` and `domain/`.
- A `state/` module MUST NOT import from `components/` or `hooks/`.
- Consumers reach the store only through selector hooks in `hooks/`, never by touching `state/` directly.

## Current slices

- `settings-store.ts` — display preferences (`showImages`, …). Migrated from the former `PreferencesProvider` React Context.

Additional slices land as later tickets extract them from `useAgentSession.ts`: `session`, `transcript`, `tools`, `permissions`, `subagents`.
