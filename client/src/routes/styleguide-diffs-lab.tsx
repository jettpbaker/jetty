import type { ThreadItem } from '@jetty/shared/items'

import { DiffView, EditDiff, type DiffData } from '@/components/diff-panel'
import { ToolRow } from '@/components/tool-row'

function TreatmentLabel({ name }: { name: string }) {
  return (
    <div className='font-mono text-[10px] uppercase tracking-widest text-muted-foreground'>
      {name}
    </div>
  )
}

const EDIT_OLD = `function pathField(input: unknown, key: string): Field {
  const path = strProp(input, key)
  return path ? { kind: 'path', path } : null
}`

const EDIT_NEW = `function pathField(input: unknown, key: string): Field {
  const path = rawStr(input, key)
  if (path === null) return null
  return { kind: 'path', path }
}`

const EDIT_ITEM: Extract<ThreadItem, { kind: 'tool_call' }> = {
  id: 'edit-fixture',
  turnId: 'turn-fixture',
  createdAt: 0,
  kind: 'tool_call',
  toolName: 'Edit',
  input: {
    file_path: 'client/src/components/tool-row.tsx',
    old_string: EDIT_OLD,
    new_string: EDIT_NEW,
  },
  output: '',
  status: 'succeeded',
}

// A canned multi-file `git diff HEAD` plus a stripped lockfile, mirroring the
// { diff, truncatedPaths } shape the server returns from thread.diff.
const PANEL_DATA: DiffData = {
  diff: `diff --git a/server/src/diff.ts b/server/src/diff.ts
index 1111111..2222222 100644
--- a/server/src/diff.ts
+++ b/server/src/diff.ts
@@ -1,6 +1,9 @@
 import type { Store } from './store'

 export type ThreadDiff = { diff: string; truncatedPaths?: string[] }

-const MAX_FILE_DIFF_BYTES = 64 * 1024
+const MAX_FILE_DIFF_BYTES = 128 * 1024
+
+/** Single-file diffs past this get their hunks stripped. */
+const LOCKFILE_SUFFIX = '.lock'
diff --git a/shared/src/wire.ts b/shared/src/wire.ts
index 3333333..4444444 100644
--- a/shared/src/wire.ts
+++ b/shared/src/wire.ts
@@ -82,6 +82,10 @@ export const methods = {
     params: z.object({ threadId: z.string() }),
     result: z.null(),
   },
+  'thread.diff': {
+    params: z.object({ threadId: z.string() }),
+    result: z.object({ diff: z.string() }),
+  },
   'thread.subscribe': {
`,
  truncatedPaths: ['bun.lock'],
}

export function DiffsLab() {
  return (
    <div className='mx-auto flex max-w-5xl flex-col gap-12 p-8'>
      <h1 className='text-2xl font-semibold tracking-tight'>Diffs</h1>

      <section className='flex flex-col gap-4'>
        <TreatmentLabel name='edit tool row · click to expand' />
        <div className='max-w-2xl rounded-md border p-3'>
          <ToolRow item={EDIT_ITEM} />
        </div>
      </section>

      <section className='flex flex-col gap-4'>
        <TreatmentLabel name='edit tool row · expanded body' />
        <div className='max-w-2xl rounded-md border p-3'>
          <div className='text-sm text-foreground'>Edited</div>
          <div className='mt-1 max-h-80 overflow-auto rounded-md border'>
            <EditDiff
              filePath='client/src/components/tool-row.tsx'
              oldString={EDIT_OLD}
              newString={EDIT_NEW}
            />
          </div>
        </div>
      </section>

      <section className='flex flex-col gap-4'>
        <TreatmentLabel name='diff panel · multi-file patch + truncated lockfile' />
        <div className='h-[520px] w-[480px] overflow-auto rounded-md border'>
          <DiffView data={PANEL_DATA} />
        </div>
      </section>
    </div>
  )
}
