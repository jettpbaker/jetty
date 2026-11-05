import { click, composer, hasText, open, row, waitFor, type Journey } from '../journey'

export const prTitle = 'Add discount codes'

const pull = `[...document.querySelectorAll('.thread-hover-panel button')].find((button) => button.textContent.includes(${JSON.stringify(prTitle)}))`

const journey: Journey = {
  name: 'pr.open',
  case: '1',
  async setup(ctx) {
    await open(ctx, `/threads/${ctx.fixtures.threads.diff}`, `${composer} && ${row('diff')}`)
    const at = await ctx.page.evaluate<{ x: number; y: number }>(`(() => {
      const box = (${row('diff')}).getBoundingClientRect()
      return { x: box.x + box.width / 2, y: box.y + box.height / 2 }
    })()`)
    await ctx.page.cdp('Input.dispatchMouseEvent', { type: 'mouseMoved', ...at })
    await waitFor(ctx.page, pull, 'the linked pull request in the thread preview')
  },
  async act(ctx) {
    await click(ctx.page, pull, 'the linked pull request')
  },
  done: () => `${hasText(prTitle)} && ${hasText('Activity')}`,
}

export default [journey]
