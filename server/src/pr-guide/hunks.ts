import type { PullRequestData } from '@jetty/shared/pull-request'

import { parseDiffFromFile, parsePatchFiles, type FileDiffMetadata, type Hunk } from '@pierre/diffs'

import type { GuideInput } from '../pr-guide'

import { pullRequestDiffFile } from '../pull-requests'

function filePatch(file: PullRequestData['files'][number]) {
  const old = file.previous_filename ?? file.filename
  return [
    `diff --git a/${old} b/${file.filename}`,
    ...(file.status === 'added'
      ? ['new file mode 100644']
      : file.status === 'removed'
        ? ['deleted file mode 100644']
        : []),
    `--- ${file.status === 'added' ? '/dev/null' : `a/${old}`}`,
    `+++ ${file.status === 'removed' ? '/dev/null' : `b/${file.filename}`}`,
    file.patch ?? '',
    '',
  ].join('\n')
}

function hunkPatch(diff: FileDiffMetadata, hunk: Hunk) {
  let patch = `${hunk.hunkSpecs?.trimEnd() ?? `@@ -${hunk.deletionStart},${hunk.deletionCount} +${hunk.additionStart},${hunk.additionCount} @@`}\n`
  function append(lines: string[], start: number, count: number, prefix: string) {
    for (const line of lines.slice(start, start + count))
      patch += `${prefix}${line}${line.endsWith('\n') ? '' : '\n\\ No newline at end of file\n'}`
  }
  for (const content of hunk.hunkContent) {
    if (content.type === 'context') {
      append(diff.deletionLines, content.deletionLineIndex, content.lines, ' ')
    } else {
      append(diff.deletionLines, content.deletionLineIndex, content.deletions, '-')
      append(diff.additionLines, content.additionLineIndex, content.additions, '+')
    }
  }
  return patch
}

export async function guideInput(repo: string, data: PullRequestData): Promise<GuideInput> {
  const files: GuideInput['files'][number][] = []
  for (const file of data.files) {
    if (file.binary) continue
    let diff: FileDiffMetadata | undefined
    if (file.patch) {
      diff = parsePatchFiles(filePatch(file))[0]?.files[0]
      if (!diff) throw new Error(`Could not parse PR patch for ${file.filename}`)
    } else if (file.patchDeferred || file.changes > 0) {
      if (!data.pull.base.sha) throw new Error('PR base SHA is missing')
      const contents = await pullRequestDiffFile({
        repo,
        baseSha: data.pull.base.sha,
        headSha: data.pull.head.sha,
        path: file.filename,
        ...(file.previous_filename ? { prevPath: file.previous_filename } : {}),
      })
      if ('unavailable' in contents)
        throw new Error(`Diff unavailable for ${file.filename}: ${contents.unavailable}`)
      diff = parseDiffFromFile(
        contents.before === null
          ? null
          : { name: file.previous_filename ?? file.filename, contents: contents.before },
        contents.after === null ? null : { name: file.filename, contents: contents.after }
      )
    }
    files.push({
      path: file.filename,
      hunks: diff?.hunks.map((hunk) => hunkPatch(diff, hunk)) ?? [],
      ...(file.generated ? { generated: true } : {}),
    })
  }
  return {
    title: data.pull.title,
    body: data.pull.body,
    commits: data.commits.map((commit) => commit.commit.message),
    files,
  }
}
