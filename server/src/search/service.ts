import type { SearchInput, ThreadSearchHit, WikiSearchHit } from '@jetty/shared/bot-search'

import { SEARCH_DEFAULT_K } from '@jetty/shared/bot-search'
import { Effect } from 'effect'
import { mkdir } from 'node:fs/promises'
import { join } from 'node:path'

import type { Store } from '../store'

import { botUserName } from '../bot-home'
import { botStamp } from '../orchestrator'
import { searchFilename } from './db'
import { recall, reindex } from './lib'
import {
  searchableMessages,
  type SearchThread,
  type ThreadUpdate,
  recallThreads,
  reindexThreads,
  threadCursors,
} from './threads'

export function createSearchService(home: string, store: Store) {
  const queues = new Map<string, Promise<unknown>>()
  function serial<T>(botId: string, work: () => Promise<T>) {
    const next = (queues.get(botId) ?? Promise.resolve())
      .catch(() => {})
      .then(async () => {
        await mkdir(join(home, 'search'), { recursive: true })
        return work()
      })
    queues.set(botId, next)
    void next
      .finally(() => {
        if (queues.get(botId) === next) queues.delete(botId)
      })
      .catch(() => {})
    return next
  }
  function wiki(botId: string, wikiHome: string, input: SearchInput) {
    return serial(botId, async () => {
      const path = join(home, 'search', searchFilename(botId))
      await reindex(wikiHome, path)
      const hits = recall(path, input.query, input.k ?? SEARCH_DEFAULT_K)
      return {
        results: hits.map(
          ({ path, startLine, endLine, text, score }): WikiSearchHit => ({
            path,
            startLine,
            endLine,
            text,
            score: Math.round(score * 1000) / 1000,
          })
        ),
      }
    })
  }
  function threads(botId: string, botName: string, input: SearchInput, turnId?: string | null) {
    return serial(botId, async () => {
      const excludeMessageIds = await Effect.runPromise(store.getThreadTurnItemIds(botId, turnId))
      const path = join(home, 'search', searchFilename(botId))
      const cursors = threadCursors(path)
      const rows = await Effect.runPromise(store.listBotSearchThreads(botId))
      const scope: SearchThread[] = rows.map((row) => ({
        id: row.id,
        title: row.title,
        archived: row.archived,
        lastSeq: row.lastSeq,
      }))
      const updates: ThreadUpdate[] = []
      const user = await botUserName()
      for (const thread of scope) {
        if (cursors[thread.id]?.lastSeq === thread.lastSeq) continue
        const changed = await Effect.runPromise(
          store.getThreadSearchItems(thread.id, cursors[thread.id]?.lastSeq ?? 0)
        )
        updates.push({
          ...thread,
          lastSeq: changed.lastSeq,
          changedIds: changed.items.map((item) => item.id),
          messages: searchableMessages(changed.items, thread, botId, botName, user, botStamp),
        })
      }
      await reindexThreads(path, scope, updates)
      const hits = recallThreads(path, input.query, input.k ?? SEARCH_DEFAULT_K, excludeMessageIds)
      const byId = new Map(scope.map((thread) => [thread.id, thread]))
      return {
        results: hits.map((hit): ThreadSearchHit => {
          const thread = byId.get(hit.threadId)!
          return {
            threadId: hit.threadId,
            thread: thread.id === botId ? 'your chat' : thread.title,
            ...(thread.id === botId ? {} : { link: `jetty://threads/${thread.id}` }),
            ...(thread.archived ? { archived: true } : {}),
            messageId: hit.messageId,
            author: hit.assistant ? (thread.id === botId ? botName : thread.title) : hit.author,
            date: hit.date,
            text: hit.text,
            score: Math.round(hit.score * 1000) / 1000,
          }
        }),
      }
    })
  }
  return { wiki, threads }
}
export type SearchService = ReturnType<typeof createSearchService>
