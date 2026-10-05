import { parseMarkdownIntoBlocks } from 'streamdown'

export type MarkdownNode = {
  type: string
  url?: string
  value?: string
  identifier?: string
  children?: MarkdownNode[]
  data?: { hName?: string; hProperties?: Record<string, string> }
}

// Calls back with each link and its URL, a reference-style link ([text][ref]) taking its
// definition's. The first definition of a label wins, as when the link renders.
export function visitLinks(tree: MarkdownNode, onLink: (node: MarkdownNode, url: string) => void) {
  const definitions = new Map<string, string>()
  function define(node: MarkdownNode) {
    const id = node.identifier?.toUpperCase()
    if (node.type === 'definition' && id && node.url && !definitions.has(id))
      definitions.set(id, node.url)
    for (const child of node.children ?? []) define(child)
  }
  function visit(node: MarkdownNode) {
    const url =
      node.type === 'link'
        ? node.url
        : node.type === 'linkReference'
          ? definitions.get(node.identifier?.toUpperCase() ?? '')
          : undefined
    if (url) onLink(node, url)
    for (const child of node.children ?? []) visit(child)
  }
  define(tree)
  visit(tree)
}

const definition =
  /^ {0,3}\[[^\]\n]+\]:[ \t]*(?:<[^>\n]*>|\S+)(?:[ \t]+(?:"[^"\n]*"|'[^'\n]*'|\([^)\n]*\)))?[ \t]*$/
const fence = /^ {0,3}(?:```|~~~)/

function definesOnly(block: string) {
  const lines = block.split('\n').filter((line) => line.trim())
  return lines.length > 0 && lines.every((line) => definition.test(line))
}

// Streamdown renders each block alone, and reference definitions sit in a block of their own, so
// a reference-style link would render as bare text. Blocks that may use one get them appended.
export function blocksWithDefinitions(markdown: string) {
  const blocks = parseMarkdownIntoBlocks(markdown)
  const definitions = blocks.filter(definesOnly)
  if (!definitions.length) return blocks
  const appended = definitions.map((block) => block.trim()).join('\n')
  return blocks.map((block) =>
    definitions.includes(block) || fence.test(block) || !block.includes('[')
      ? block
      : `${block}\n\n${appended}`
  )
}
