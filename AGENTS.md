# working in this repo

jetty gets built mostly by agents, deliberately paced so Jett (the human here)
actually understands the codebase. That means:

- work happens in chunks: short design note first, then the build, then a walkthrough
  of the files worth reading. Don't start the next chunk until Jett has caught up on
  the last one.
- taste decisions — tech choices, UX, naming, API shapes — get checked with Jett
  first, every time. When in doubt, ask.
- UI rides default shadcn styles until a dedicated design pass at the end. Don't
  hand-tweak styles before then.

README.md holds the project description and the progress checklist; keep the
checklist current as chunks land.

## code

- Code should be clean, simple, and concise enough to be self-documenting. Comments
  are for constraints the code can't express, not for narrating what it does.
- If you need a paragraph-long comment to justify why the workaround is OK, the code
  is wrong — fix the code.
- Chunk design notes live in `docs/chunks/` only while a chunk is in flight. Once
  it's built and Jett has confirmed it, delete the note. The code is the docs.

## ui feel

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
