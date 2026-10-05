import { branchPicked, click, composer, hasText, open, row, type Journey } from '../journey'

export const lastText = { long: 'Turn 200:', code: 'Review file 8:' } as const

function threadOpen(target: keyof typeof lastText): Journey {
  return {
    name: 'thread.open',
    case: target,
    async setup(ctx) {
      await open(
        ctx,
        `/threads/${ctx.fixtures.threads.small}`,
        `${composer} && ${hasText('Thanks, that helps.')}`
      )
    },
    async act(ctx) {
      await click(ctx.page, row(target), `the ${target} row`)
    },
    done: () => hasText(lastText[target]),
  }
}

const fromNew: Journey = {
  name: 'thread.open',
  case: 'from-new',
  async setup(ctx) {
    await open(ctx, '/', `${composer} && ${row('small')} && ${branchPicked}`)
  },
  async act(ctx) {
    await click(ctx.page, row('small'), 'the small row')
  },
  done: () => hasText('Thanks, that helps.'),
}

export default [threadOpen('long'), threadOpen('code'), fromNew]
