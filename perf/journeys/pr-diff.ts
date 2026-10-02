import { click, hasText, open, type Journey } from '../journey'
import { prRepo } from '../seed'
import { prTitle } from './pr-open'

const diffTab = `[...document.querySelectorAll('[role=tab]')].find((tab) => tab.textContent.trim() === 'Diff')`

const journey: Journey = {
  name: 'pr.diff',
  case: '1',
  async setup(ctx) {
    await open(ctx, `/pull-requests/${prRepo}/1`, `${hasText(prTitle)} && ${diffTab}`)
  },
  async act(ctx) {
    await click(ctx.page, diffTab, 'the Diff tab')
  },
  done: () => `${diffTab}?.getAttribute('aria-selected') === 'true' && ${hasText('findDiscount')}`,
}

export default [journey]
