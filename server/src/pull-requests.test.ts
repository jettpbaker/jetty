import { checkSummary, displayedRollupState } from '@jetty/shared/pull-request'
import { expect, test } from 'bun:test'

import { mapCheckRuns } from './pull-requests'

function run(overrides: Record<string, unknown> = {}) {
  return {
    __typename: 'CheckRun',
    id: '1',
    databaseId: 1,
    name: 'build',
    status: 'COMPLETED',
    conclusion: 'FAILURE',
    detailsUrl: 'https://github.com/owner/repo/runs/1',
    startedAt: '2026-01-01T00:00:00Z',
    completedAt: '2026-01-01T00:05:00Z',
    isRequired: true,
    checkSuite: {
      app: { name: 'GitHub Actions' },
      workflowRun: { event: 'pull_request', workflow: { name: 'CI' } },
    },
    ...overrides,
  }
}

function status(overrides: Record<string, unknown> = {}) {
  return {
    __typename: 'StatusContext',
    id: 's1',
    context: 'ci/jenkins',
    state: 'FAILURE',
    targetUrl: 'https://ci.example/1',
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-01T00:00:00Z',
    description: 'failed',
    isRequired: false,
    ...overrides,
  }
}

test('a failed check re-run counts as the later attempt', () => {
  const checks = mapCheckRuns([
    run(),
    run({
      id: '2',
      databaseId: 2,
      conclusion: 'SUCCESS',
      detailsUrl: 'https://github.com/owner/repo/runs/2',
      startedAt: '2026-01-01T01:00:00Z',
      completedAt: '2026-01-01T01:05:00Z',
    }),
  ])
  expect(checks.map((check) => [check.id, check.conclusion])).toEqual([['2', 'success']])
  expect(displayedRollupState(checkSummary(checks), 'FAILURE')).toBe('SUCCESS')
})

test('a cancelled attempt drops out once a later run is in progress', () => {
  const checks = mapCheckRuns([
    run({ conclusion: 'CANCELLED' }),
    run({
      id: '2',
      databaseId: 2,
      status: 'IN_PROGRESS',
      conclusion: null,
      completedAt: null,
      startedAt: '2026-01-01T01:00:00Z',
      detailsUrl: 'https://github.com/owner/repo/runs/2',
    }),
  ])
  expect(checks.map((check) => [check.id, check.status, check.conclusion])).toEqual([
    ['2', 'in_progress', null],
  ])
  expect(displayedRollupState(checkSummary(checks), 'FAILURE')).toBe('PENDING')
})

test('the same job in another workflow or on another event stays its own check', () => {
  const checks = mapCheckRuns([
    run({ conclusion: 'SUCCESS' }),
    run({
      id: 'other-workflow',
      databaseId: 3,
      conclusion: 'FAILURE',
      checkSuite: {
        app: { name: 'GitHub Actions' },
        workflowRun: { event: 'pull_request', workflow: { name: 'Release' } },
      },
    }),
    run({
      id: 'other-event',
      databaseId: 4,
      conclusion: 'SUCCESS',
      checkSuite: {
        app: { name: 'GitHub Actions' },
        workflowRun: { event: 'push', workflow: { name: 'CI' } },
      },
    }),
  ])
  expect(checks.map((check) => check.id).sort()).toEqual(['1', 'other-event', 'other-workflow'])
  expect(displayedRollupState(checkSummary(checks), 'SUCCESS')).toBe('FAILURE')
})

test('a newer commit status replaces the older one for that context', () => {
  const checks = mapCheckRuns([
    status(),
    status({
      id: 's2',
      state: 'SUCCESS',
      targetUrl: 'https://ci.example/2',
      createdAt: '2026-01-01T02:00:00Z',
      updatedAt: '2026-01-01T02:00:00Z',
      description: 'passed',
    }),
    status({
      id: 's3',
      context: 'security/scan',
      state: 'PENDING',
      targetUrl: '',
      updatedAt: '2026-01-01T03:00:00Z',
    }),
  ])
  expect(
    checks.map((check) => [check.name, check.conclusion, check.status, check.html_url])
  ).toEqual([
    ['ci/jenkins', 'success', 'completed', 'https://ci.example/2'],
    ['security/scan', null, 'queued', ''],
  ])
  expect(displayedRollupState(checkSummary(checks), 'FAILURE')).toBe('PENDING')
})

test('a short checks page still reports a failure GitHub has not cleared', () => {
  const checks = mapCheckRuns([run({ conclusion: 'SUCCESS' })])
  expect(displayedRollupState(checkSummary(checks), 'FAILURE', true)).toBe('FAILURE')
})
