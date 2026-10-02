import { composer, hasText, type Journey } from '../journey'

function launch(
  name: string,
  path: (fixtures: { threads: { long: string } }) => string,
  text?: string
): Journey {
  return {
    name: 'app.launch',
    case: name,
    navigates: true,
    async setup() {},
    async act(ctx) {
      await ctx.page.cdp('Page.navigate', { url: `${ctx.origin}${path(ctx.fixtures)}` })
    },
    done: () => `${composer} && !${composer}.disabled${text ? ` && ${hasText(text)}` : ''}`,
  }
}

export default [
  launch('root', () => '/'),
  launch('long', (fixtures) => `/threads/${fixtures.threads.long}`, 'Turn 200:'),
]
