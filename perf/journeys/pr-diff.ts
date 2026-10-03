import { click, hasText, open, type Journey } from '../journey'
import { prRepo } from '../seed'
import { prTitle } from './pr-open'

const diffTab = `[...document.querySelectorAll('nav[aria-label="Pull request view"] button')].find((tab) => tab.textContent.trim() === 'Diff')`

const diffText = `[...document.querySelectorAll('[aria-label="File diffs"] diffs-container')].some((diff) => diff.getClientRects().length && diff.shadowRoot?.querySelector('pre')?.textContent.includes('findDiscount'))`

const journey: Journey = {
  name: 'pr.diff',
  case: '1',
  async setup(ctx) {
    await open(ctx, `/pull-requests/${prRepo}/1`, `${hasText(prTitle)} && ${diffTab}`)
    // Someone reads the Overview before opening the diff.
    await Bun.sleep(1000)
  },
  async act(ctx) {
    await click(ctx.page, diffTab, 'the Diff tab')
  },
  done: () => `${diffTab}?.getAttribute('aria-pressed') === 'true' && ${diffText}`,
}

export default [journey]
