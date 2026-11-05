import { homedir } from 'node:os'
import { dirname, join } from 'node:path'

import type { Page } from '../driver'

import { repoRoot } from '../app'

// Capture stacks need real folders for diffs and files; public images use stable example paths.
export async function sanitizeCapturePaths(page: Page, repo: string) {
  const sources: [string, string][] = [
    [repo, '~/code/storefront'],
    [join(dirname(repo), 'analytics'), '~/code/analytics'],
    [join(dirname(repo), 'home'), '~/.jetty'],
    [repoRoot, '~/code/jetty'],
  ]
  const paths = sources
    .flatMap(([source, target]): [string, string][] => [
      [source, target],
      [source.replace(homedir(), '~'), target],
      [source.replace(/^\/private\/tmp\//, '/tmp/'), target],
    ])
    .sort(([a], [b]) => b.length - a.length)
  await page.evaluate(`(() => {
    const paths = ${JSON.stringify(paths)};
    const replace = value => paths.reduce((text, [from, to]) => text.replaceAll(from, to), value);
    function sanitize(root) {
      const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
      let node;
      while (node = walker.nextNode()) {
        if (node.parentElement?.closest('script, style')) continue;
        const next = replace(node.data);
        if (next !== node.data) node.data = next;
      }
      for (const element of root.querySelectorAll('*')) {
        for (const name of ['title', 'aria-label']) {
          const value = element.getAttribute(name);
          if (value) element.setAttribute(name, replace(value));
        }
        if (element.shadowRoot) sanitize(element.shadowRoot);
      }
    }
    sanitize(document.body);
  })()`)
}
