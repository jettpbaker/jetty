import type { ResultOf } from '@jetty/shared/wire'

import { Effect } from 'effect'
import { useCallback, useEffect, useState } from 'react'

import { run, useAction } from './connection'

type Status = ResultOf<'containers.status'>
let cachedStatus: Status | null = null
let requested = false
const listeners = new Set<(status: Status | null) => void>()

function publish(status: Status | null) {
  cachedStatus = status
  if (!status) requested = false
  for (const listener of listeners) listener(status)
}

function readStatus(
  registry: Parameters<typeof run>[0],
  setStatus: (status: Status | null) => void
) {
  return run(
    registry,
    (connection) =>
      connection
        .request('containers.status', {})
        .pipe(Effect.tap((status) => Effect.sync(() => setStatus(status)))),
    () => setStatus(null)
  )
}

export function useContainerStatus() {
  const request = useAction(readStatus)
  const [status, setStatus] = useState<Status | null>(cachedStatus)
  const refresh = useCallback(() => request(publish), [request])
  useEffect(() => {
    listeners.add(setStatus)
    if (!requested) {
      requested = true
      refresh()
    }
    return () => {
      listeners.delete(setStatus)
    }
  }, [refresh])
  return { status, refresh }
}

function setLimits(
  registry: Parameters<typeof run>[0],
  limits: { maxRunning: number; cpus: number; memoryGiB: number },
  done: () => void,
  failed: (error: unknown) => void
) {
  return run(registry, (connection) =>
    connection.request('containers.setLimits', limits).pipe(
      Effect.tap(() => Effect.sync(done)),
      Effect.tapError((error) => Effect.sync(() => failed(error)))
    )
  )
}
export const useSetContainerLimits = () => useAction(setLimits)

function stopContainer(
  registry: Parameters<typeof run>[0],
  threadId: string,
  done: () => void,
  failed: (error: unknown) => void
) {
  return run(registry, (connection) =>
    connection.request('containers.stop', { threadId }).pipe(
      Effect.tap(() => Effect.sync(done)),
      Effect.tapError((error) => Effect.sync(() => failed(error)))
    )
  )
}
export const useStopContainer = () => useAction(stopContainer)

function setupStatus(
  registry: Parameters<typeof run>[0],
  projectId: string,
  done: (result: ResultOf<'project.containerSetupStatus'>) => void
) {
  return run(registry, (connection) =>
    connection
      .request('project.containerSetupStatus', { projectId })
      .pipe(Effect.tap((result) => Effect.sync(() => done(result))))
  )
}
export const useContainerSetupStatus = () => useAction(setupStatus)

function testProject(
  registry: Parameters<typeof run>[0],
  projectId: string,
  done: (result: ResultOf<'project.containerTest'>) => void,
  failed: () => void
) {
  return run(
    registry,
    (connection) =>
      connection
        .request('project.containerTest', { projectId })
        .pipe(Effect.tap((result) => Effect.sync(() => done(result)))),
    failed
  )
}
export const useTestProjectContainer = () => useAction(testProject)

function startDev(
  registry: Parameters<typeof run>[0],
  threadId: string,
  done: (result: ResultOf<'thread.startDev'>) => void,
  failed: () => void
) {
  return run(
    registry,
    (connection) =>
      connection
        .request('thread.startDev', { threadId })
        .pipe(Effect.tap((result) => Effect.sync(() => done(result)))),
    failed
  )
}
export const useStartContainerDev = () => useAction(startDev)
