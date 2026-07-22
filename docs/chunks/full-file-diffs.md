# full-file diffs — JET-5 fix + expandable context

Design note; build starts once Jett has reviewed. Diagnosis and repro live in
`docs/lookout-plan.md` (JET-5 section) — short version: `@pierre/diffs`
tokenizes `isPartial` patches hunk-by-hunk, so a `.vue` hunk without the
`<script>` tag in its context lines never enters the JS grammar and renders
flat. Full old/new file contents make the diff non-partial, which fixes
highlighting for every language *and* makes the "N unmodified lines" bars
expandable (`FileDiff.expandHunk` exists in the lib; it just has nothing to
expand into today).

## wire

`thread.diff` result grows a per-file shape alongside the patch:

```ts
type DiffFile = {
  path: string
  oldContents: string | null  // null = created
  newContents: string | null  // null = deleted
}
// result: { files: DiffFile[], truncatedPaths?: string[] }
```

- The unified patch goes away as the primary payload — the client renders each
  file from contents. (Keep `diff` in the result during the transition only if
  the styleguide fixtures need it; otherwise delete.)
- Truncation policy carries over, measured on contents instead of patch
  section: lockfiles by name + any file whose old+new contents exceed the
  existing 128 KB threshold → path listed in `truncatedPaths`, no contents
  shipped.

## server (`diff.ts`)

- `git diff HEAD --name-status` (still shelled out, still failure = empty) to
  get the changed-file list + status letter.
- Per file: old side = `git show HEAD:<path>` (null on A-status), new side =
  working-tree read (null on D-status). Renames (R-status) ship as
  delete + create unless pierre's rename support turns out to be free.
- Still tracked-files-only (`git diff HEAD` semantics), matching the existing
  taste note. Untracked files stay invisible — unchanged behaviour, still
  deferred. (The dummy-repo test showed untracked .vue files don't appear
  today either.)

## client (`diff-panel.tsx`)

- `PatchDiff` → `MultiFileDiff` per file, with `oldFile`/`newFile` contents —
  the same component `EditDiff` already uses, so the panel and edit rows
  converge on one rendering path.
- Wire up hunk expansion: pierre renders collapsed unmodified regions with an
  expand affordance once contents are full — confirm the react wrapper exposes
  it (`FileDiff.expandHunk(hunkIndex, direction, count)` is on the underlying
  class); if the wrapper hides it, that's a taste conversation before hacking.
- `DiffBoundary` per file stays.

## verification

- Repro repo is already set up: project `vue-dummy`
  (`scratchpad/vue-dummy`), with a mid-`<script>` hunk in `Dashboard.vue`
  that renders flat today. After the change it must highlight fully, and the
  "29 unmodified lines" bar above it must expand.
- Also eyeball a multi-file diff (UserCard/format.js round exists as a commit
  to reroll) and a large-file truncation case.

## open questions for Jett

1. Expansion UX: GitHub-style expand-up/down arrows per bar vs expand-all on
   click — whatever pierre gives free is the default; flag if it offers both.
2. Keep shipping the raw patch too (styleguide fixtures currently feed
   `PatchDiff` strings), or port fixtures to contents and drop the patch?
