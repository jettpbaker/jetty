import { composer, hasText, type Journey } from '../journey'

function launch(
  name: string,
  path: (fixtures: { threads: { long: string } }) => string,
  opts: { text?: string; settled?: string } = {}
): Journey {
  return {
    name: 'app.launch',
    case: name,
    navigates: true,
    async setup() {},
    async act(ctx) {
      await ctx.page.cdp('Page.navigate', { url: `${ctx.origin}${path(ctx.fixtures)}` })
    },
    done: () =>
      `${composer} && !${composer}.disabled${opts.text ? ` && ${hasText(opts.text)}` : ''}`,
    ...(opts.settled && { settled: () => opts.settled! }),
  }
}

export default [
  // The branch picker names its ref once the full branch list lands, which (git underneath)
  // races the quiet window; counting always includes it.
  launch('root', () => '/', { settled: `document.querySelector('[aria-label^="From: "]')` }),
  launch('long', (fixtures) => `/threads/${fixtures.threads.long}`, { text: 'Turn 200:' }),
]
