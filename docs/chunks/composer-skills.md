# composer `/` skills

Type `/` in the composer to pick a Claude Code skill. The menu sits above
the caret, one row per skill: name + truncated description in muted text.
Selecting inserts `/name ` so the next send invokes the skill the same way
the CLI does.

## Discovery

`skills.list` scans the same places Claude Code does:

- `~/.claude/skills/<dir>/SKILL.md` (personal; command = directory name)
- `<project>/.claude/skills/<dir>/SKILL.md`
- `.claude/commands/*.md` (still valid; skill wins on a name clash)

Personal overrides project. `user-invocable: false` is hidden. Bundled /
plugin skills stay out of this pass.

## Snappy `/`

The client warms the list as soon as chrome lands (every project + the
user-only set) and keeps it in memory. `/` reads the cache; no request on
the keystroke.

## Composer

A `/` token (start of input or after whitespace) opens the menu. Further
typing filters. Arrows move, Enter/Tab insert, Escape dismisses. Enter
still sends when the menu is closed.
