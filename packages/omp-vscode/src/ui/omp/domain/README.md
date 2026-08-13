# domain/

Pure functions and value types. No React, no store, no I/O, no `window` access. Everything here is unit-testable in isolation.

## Dependency direction

    components → hooks → state → transport / domain

- A `domain/` module MUST NOT import from `components/`, `hooks/`, `state/`, or `transport/`.
- Any function here is a pure `(input) => output` mapping or a plain data type.

## Purpose

Presentation-layer formatters, ACP data-shape normalizers, and reusable value types live here so they can be reasoned about and covered by tests without spinning up React or the webview bridge.

Future modules land as later tickets need them: `parts.ts`, `diff.ts`, `ansi.ts`, `timing.ts`, `formatters/*`.
