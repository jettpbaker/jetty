import { click, composer, deleteThread, newThread, open, type Journey } from '../journey'

export const message = 'Hello from the perf lab'
// The sidebar title, the user message and the finished echo reply.
const finished = `!document.querySelector('[aria-label="Stop"]') && document.getElementById('root').textContent.split(${JSON.stringify(message)}).length >= 4`

// Sends into a fresh thread, deleted afterwards, so the fixtures never grow between iterations.
export function sendJourney(name: string, env: Record<string, string>): Journey {
  return {
    name,
    case: 'new',
    env,
    async setup(ctx) {
      const id = await newThread(ctx)
      await open(ctx, `/threads/${id}`, composer)
      await click(ctx.page, composer, 'the composer')
      await ctx.page.cdp('Input.insertText', { text: message })
      await ctx.page.evaluate(`new Promise((resolve) => setTimeout(resolve, 100))`)
    },
    async act(ctx) {
      await ctx.page.key('Enter')
    },
    done: () => finished,
    settled: () => finished,
    cleanup: deleteThread,
  }
}

// Deltas 100 ms apart, so each renders on its own and counts don't depend on timing.
export default [sendJourney('turn.send', { JETTY_ECHO_CHUNK_MS: '100' })]
