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
  // The native getter: React wraps the element's own value property.
  done: () =>
    `Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').get.call(${composer}) === 'a'`,
}

export default [journey]
