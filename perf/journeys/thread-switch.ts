import { click, composer, hasText, open, quiet, row, waitFor, type Journey } from '../journey'
import { lastText } from './thread-open'

function threadSwitch(target: keyof typeof lastText): Journey {
  return {
    name: 'thread.switch',
    case: target,
    async setup(ctx) {
      const small = hasText('Thanks, that helps.')
      await open(ctx, `/threads/${ctx.fixtures.threads.small}`, `${composer} && ${small}`)
      await click(ctx.page, row(target), `the ${target} row`)
      await waitFor(ctx.page, hasText(lastText[target]), `${target} to render`)
      // A visit long enough for the idle prefetches to start, so the switch back finds them.
      await quiet(ctx.page)
      await click(ctx.page, row('small'), 'the small row')
      await waitFor(ctx.page, `${small} && !${hasText(lastText[target])}`, 'small to render')
    },
    async act(ctx) {
      await click(ctx.page, row(target), `the ${target} row`)
    },
    done: () => hasText(lastText[target]),
  }
}

export default [threadSwitch('long'), threadSwitch('code')]
