# reasoning (ai-elements consumer — radix utility swap)

2026-07-17. Transformation engine (direct radix utility import, no golden pair). One-line: replaced the last radix package import with a local controllable-state hook.

## Changed

- `client/src/lib/use-controllable-state.ts` (NEW, ours — not vendored): a ~30-line `useControllableState<T>` hook mirroring `@radix-ui/react-use-controllable-state` semantics exactly — `prop` (when defined) takes precedence over internal state, `onChange` fires on uncontrolled updates too (via effect), the returned setter is stable and accepts value-or-updater, and the return type is `[T, Dispatch<SetStateAction<T>>]` to match radix's typing.
- `client/src/components/ai-elements/reasoning.tsx`: import swapped from `@radix-ui/react-use-controllable-state` to `@/lib/use-controllable-state`. No other logic changed; both call sites (`isOpen`/`setIsOpen`, `duration`/`setDuration`) are unchanged.
- Leftover scan clean: no `@radix-ui`/`radix-ui` imports remain in `client/src` (a single comment in the hook references the package it mirrors).

## Left alone

- The rest of `reasoning.tsx` (streaming/duration logic) is untouched.

## Behavior changes

- None expected. IMPORTANT for the design pass: the only consumer, `timeline-item.tsx`, renders `<Reasoning defaultOpen={false}>` — i.e. **uncontrolled**. The hook's controlled path (`prop` defined) is therefore not exercised anywhere in the live app; any controlled-mode subtlety is latent, not observed. If a controlled `open` is introduced later, verify precedence + `onChange` firing against this hook.

## Verify by hand

- In the timeline, a reasoning block starts collapsed, expands/collapses on click, and shows the streamed thinking; the duration label appears after streaming ends.
