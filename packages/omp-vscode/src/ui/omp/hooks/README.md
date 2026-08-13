# hooks/

Thin React hooks that bind components to state. Prefer selector-shaped hooks (`useX(selector)`) so components subscribe to the narrowest slice they need and re-render only when that slice changes.

## Dependency direction

    components → hooks → state → transport / domain

- A `hooks/` module MAY import from `state/`, `transport/`, and `domain/`.
- A `hooks/` module MUST NOT import from `components/`.

## Convention

Every hook is a "selector wrapper": it hides the underlying store technology (zustand, context, external subscription) so components need not know which store their data lives in, and future migrations touch this layer, not the component layer.
