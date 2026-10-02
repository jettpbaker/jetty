import { click, composer, hasText, open, type Journey } from '../journey'

const journey: Journey = {
  name: 'composer.key',
  case: 'small',
  async setup(ctx) {
    await open(
      ctx,
      `/threads/${ctx.fixtures.threads.small}`,
      `${composer} && ${hasText('Thanks, that helps.')}`
    )
    await click(ctx.page, composer, 'the composer')
  },
  async act(ctx) {
    await ctx.page.key('a', 'a')
  },
  done: () => `${composer}.value === 'a'`,
}

export default [journey]
