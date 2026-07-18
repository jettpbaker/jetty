# working in this repo

jetty gets built mostly by agents, deliberately paced so Jett (the human here)
actually understands the codebase. That means:

- work happens in chunks: short design note first, then the build, then a walkthrough
  of the files worth reading. Don't start the next chunk until Jett has caught up on
  the last one.
- in walkthroughs Jett drives the questions — no quizzes; answer what's asked and go
  deep on whatever they flag as shaky.
- taste decisions — tech choices, UX, naming, API shapes — get checked with Jett
  first, every time. When in doubt, ask.
- UI rides default shadcn styles until a dedicated design pass at the end. Don't
  hand-tweak styles before then.

README.md holds the project description; `docs/chunks.md` is the persistent build
plan and status checklist — keep it current as chunks land.

## code

- Code should be clean, simple, and concise enough to be self-documenting. Comments
  are for constraints the code can't express, not for narrating what it does.
- If you need a paragraph-long comment to justify why the workaround is OK, the code
  is wrong — fix the code.
- Use `type`, not `interface`.
- Use `for...of`, not `.forEach()`.
- Factory functions over classes. Classes only for `Error` subclasses, or when a
  library demands one.
- `function` declarations for named top-level functions; arrows only for inline
  callbacks and single-expression helpers.
- Chunk design notes live in `docs/chunks/` only while a chunk is in flight. Once
  it's built and Jett has confirmed it, delete the note. The code is the docs.

## ui feel

- Performance is the #1 UX value. Interactions render synchronously from local
  state; the network is never on the critical path of a click. Thread switching
  must be instant — cached state first, catch-up patches after.
- Components come from a strict ladder: use a shadcn/ui or AI Elements component
  if one fits; else compose one from shadcn primitives; truly custom only when
  both fail, and say so in the PR/walkthrough.
- Icons are Phosphor (`@phosphor-icons/react`), never lucide. Registry components
  arrive speaking lucide — swapping their icon imports to Phosphor equivalents is
  part of adding them (lucide's `Chevron*` is Phosphor's `Caret*`). oxlint bans
  `lucide-react` imports so a missed swap fails the lint gate. Weight/stroke
  tuning waits for the design pass — plain swaps until then.

- Act on pointer-down, not click, wherever it's safe (Carmack's "act on press"):
  fixed-position controls like sidebar items, tabs, buttons, toggles. It reads as
  instantly responsive and dodges the pressed-but-slid-off miss.
- It's NOT safe for: anything inside a scrollable/draggable surface (down might be a
  scroll), drag-and-drop handles, text selection, long-press targets, double-click
  targets, and destructive or hard-to-reverse actions.
- Keyboard activation stays standard (Enter/Space per platform norms) — pointer-down
  is a pointer optimization, never an accessibility regression.
- The companion rule: prefer easy undo over confirm dialogs. Act fast, make it
  reversible — don't use a modal as a safety net for an action that could just be
  undoable.
