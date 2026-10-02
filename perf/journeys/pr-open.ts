import { click, composer, hasText, open, row, type Journey } from '../journey'

export const prTitle = 'Add discount codes'

const journey: Journey = {
  name: 'pr.open',
  case: '1',
  async setup(ctx) {
    await open(
      ctx,
      `/threads/${ctx.fixtures.threads.diff}`,
      `${composer} && ${row('diff')}?.querySelector('[data-pull-request]')`
    )
  },
  async act(ctx) {
    await click(ctx.page, `${row('diff')}.querySelector('[data-pull-request]')`, 'the PR mark')
  },
  done: () => `${hasText(prTitle)} && ${hasText('Activity')}`,
}

export default [journey]
