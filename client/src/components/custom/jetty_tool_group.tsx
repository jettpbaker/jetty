import { cn } from '@/lib/utils'
import { useBot, useProject, usePullRequestSummary, useThreadMeta } from '@/state'
import { Link } from '@tanstack/react-router'
import { useMemo, useState } from 'react'

import { botColorStyle, botTextClass } from './bot_avatar'
import { JettyBot } from './jetty_bot'
import {
  CountedResults,
  Disclosure,
  EntityDetails,
  ModelRow,
  ThreadRow,
  type ThreadResult,
} from './jetty_result_rows'
import {
  jettyResultKey,
  jettyResults,
  jettyResultTools,
  type JettyResult,
} from './jetty_tool_results'
import { ProjectGlyph } from './project_glyph'
import { pullRequestFacts } from './pull_request_model'
import { linkPresentation } from './thread_pull_request'
import { StatusGlyph, type Status } from './thread_status'
import { ToolCallDetails } from './tool_call'
import { describeToolBatch, workEnded, type ToolActivity, type ToolBatch } from './work_model'

export function JettyThreadRow({ result, outcome }: { result: ThreadResult; outcome?: Status }) {
  const meta = useThreadMeta(result.id)
  return (
    <ThreadRow
      result={{
        ...result,
        title: meta?.title ?? result.title,
        status: meta?.status ?? result.status,
        archived: meta?.archived ?? result.archived,
      }}
      status={meta?.archived || result.archived ? 'archived' : outcome}
      render={<Link to='/threads/$threadId' params={{ threadId: result.id }} />}
    />
  )
}

function ThreadCallRow({ call, result }: { call: ToolActivity; result?: ThreadResult }) {
  const input: { threadId?: string; title?: string } = {}
  try {
    const value: unknown = JSON.parse(call.input ?? '{}')
    if (value && typeof value === 'object') {
      if ('threadId' in value && typeof value.threadId === 'string') input.threadId = value.threadId
      if ('title' in value && typeof value.title === 'string') input.title = value.title
    }
  } catch {
    // Some providers stream partial JSON before the tool input is complete.
  }
  const id = result?.id ?? input.threadId
  const meta = useThreadMeta(id)
  const status: Status | undefined = !workEnded(call.status)
    ? call.status === 'waiting'
      ? 'needs-attention'
      : 'working'
    : call.status === 'failed'
      ? 'error'
      : call.status === 'cancelled' || call.status === 'interrupted'
        ? 'stopped'
        : call.jettyTool === 'archive_thread' || meta?.archived
          ? 'archived'
          : undefined
  return (
    <ThreadRow
      result={{
        ...result,
        id: id ?? '',
        title:
          meta?.title ??
          result?.title ??
          input.title ??
          (call.jettyTool === 'create_thread' ? 'New thread' : 'Thread'),
        status: meta?.status ?? result?.status,
      }}
      status={status}
      placeholder={!id}
      render={id ? <Link to='/threads/$threadId' params={{ threadId: id }} /> : undefined}
    />
  )
}

function BotRow({ result }: { result: Extract<JettyResult, { kind: 'bot' }>['value'] }) {
  const bot = useBot(result.id)
  return (
    <EntityDetails
      title={
        <span
          style={bot && botColorStyle(bot.color)}
          className={cn('inline-flex items-center gap-1.5', bot ? botTextClass : 'text-foreground')}
        >
          {bot && <JettyBot size={14} color={bot.color} shape={bot.shape} />}
          {bot?.name ?? result.name}
        </span>
      }
    >
      {result.job ?? <span className='font-mono'>{result.id}</span>}
    </EntityDetails>
  )
}

function ProjectRow({ result }: { result: Extract<JettyResult, { kind: 'project' }>['value'] }) {
  const project = useProject(result.id)
  return (
    <EntityDetails
      title={
        <span className='inline-flex items-center gap-1.5 text-foreground'>
          <ProjectGlyph icon={project?.icon} className='size-3.25' />
          {project?.title ?? result.title}
        </span>
      }
    >
      <p className='font-mono'>{project?.path ?? result.path}</p>
      {result.detail && <p>{result.detail}</p>}
    </EntityDetails>
  )
}

function PullRow({
  result,
  repo,
  number,
}: {
  result: Extract<JettyResult, { kind: 'pull request' }>['value']
  repo: string
  number: number
}) {
  const summary = usePullRequestSummary({ repo, number })
  const { icon: Icon, color, label } = linkPresentation(summary && pullRequestFacts(summary))
  return (
    <EntityDetails
      title={
        <span className={cn('inline-flex items-center gap-1.5', color)}>
          <Icon className='size-3.25' />
          <span className='font-mono'>#{number}</span>
          {summary?.pull.title ?? repo}
        </span>
      }
    >
      {label} ·{' '}
      <a
        href={result.url}
        target='_blank'
        rel='noreferrer'
        className='text-primary hover:underline'
      >
        {result.linked}
      </a>
    </EntityDetails>
  )
}

const taskStatus = {
  todo: 'queued',
  in_progress: 'working',
  done: 'done',
  dropped: 'stopped',
} as const

function ResultRow({ result, tool }: { result: JettyResult; tool: string }) {
  switch (result.kind) {
    case 'thread':
      return (
        <JettyThreadRow
          result={result.value}
          outcome={
            tool === 'archive_thread' ? 'archived' : tool === 'stop_thread' ? 'stopped' : undefined
          }
        />
      )
    case 'model':
      return <ModelRow result={result.value} />
    case 'bot':
      return <BotRow result={result.value} />
    case 'project':
      return <ProjectRow result={result.value} />
    case 'task':
      return (
        <EntityDetails
          title={
            <span className='inline-flex items-center gap-1.5 text-foreground'>
              <StatusGlyph status={taskStatus[result.value.status]} className='size-3.25' />
              {result.value.title}
            </span>
          }
        >
          {result.value.note ?? <span className='font-mono'>{result.value.id}</span>}
        </EntityDetails>
      )
    case 'pull request': {
      const match = /^([^#]+)#(\d+)$/.exec(result.value.linked)
      return match ? (
        <PullRow result={result.value} repo={match[1]!} number={Number(match[2])} />
      ) : (
        <EntityDetails title={result.value.linked}>{result.value.url}</EntityDetails>
      )
    }
  }
}

export function JettyToolGroup({ batch }: { batch: ToolBatch }) {
  const tool = batch.calls[0]!.jettyTool!
  const config = jettyResultTools[tool]!
  const { parsed, results } = useMemo(() => {
    const parsed = batch.calls.map((call) => jettyResults(call, config))
    const results = [
      ...new Map(
        parsed.flatMap((rows) => rows ?? []).map((result) => [jettyResultKey(result), result])
      ).values(),
    ]
    return { parsed, results }
  }, [batch.calls, config])
  const [initialCalls] = useState(() => new Set(batch.calls.map((call) => call.id)))
  const threadAction = tool === 'create_thread' || tool === 'archive_thread'
  const unsettled = batch.calls.some((call) => !workEnded(call.status))
  const autoOpen = threadAction && (!batch.sealed || unsettled)
  const active =
    unsettled ||
    (!config.list && !batch.sealed && batch.calls.every((call) => call.status === 'complete'))
  const failed = batch.calls.every((call) => call.status === 'failed')
  const cancelled = batch.calls.every((call) => call.status === 'cancelled')
  const stopped = batch.calls.every((call) => call.status === 'interrupted')
  const verb = active
    ? config.active
    : failed
      ? `Failed to ${config.action}`
      : cancelled
        ? 'Cancelled'
        : stopped
          ? 'Stopped'
          : config.done
  const count = config.list
    ? parsed.some((rows) => rows !== undefined)
      ? results.length
      : undefined
    : active
      ? batch.calls.length
      : batch.calls.filter((call) => call.status === 'complete').length || batch.calls.length
  const notices = describeToolBatch(batch)
  return (
    <CountedResults
      verb={verb}
      count={count}
      noun={config.noun}
      active={active}
      autoOpen={autoOpen}
      noticeText={notices.noticeText}
      notice={
        notices.notices.length > 0 && (
          <span
            className={cn(
              'shrink-0 text-xs',
              notices.failed ? 'text-status-error' : 'text-muted-foreground'
            )}
          >
            {notices.notices.map((notice, index) => (
              <span key={notice.status}>
                {index > 0 && ', '}
                {notice.count} {notice.text}
              </span>
            ))}
          </span>
        )
      }
      details={
        threadAction ? (
          batch.calls.map((call, index) =>
            workEnded(call.status) &&
            (call.status !== 'complete' || parsed[index] === undefined) ? (
              <ToolCallDetails key={call.id} call={call} />
            ) : null
          )
        ) : failed ||
          cancelled ||
          stopped ||
          (!unsettled && parsed.every((rows) => rows === undefined)) ? (
          batch.calls.map((call) => <ToolCallDetails key={call.id} call={call} />)
        ) : (
          <Disclosure title='Tool details'>
            {batch.calls.map((call) => (
              <ToolCallDetails key={call.id} call={call} />
            ))}
          </Disclosure>
        )
      }
    >
      {threadAction
        ? batch.calls.map((call, index) => {
            const result = parsed[index]?.[0]
            return (
              <div
                key={call.id}
                className={cn(autoOpen && !initialCalls.has(call.id) && 'work-raise-enter')}
              >
                <ThreadCallRow
                  call={call}
                  result={result?.kind === 'thread' ? result.value : undefined}
                />
              </div>
            )
          })
        : results.map((result) => (
            <ResultRow key={jettyResultKey(result)} result={result} tool={tool} />
          ))}
      {config.list && count === 0 && !active && (
        <p className='py-1 text-13 leading-5 text-muted-foreground'>No {config.noun}s returned.</p>
      )}
    </CountedResults>
  )
}
