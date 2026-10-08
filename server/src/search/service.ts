import type { SearchInput, ThreadSearchHit, WikiSearchHit } from '@jetty/shared/bot-search'

import { SEARCH_DEFAULT_K } from '@jetty/shared/bot-search'
import { Effect } from 'effect'

import type { Store } from '../store'
import type { SearchClient } from './client'
import type { RecallHit } from './lib'

import { botUserName } from '../bot-home'
import { botStamp } from '../orchestrator'
import {
  searchableMessages,
  type SearchThread,
  type ThreadCursor,
  type ThreadUpdate,
  type recallThreads,
} from './threads'

export function createSearchService(client: SearchClient, store: Store) {
  const queues = new Map<string, Promise<unknown>>()
  function serial<T>(botId: string, work: () => Promise<T>) {
    const next = Promise.all([
      (queues.get(botId) ?? Promise.resolve()).catch(() => {}),
      client.ready(),
    ]).then(work)
    queues.set(botId, next)
    void next
      .finally(() => {
        if (queues.get(botId) === next) queues.delete(botId)
      })
      .catch(() => {})
    return next
  }
  function wiki(botId: string, home: string, input: SearchInput) {
    return serial(botId, async () => {
      const hits = (await client.request({
        kind: 'wiki',
        botId,
        home,
        query: input.query,
        k: input.k ?? SEARCH_DEFAULT_K,
      })) as RecallHit[]
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
      const cursors = (await client.request({ kind: 'cursors', botId })) as Record<
        string,
        ThreadCursor
      >
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
        const state = await Effect.runPromise(store.getThreadState(thread.id))
        const indexed = new Set(cursors[thread.id]?.messageIds)
        updates.push({
          ...thread,
          lastSeq: state.lastSeq,
          messages: searchableMessages(state.items, thread, botId, botName, user, botStamp).filter(
            (message) => !indexed.has(message.id)
          ),
        })
      }
      const hits = (await client.request({
        kind: 'threads',
        botId,
        scope,
        updates,
        query: input.query,
        k: input.k ?? SEARCH_DEFAULT_K,
        excludeMessageIds,
      })) as Awaited<ReturnType<typeof recallThreads>>
      const authors = new Map<string, string>()
      for (const thread of scope) {
        if (thread.id === botId || !hits.some((hit) => hit.threadId === thread.id)) continue
        const state = await Effect.runPromise(store.getThreadState(thread.id))
        for (const item of state.items) {
          if (item.kind === 'assistant_message') authors.set(item.id, thread.title)
        }
      }
      return {
        results: hits.map((hit): ThreadSearchHit => {
          const thread = scope.find((thread) => thread.id === hit.threadId)!
          return {
            threadId: hit.threadId,
            thread: thread.id === botId ? 'your chat' : thread.title,
            ...(thread.id === botId ? {} : { link: `jetty://threads/${thread.id}` }),
            ...(thread.archived ? { archived: true } : {}),
            messageId: hit.messageId,
            author: authors.get(hit.messageId) ?? hit.author,
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
