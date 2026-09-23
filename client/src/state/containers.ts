import type { ResultOf } from '@jetty/shared/wire'

import { Effect } from 'effect'
import { useEffect, useState } from 'react'

import { run, useAction } from './connection'

type Status = ResultOf<'containers.status'>

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
  const [status, setStatus] = useState<Status | null>(null)
  useEffect(() => {
    request(setStatus)
  }, [request])
  return { status, refresh: () => request(setStatus) }
}

function setMax(
  registry: Parameters<typeof run>[0],
  maxRunning: number,
  done: () => void,
  failed: () => void
) {
  return run(
    registry,
    (connection) =>
      connection
        .request('containers.setMax', { maxRunning })
        .pipe(Effect.tap(() => Effect.sync(done))),
    failed
  )
}
export const useSetContainerMax = () => useAction(setMax)

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
