# transport/

Thin wrappers over the webview→host bridge (`hostCall`) and the ACP transport. This is the ONLY layer allowed to touch `../bridge.ts` from within the omp app; everything else consumes these functions.

## Dependency direction

    components → hooks → state → transport / domain

- A `transport/` module MAY import from `../bridge.ts` and from `domain/`.
- A `transport/` module MUST NOT import from `state/`, `hooks/`, or `components/`.

## Current modules

- `settings-transport.ts` — read/write display settings via `hostCall("settingsGet" | "settingsSet")`.

Future modules: `acp-events.ts` (ACP event → store patch), `sessions-transport.ts`, …
