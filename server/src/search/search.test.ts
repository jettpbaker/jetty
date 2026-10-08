import type { ThreadItem } from '@jetty/shared/items'

import { Database } from 'bun:sqlite'
import { expect, test } from 'bun:test'
import { Effect } from 'effect'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

import type { EmbedClient } from './types'

import { botStamp } from '../orchestrator'
import { openTestStore } from '../store-fixture'
import { tokenize } from './bm25'
import { recall, reindex } from './lib'
import { reindexThreads, recallThreads, threadCursors, searchableMessages } from './threads'
import { l2 } from './vec'

function hashEmbedder(): EmbedClient & { docs: number } {
  const embed = (text: string) => {
    const vector = new Float32Array(32)
    for (const token of tokenize(text)) {
      let hash = 2166136261
      for (let i = 0; i < token.length; i++) hash = Math.imul(hash ^ token.charCodeAt(i), 16777619)
      vector[Math.abs(hash) % vector.length] = vector[Math.abs(hash) % vector.length]! + 1
    }
    return l2(vector)
  }
  return {
    id: 'hash-test',
    docs: 0,
    async embedDocuments(items) {
      this.docs += items.length
      return items.map((item) => embed(`${item.title}\n${item.text}`))
    },
    async embedQuery(query) {
      return embed(query)
    },
  }
}

test('reindex is incremental and skips binary files', async () => {
  await mkdir(join(import.meta.dir, '.tmp'), { recursive: true })
  const home = await mkdtemp(join(import.meta.dir, '.tmp', 'home-'))
  const db = join(home, 'recall.sqlite')
  const embedder = hashEmbedder()
  try {
    await mkdir(join(home, 'pages'), { recursive: true })
    await mkdir(join(home, 'log'), { recursive: true })
    await mkdir(join(home, 'files'), { recursive: true })
    const alpha = `---
tags: [alpha]
updated: 2026-10-01
---

# Alpha

The zephyr quartz mnemonic lives on this page. It is the only place that phrase is written down, and a later lookup should land here rather than on the neighbouring note about ordinary release checklists and staging hosts.
`
    await writeFile(join(home, 'pages/alpha.md'), alpha)
    await writeFile(
      join(home, 'pages/beta.md'),
      `# Beta

Ordinary notes about a checklist, a staging host, and a Tuesday meeting. Nothing rare is stored here.
`
    )
    await writeFile(join(home, 'log/2026-10-01.md'), `# 2026-10-01\n\n- shuffled papers\n`)
    await writeFile(join(home, 'files/note.txt'), 'A plain text export about pagination cursors.\n')
    await writeFile(
      join(home, 'files/shot.png'),
      Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00])
    )

    const first = await reindex(home, db, { embed: embedder })
    expect(first.embedded).toBe(4)
    expect(first.removed).toBe(0)
    const callsAfterFirst = embedder.docs

    const hits = await recall(db, 'where is the zephyr quartz mnemonic', 3, { embed: embedder })
    expect(hits[0]?.path).toBe('pages/alpha.md')
    expect(hits[0]?.text).toContain('zephyr quartz mnemonic')

    const second = await reindex(home, db, { embed: embedder })
    expect(second.embedded).toBe(0)
    expect(second.unchanged).toBe(4)
    expect(embedder.docs).toBe(callsAfterFirst)

    await writeFile(join(home, 'pages/alpha.md'), alpha + '\nAdded a trailing decision.\n')
    const third = await reindex(home, db, { embed: embedder })
    expect(third.embedded).toBe(1)
    expect(third.unchanged).toBe(3)

    await rm(join(home, 'pages/beta.md'))
    const fourth = await reindex(home, db, { embed: embedder })
    expect(fourth.removed).toBe(1)

    const stored = new Database(db)
    const paths = stored.query<{ path: string }, []>('SELECT path FROM files').all()
    stored.close()
    expect(paths.some((row) => row.path.endsWith('.png'))).toBe(false)
    expect(paths.some((row) => row.path === 'files/note.txt')).toBe(true)
    expect(paths.some((row) => row.path === 'pages/beta.md')).toBe(false)
  } finally {
    await rm(home, { recursive: true, force: true })
  }
})

test('thread indexing persists message ids and drops threads outside scope', async () => {
  const home = await mkdtemp('/private/tmp/jetty-search-')
  const path = join(home, 'search.sqlite')
  const embed = hashEmbedder()
  const thread = { id: 'worker', title: 'Zephyr quartz worker', archived: true, lastSeq: 1 }
  const message = {
    id: 'one',
    threadId: thread.id,
    author: thread.title,
    date: 'Thu, 8 Oct 2026, 15:41',
    createdAt: 1,
    text: 'The zephyr quartz error code is ZQ-77.',
  }
  try {
    expect(
      (await reindexThreads(path, [thread], [{ ...thread, messages: [message] }], embed)).embedded
    ).toBe(1)
    const count = embed.docs
    expect(threadCursors(path, embed.id)).toEqual({ worker: { lastSeq: 1, messageIds: ['one'] } })
    expect(
      (
        await reindexThreads(
          path,
          [thread],
          [
            {
              ...thread,
              lastSeq: 2,
              messages: [message, { ...message, id: 'two', text: 'The follow-up fixed ZQ-77.' }],
            },
          ],
          embed
        )
      ).embedded
    ).toBe(1)
    expect(embed.docs).toBe(count + 1)
    expect((await recallThreads(path, 'zephyr quartz', 5, embed))[0]?.messageId).toBe('one')
    await reindexThreads(path, [], [], embed)
    expect(await recallThreads(path, 'zephyr quartz', 5, embed)).toEqual([])
  } finally {
    await rm(home, { recursive: true, force: true })
  }
})

test('thread search excludes other bots, user threads, private notes and reports', async () => {
  const home = await mkdtemp('/private/tmp/jetty-search-scope-')
  const { store, close } = await openTestStore(home)
  try {
    for (const id of ['bot-a', 'bot-b']) {
      await Effect.runPromise(
        store.createBotRecord(
          {
            id,
            name: id,
            shape: 'circle',
            color: 'coral',
            provider: 'claude',
            model: 'sonnet',
            effort: 'medium',
            fast: false,
            projectId: null,
            permissionMode: 'auto',
          },
          join(home, id)
        )
      )
    }
    const chat = await Effect.runPromise(store.requireThread('bot-a'))
    await Effect.runPromise(store.createThread(chat.projectId, 'worker'))
    await Effect.runPromise(store.markAgentThread('worker', 'bot-a', true))
    await Effect.runPromise(store.createThread(chat.projectId, 'user-thread'))
    const scope = await Effect.runPromise(store.listBotSearchThreads('bot-a'))
    expect(scope.map((thread) => thread.id).sort()).toEqual(['bot-a', 'worker'])
    const base = { turnId: 'turn', createdAt: 1, attachments: [] }
    const items: ThreadItem[] = [
      { ...base, id: 'user', kind: 'user_message', text: 'Remember quartz' },
      { ...base, id: 'note', kind: 'assistant_message', text: 'Private quartz', private: true },
      {
        ...base,
        id: 'stream',
        kind: 'assistant_message',
        text: 'Incomplete quartz',
        streaming: true,
      },
      {
        ...base,
        id: 'report',
        kind: 'user_message',
        text: 'Reported quartz',
        reports: [{ threadId: 'worker', title: 'Worker', outcome: 'finished', seconds: 1 }],
      },
      {
        ...base,
        id: 'wake',
        kind: 'user_message',
        text: 'Wake quartz',
        from: { threadId: 'bot-a', title: 'Jetty' },
      },
      {
        ...base,
        id: 'subagent',
        kind: 'assistant_message',
        text: 'Subagent quartz',
        agentId: 'sub',
      },
    ]
    const messages = searchableMessages(
      items,
      { id: 'bot-a', title: 'Bot A', archived: false, lastSeq: 1 },
      'bot-a',
      'Bot A',
      'Jett',
      botStamp
    )
    expect(messages.map((message) => message.id)).toEqual(['user'])
    expect(messages[0]?.author).toBe('Jett')
  } finally {
    await close()
    await rm(home, { recursive: true, force: true })
  }
})
