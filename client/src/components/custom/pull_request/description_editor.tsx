import type { Node as ProseMirrorNode } from '@tiptap/pm/model'

import { CodeWell, CopyCodeButton } from '@/components/custom/code_block'
import { highlightTokens, loadLanguages } from '@/components/custom/code_highlight'
import {
  Attachment01Icon,
  ArrowUp02Icon,
  CheckListIcon,
  CodeIcon,
  Delete02Icon,
  Image01Icon,
  LeftToRightListBulletIcon,
  Link01Icon,
  TextBoldIcon,
  TextItalicIcon,
  TextStrikethroughIcon,
  Heading01Icon,
  Heading02Icon,
  Heading03Icon,
  LeftToRightListNumberIcon,
  QuoteDownIcon,
  MinusSignIcon,
  ArrowUpRight01Icon,
  PencilEdit02Icon,
} from '@/components/custom/huge_icons'
import { MediaActions } from '@/components/custom/media_actions'
import {
  fittedStyle,
  INLINE_IMAGE_MAX_HEIGHT,
  useVideoSize,
} from '@/components/custom/media_layout'
import { useOpenMedia } from '@/components/custom/media_lightbox'
import { VideoPlayer } from '@/components/custom/video_message'
import { Button } from '@/components/ui/button'
import { InputGroupButton } from '@/components/ui/input-group'
import { Spinner } from '@/components/ui/spinner'
import { whenIdle } from '@/lib/preload'
import { Extension, Node, getSchema, type Editor } from '@tiptap/core'
import Code from '@tiptap/extension-code'
import CodeBlock from '@tiptap/extension-code-block'
import Image from '@tiptap/extension-image'
import Placeholder from '@tiptap/extension-placeholder'
import { TableKit } from '@tiptap/extension-table'
import TaskItem from '@tiptap/extension-task-item'
import TaskList from '@tiptap/extension-task-list'
import { Markdown, MarkdownManager } from '@tiptap/markdown'
import { DOMSerializer } from '@tiptap/pm/model'
import { Plugin, PluginKey, TextSelection } from '@tiptap/pm/state'
import { Decoration, DecorationSet } from '@tiptap/pm/view'
import {
  EditorContent,
  NodeViewContent,
  NodeViewWrapper,
  ReactNodeViewRenderer,
  useEditor,
  useEditorState,
  type NodeViewProps,
} from '@tiptap/react'
import { BubbleMenu } from '@tiptap/react/menus'
import StarterKit from '@tiptap/starter-kit'
import {
  Fragment,
  useCallback,
  useContext,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ComponentProps,
  type MouseEvent,
} from 'react'
import { createPortal, flushSync } from 'react-dom'
import { toast } from 'sonner'

import './description_editor.css'
import './issue_chip.css'
import { PrPaintedContext } from './runtime'

const uploads = new Map<string, { name: string; video: boolean }>()
const videoURL = /^(?:https?:\/\/|\/|blob:)[^\s]+\.(?:mp4|mov|webm)(?:[?#][^\s]*)?$/i
const isVideo = (url: string) =>
  videoURL.test(url) ||
  /^https:\/\/github\.com\/user-attachments\/assets\/[^\s]+$/i.test(url) ||
  uploads.get(url)?.video === true

// ProseMirror owns the media node DOM; the image itself is the keyboard and pointer target.
/* oxlint-disable jsx-a11y/prefer-tag-over-role, jsx-a11y/no-noninteractive-element-to-interactive-role */
function MediaNode({ node, selected, editor, deleteNode }: NodeViewProps) {
  const frame = useRef<HTMLDivElement>(null)
  // Clicks never select media, so this only shows when the caret arrows onto it.
  const caret = useEditorState({ editor, selector: ({ editor }) => editor.isFocused }) && selected
  const open = useOpenMedia()
  const src = String(node.attrs.src)
  const video = node.type.name === 'video'
  // A markdown video carries no dimensions, so read them from the file to size the player to it.
  const size = useVideoSize(src, video)
  const attachment = {
    id: src,
    name: node.attrs.alt || uploads.get(src)?.name || 'Attachment',
    mimeType: video ? 'video/mp4' : 'image/png',
    sizeBytes: 0,
    ...size,
    ...(node.attrs.width && node.attrs.height
      ? { width: Number(node.attrs.width), height: Number(node.attrs.height) }
      : {}),
  }
  return (
    <NodeViewWrapper
      ref={frame}
      contentEditable={false}
      // Keeps the browser's own selection off the media, which the editor would read as selecting it.
      onMouseDown={(event: MouseEvent) => event.preventDefault()}
      className={`description-media group/media relative mx-auto ${video && !size ? 'w-full' : 'w-fit'} max-w-full rounded-md ${caret ? 'ring-[1.5px] ring-primary' : ''}`}
    >
      <div className={node.attrs.uploading ? 'opacity-50' : ''}>
        {video ? (
          <VideoPlayer video={attachment} src={src} />
        ) : (
          <img
            src={src}
            alt={attachment.name}
            draggable={false}
            role='button'
            tabIndex={0}
            onKeyDown={(event) => {
              if (event.key === 'Enter' || event.key === ' ') {
                event.preventDefault()
                open({ items: [attachment], index: 0, origin: () => frame.current })
              }
            }}
            width={attachment.width}
            height={attachment.height}
            style={
              fittedStyle(attachment, INLINE_IMAGE_MAX_HEIGHT) ?? {
                maxHeight: INLINE_IMAGE_MAX_HEIGHT,
              }
            }
            className='max-w-full cursor-zoom-in rounded-md'
            onClick={() => open({ items: [attachment], index: 0, origin: () => frame.current })}
          />
        )}
      </div>
      {node.attrs.uploading && (
        <span className='absolute inset-0 grid place-items-center'>
          <Spinner aria-label='Uploading attachment' />
        </span>
      )}
      {!node.attrs.uploading && (
        <MediaActions
          src={src}
          name={attachment.name}
          video={video}
          onExpand={
            video
              ? undefined
              : () => open({ items: [attachment], index: 0, origin: () => frame.current })
          }
          onDelete={deleteNode}
        />
      )}
    </NodeViewWrapper>
  )
}
/* oxlint-enable jsx-a11y/prefer-tag-over-role, jsx-a11y/no-noninteractive-element-to-interactive-role */
const EditorImage = Image.extend({
  addAttributes() {
    return {
      ...this.parent?.(),
      uploading: { default: false, rendered: false },
    }
  },
  // With a known size, GitHub's own uploader form: the size travels with the image, so it holds its
  // space before it loads. Markdown's ![]() has nowhere to put one.
  renderMarkdown(node) {
    const { src = '', alt = '', title, width, height } = node.attrs ?? {}
    if (width && height)
      return `<img width="${width}" height="${height}" alt="${String(alt).replaceAll('"', '&quot;')}" src="${src}">`
    return title ? `![${alt}](${src} "${title}")` : `![${alt}](${src})`
  },
  addNodeView() {
    return ReactNodeViewRenderer(MediaNode, {
      stopEvent: ({ event }) => event.type !== 'dragstart',
    })
  },
})
const Video = Node.create({
  name: 'video',
  group: 'block',
  atom: true,
  draggable: true,
  addAttributes() {
    return {
      src: { default: '' },
      uploading: { default: false, rendered: false },
    }
  },
  parseHTML() {
    return [{ tag: 'video[src]' }]
  },
  renderHTML({ HTMLAttributes }) {
    return ['video', HTMLAttributes]
  },
  markdownTokenName: 'video',
  markdownTokenizer: {
    name: 'video',
    level: 'block',
    start: (source) => source.search(/^(?:https?:\/\/|\/|blob:)[^\s]+$/m),
    tokenize(source) {
      const line = source.split('\n')[0]!
      if (isVideo(line))
        return {
          type: 'video',
          raw: `${line}${source[line.length] === '\n' ? '\n' : ''}`,
          text: line,
        }
    },
  },
  parseMarkdown(token, helpers) {
    return helpers.createNode('video', { src: token.text })
  },
  renderMarkdown(node) {
    return node.attrs?.src || ''
  },
  addNodeView() {
    return ReactNodeViewRenderer(MediaNode, {
      stopEvent: ({ event }) => event.type !== 'dragstart',
    })
  },
})
function CodeNode({ node }: NodeViewProps) {
  return (
    <NodeViewWrapper>
      <CodeWell copy={<CopyCodeButton code={node.textContent} />} className='my-4'>
        <pre className='scrollbar-subtle overflow-x-auto px-3 py-2.5 text-xs leading-5'>
          <NodeViewContent<'code'> as='code' className='code-block-tokens' />
        </pre>
      </CodeWell>
    </NodeViewWrapper>
  )
}
// Patches an attachment's attributes outside undo history: upload finishing, its size arriving.
function updateMedia(editor: Editor, src: string, attrs: Record<string, unknown>) {
  if (editor.isDestroyed) return
  const tr = editor.state.tr
  editor.state.doc.descendants((node, pos) => {
    if (node.attrs.src === src) tr.setNodeMarkup(pos, undefined, { ...node.attrs, ...attrs })
  })
  editor.view.dispatch(tr.setMeta('addToHistory', false))
}

const highlightKey = new PluginKey('codeHighlight')

// Shiki colours as decorations over the editable text, from the same highlighter as rendered code blocks.
function highlightDecorations(doc: ProseMirrorNode) {
  const decorations: Decoration[] = []
  doc.descendants((node, pos) => {
    if (node.type.name !== 'codeBlock') return
    const lines = highlightTokens(node.textContent, node.attrs.language || 'text')
    let offset = pos + 1
    for (const line of lines ?? []) {
      for (const token of line) {
        const style = Object.entries(token.htmlStyle ?? {})
          .map(([name, value]) => `${name}:${value}`)
          .join(';')
        if (style)
          decorations.push(Decoration.inline(offset, offset + token.content.length, { style }))
        offset += token.content.length
      }
      offset += 1
    }
    return false
  })
  return DecorationSet.create(doc, decorations)
}

const EditorCodeBlock = CodeBlock.extend({
  addNodeView() {
    return ReactNodeViewRenderer(CodeNode)
  },
  addProseMirrorPlugins() {
    return [
      new Plugin({
        key: highlightKey,
        state: {
          init: (_, { doc }) => highlightDecorations(doc),
          apply: (tr, decorations) =>
            tr.docChanged || tr.getMeta(highlightKey) ? highlightDecorations(tr.doc) : decorations,
        },
        props: {
          decorations: (state) => highlightKey.getState(state),
        },
        // Languages load on first sight; redraw once they arrive.
        view: (view) => {
          function load() {
            const langs = new Set<string>()
            view.state.doc.descendants((node) => {
              if (node.type.name === 'codeBlock') langs.add(node.attrs.language || 'text')
            })
            void loadLanguages([...langs])
              .then(() => {
                if (!view.isDestroyed) view.dispatch(view.state.tr.setMeta(highlightKey, true))
              })
              .catch(() => {})
          }
          load()
          return {
            update: (view, previous) => {
              if (!previous.doc.eq(view.state.doc)) load()
            },
          }
        },
      }),
    ]
  },
})

// Typing at the edge of inline code, or pressing Enter after it, writes plain text.
const InlineCode = Code.extend({ inclusive: false })

export type IssueState = 'open' | 'completed' | 'not_planned' | 'draft' | 'merged' | 'closed'
// What the editor knows about issues it may find referenced: the PR's repo, for bare #123, and the
// states of the issues the PR closes. Anything else renders as a neutral chip.
export type IssueReferences = {
  repo: string
  issues: readonly { url: string; number: number; state: IssueState; kind?: 'issue' | 'pull' }[]
}

const issueKey = new PluginKey<DecorationSet>('issueReferences')
// #123 or owner/repo#123, not mid-word, in an entity or heading marker.
const issueRef = /(?<![\w/#&])(?:([\w.-]+\/[\w.-]+))?#(\d+)\b/g

// A bare GitHub issue or PR link, whose text is the URL itself.
const issueUrl = /^https:\/\/github\.com\/([\w.-]+\/[\w.-]+)\/(issues|pull)\/(\d+)\/?(?:[?#]\S*)?$/

// GitHub turns issue references into links; here each one becomes a chip, outside code. A bare
// issue or PR link shows as the chip GitHub would print for it (#123 here, owner/repo#123 elsewhere)
// while its text stays the URL, so the markdown and a copy keep the link.
function issueDecorations(doc: ProseMirrorNode, { repo, issues }: IssueReferences) {
  const known = new Map(
    issues.map((issue) => [
      `${new URL(issue.url).pathname.split('/').slice(1, 3).join('/')}#${issue.number}`,
      issue,
    ])
  )
  // Unresolved: typed but not saved yet, a failed lookup, or a repo we can't see.
  function chip(owner: string, number: string, kind: 'issue' | 'pull', href: string) {
    const issue = known.get(`${owner}#${number}`)
    return {
      class: 'issue-chip',
      'data-kind': issue?.kind ?? kind,
      'data-state': issue?.state ?? 'unknown',
      'data-href': issue?.url ?? href,
    }
  }
  const decorations: Decoration[] = []
  doc.descendants((node, pos) => {
    if (node.type.name === 'codeBlock') return false
    if (!node.isText || node.marks.some((mark) => mark.type.name === 'code')) return
    const link = node.marks.find((mark) => mark.type.name === 'link')
    if (link) {
      const url = node.text && node.text === link.attrs.href ? issueUrl.exec(node.text) : null
      if (!url) return
      const [, owner, path, number] = url
      const attrs = chip(owner!, number!, path === 'pull' ? 'pull' : 'issue', url[0])
      const label = `${owner === repo ? '' : owner}#${number}`
      decorations.push(
        Decoration.widget(
          pos,
          () => {
            const element = document.createElement('span')
            for (const [name, value] of Object.entries(attrs)) element.setAttribute(name, value)
            element.textContent = label
            return element
          },
          { side: -1, key: `${label}:${attrs['data-kind']}:${attrs['data-state']}` }
        ),
        Decoration.inline(pos, pos + node.nodeSize, { class: 'issue-chip-url' }, { url: true })
      )
      return
    }
    for (const match of node.text?.matchAll(issueRef) ?? []) {
      const owner = match[1] ?? repo
      decorations.push(
        Decoration.inline(
          pos + match.index,
          pos + match.index + match[0].length,
          chip(owner, match[2]!, 'issue', `https://github.com/${owner}/issues/${match[2]}`)
        )
      )
    }
  })
  return DecorationSet.create(doc, decorations)
}

const IssueReferenceChips = Extension.create<{ references: IssueReferences }>({
  name: 'issueReferences',
  addOptions: () => ({ references: { repo: '', issues: [] } }),
  addProseMirrorPlugins() {
    const { references } = this.options
    return [
      new Plugin({
        key: issueKey,
        state: {
          init: (_, { doc }) => issueDecorations(doc, references),
          apply: (tr, decorations) =>
            tr.docChanged ? issueDecorations(tr.doc, references) : decorations,
        },
        props: {
          decorations: (state) => issueKey.getState(state),
          // A link chip hides its URL text, and the browser deletes hidden text along with the character
          // beside it, so keys at a chip are handled here: the chip deletes whole, a neighbour on its own.
          handleKeyDown(view, event) {
            const { selection, tr } = view.state
            if (!selection.empty || (event.key !== 'Backspace' && event.key !== 'Delete'))
              return false
            const at = selection.from
            const urls =
              issueKey.getState(view.state)?.find(at - 1, at + 1, (spec) => spec.url) ?? []
            const chip = urls.find((url) => url.from === at || url.to === at)
            if (event.key === 'Backspace') {
              if (chip) view.dispatch(tr.delete(chip.from, chip.to))
              else if (urls.some((url) => url.to === at - 1)) view.dispatch(tr.delete(at - 1, at))
              else return false
            } else if (chip) view.dispatch(tr.delete(chip.to, chip.to + 1))
            else return false
            return true
          },
        },
      }),
    ]
  },
})

const keys = Extension.create({
  name: 'descriptionKeys',
  addKeyboardShortcuts() {
    const editor = this.editor
    return {
      'Mod-e': () => editor.commands.toggleCode(),
      // Shift+Enter on an empty line leaves a quote, as Enter does; elsewhere it's a line break.
      'Shift-Enter': () => {
        const { $from, empty } = editor.state.selection
        if (!empty || !editor.isActive('blockquote')) return false
        if (!$from.parent.content.size) return editor.commands.liftEmptyBlock()
        const before = $from.nodeBefore
        if (before?.type.name !== 'hardBreak' || $from.parentOffset !== $from.parent.content.size)
          return false
        return editor
          .chain()
          .deleteRange({ from: $from.pos - before.nodeSize, to: $from.pos })
          .splitBlock()
          .liftEmptyBlock()
          .run()
      },
      // A table goes whole: Backspace in one whose cells are all empty deletes it, and Backspace
      // just after one selects it (every cell, as prosemirror-tables shows it), so a second deletes it.
      Backspace: () => {
        const { $from, empty } = editor.state.selection
        if (!empty) return false
        for (let depth = $from.depth; depth > 0; depth--)
          if ($from.node(depth).type.name === 'table')
            return !$from.node(depth).textContent.trim() && editor.commands.deleteTable()
        if ($from.parentOffset) return false
        const before = $from.index($from.depth - 1)
        const table = $from.node($from.depth - 1).maybeChild(before - 1)
        if (table?.type.name !== 'table') return false
        return editor.commands.setNodeSelection($from.before() - table.nodeSize)
      },
    }
  },
})
function extensions(placeholder: string, references?: IssueReferences) {
  return [
    IssueReferenceChips.configure(references && { references }),
    StarterKit.configure({
      code: false,
      codeBlock: false,
      heading: { levels: [1, 2, 3] },
      underline: false,
      link: { openOnClick: false },
    }),
    Markdown,
    InlineCode,
    EditorCodeBlock,
    TaskList,
    TaskItem.configure({ nested: true }),
    // Without it the markdown parser drops a table outright, and the next save deletes it from GitHub.
    TableKit.configure({ table: { resizable: false } }),
    EditorImage,
    Video,
    Placeholder.configure({ placeholder }),
    keys,
  ]
}

// Browsers type a space beside inline code as a non-breaking one, which would reach GitHub as `&nbsp;`.
function markdownOf(editor: Editor) {
  return editor.getMarkdown().replaceAll('&nbsp;', ' ').replaceAll('\u00a0', ' ').trimEnd()
}

const bubbleOptions = { placement: 'top', offset: 8 } as const
const bubbleKey = new PluginKey('descriptionBubble')

// The bubble menu attaches to the page only once it shows (up to 250ms after a selection), so wait for it.
function focusWhenShown(input: HTMLInputElement | null, frames = 30) {
  if (!input || frames === 0) return
  if (input.isConnected) input.focus()
  else requestAnimationFrame(() => focusWhenShown(input, frames - 1))
}

type Slash = {
  from: number
  to: number
  query: string
  left: number
  // One of the two is set: the menu opens below the caret, or above it when the window runs out.
  top?: number
  bottom?: number
}
const slashMenuHeight = 320
function slashAt(editor: Editor): Slash | null {
  const { $from, empty } = editor.state.selection
  if (!empty || $from.parent.type.name !== 'paragraph') return null
  const match = /(?:^| )\/([^/]*)$/.exec($from.parent.textBetween(0, $from.parentOffset))
  if (!match) return null
  const coords = editor.view.coordsAtPos($from.pos)
  const below = window.innerHeight - coords.bottom - 6 >= slashMenuHeight
  return {
    from: $from.pos - match[1]!.length - 1,
    to: $from.pos,
    query: match[1]!,
    left: Math.min(coords.left, window.innerWidth - 256),
    ...(below || coords.top < slashMenuHeight
      ? { top: coords.bottom + 6 }
      : { bottom: window.innerHeight - coords.top + 6 }),
  }
}

let descriptionRenderer: ReturnType<typeof createDescriptionRenderer> | undefined
requestAnimationFrame(() => {
  requestAnimationFrame(() => {
    whenIdle(() => (descriptionRenderer ??= createDescriptionRenderer()))
  })
})
function createDescriptionRenderer() {
  const configured = extensions('Add description…')
  const schema = getSchema(configured)
  return {
    parser: new MarkdownManager({ extensions: configured }),
    schema,
    serializer: DOMSerializer.fromSchema(schema),
  }
}
const proseNodes = new Set([
  'doc',
  'text',
  'paragraph',
  'heading',
  'bulletList',
  'orderedList',
  'listItem',
  'blockquote',
  'horizontalRule',
  'hardBreak',
])
function descriptionMarkup(body: string) {
  try {
    const { parser, schema, serializer } = (descriptionRenderer ??= createDescriptionRenderer())
    const doc = schema.nodeFromJSON(parser.parse(body))
    let supported = !!doc.textContent
    doc.descendants((node) => {
      if (!proseNodes.has(node.type.name) || node.marks.some((mark) => mark.type.name === 'link'))
        supported = false
      if (node.type.name === 'paragraph' && !node.childCount) supported = false
    })
    if (!supported || issueDecorations(doc, { repo: '', issues: [] }).find().length) return
    const root = document.createElement('div')
    root.append(serializer.serializeFragment(doc.content))
    for (const paragraph of root.querySelectorAll('p')) {
      if (paragraph.lastChild && paragraph.lastChild.nodeName !== 'BR') continue
      const br = document.createElement('br')
      br.className = 'ProseMirror-trailingBreak'
      paragraph.append(br)
    }
    return root.innerHTML
  } catch {
    return undefined
  }
}

function selectionPath(node: Selection['anchorNode'], root: HTMLElement | null) {
  const path: number[] = []
  while (node && node !== root) {
    const parent = node.parentNode
    if (!parent) return
    path.unshift(Array.prototype.indexOf.call(parent.childNodes, node))
    node = parent
  }
  return node === root ? path : undefined
}

export function DeferredMarkdownEditor({
  deferUntilFocus = false,
  ...props
}: ComponentProps<typeof MarkdownEditor> & { deferUntilFocus?: boolean }) {
  const painted = useContext(PrPaintedContext)
  const [ready, setReady] = useState(false)
  const host = useRef<HTMLDivElement>(null)
  const pointer = useRef(false)
  const releasePointer = useRef<(() => void) | undefined>(undefined)
  useEffect(() => () => releasePointer.current?.(), [])
  const editorRef = useRef<Editor>(null)
  const receiveEditor = useCallback((editor: Editor) => {
    editorRef.current = editor
  }, [])
  if (props.quote && !ready) setReady(true)
  const markup = useMemo(() => {
    if (ready || (painted && !deferUntilFocus && !pointer.current) || props.quote) return
    if (props.onSubmit && !props.initial)
      return `<p${props.disabled ? '' : ` data-placeholder="${props.placeholder.replaceAll('&', '&amp;').replaceAll('"', '&quot;')}" class="is-empty is-editor-empty"`}><br class="ProseMirror-trailingBreak"></p>`
    return descriptionMarkup(props.initial)
  }, [
    ready,
    painted,
    deferUntilFocus,
    props.initial,
    props.onSubmit,
    props.disabled,
    props.placeholder,
    props.quote,
  ])
  const mounted = ready || markup === undefined
  function activate(focus: boolean) {
    if (mounted) return
    const root = host.current?.querySelector<HTMLElement>('.description-document') ?? null
    const selection = window.getSelection()
    const anchor = selectionPath(selection?.anchorNode ?? null, root)
    const head = selectionPath(selection?.focusNode ?? null, root)
    const offsets = selection && [selection.anchorOffset, selection.focusOffset]
    flushSync(() => setReady(true))
    const editor = editorRef.current
    if (!editor) return
    if (anchor && head && offsets) {
      const positions = [anchor, head].map((path, index) => {
        let node: Selection['anchorNode'] = editor.view.dom
        for (const child of path) node = node?.childNodes[child] ?? null
        return node ? editor.view.posAtDOM(node, offsets[index]!) : 1
      })
      editor.view.dispatch(
        editor.state.tr.setSelection(
          TextSelection.create(editor.state.doc, positions[0]!, positions[1]!)
        )
      )
    }
    if (focus) editor.view.focus()
  }
  if (mounted) return <MarkdownEditor {...props} onReady={receiveEditor} />
  return (
    <div
      ref={host}
      data-description-editor={props.onSubmit ? undefined : ''}
      data-saved-markdown={props.initial}
      className={props.onSubmit ? 'flex items-end gap-2' : undefined}
      onFocusCapture={(event) => {
        if (!pointer.current && (event.target as HTMLElement).closest('.description-document'))
          activate(true)
      }}
      onPointerDownCapture={(event) => {
        if (!(event.target as HTMLElement).closest('.description-document')) return
        pointer.current = true
        releasePointer.current?.()
        const release = () => {
          pointer.current = false
          queueMicrotask(() => activate(true))
        }
        const end = event.pointerType === 'mouse' ? 'mouseup' : 'pointerup'
        document.addEventListener(end, release, { once: true })
        releasePointer.current = () => document.removeEventListener(end, release)
      }}
      onPointerCancel={() => {
        pointer.current = false
        activate(false)
      }}
      onKeyDownCapture={() => activate(true)}
      onDragEnterCapture={() => activate(false)}
    >
      <div className={props.onSubmit ? 'min-w-0 flex-1 py-0.5' : undefined}>
        <div
          contentEditable={!props.disabled}
          suppressContentEditableWarning
          translate='no'
          className='tiptap ProseMirror description-document text-sm leading-relaxed'
          // Match ProseMirror's contenteditable accessibility semantics.
          // oxlint-disable-next-line jsx-a11y/prefer-tag-over-role
          role='textbox'
          aria-label={props.label}
          aria-multiline='true'
          spellCheck={false}
          tabIndex={0}
          dangerouslySetInnerHTML={{ __html: markup }}
        />
      </div>
      {props.attachSlot &&
        createPortal(
          <Button
            variant='ghost'
            size='icon-xs'
            className='-my-1 text-muted-foreground opacity-0 group-focus-within/description:opacity-100 group-hover/description:opacity-100 focus-visible:opacity-100'
            disabled={props.disabled || !props.onUpload}
            aria-label='Attach image or video'
            title='Attach image or video'
            onClick={() => {
              activate(false)
              props.attachSlot
                ?.closest('section')
                ?.querySelector<HTMLButtonElement>('[aria-label="Attach image or video"]')
                ?.click()
            }}
          >
            <Attachment01Icon />
          </Button>,
          props.attachSlot
        )}
      {props.onSubmit && (
        <ComposerActions
          disabled={!!props.disabled}
          upload={!!props.onUpload}
          empty
          pickFiles={() => {
            const parent = host.current?.parentElement
            activate(false)
            parent
              ?.querySelector<HTMLButtonElement>('[aria-label="Attach image or video"]')
              ?.click()
          }}
          submit={() => {}}
        />
      )}
    </div>
  )
}

export function DescriptionEditor({
  disabled = false,
  identity,
  onSave,
  onUpload,
  body,
  references,
  attachSlot,
}: {
  identity: string
  disabled?: boolean
  onSave?: (markdown: string) => void | Promise<boolean>
  onUpload?: UploadAttachment
  body: string
  references?: IssueReferences
  attachSlot?: HTMLElement | null
}) {
  return (
    <DeferredMarkdownEditor
      key={identity}
      disabled={disabled}
      initial={body}
      label='Pull request description'
      placeholder='Add description…'
      onSave={onSave}
      onUpload={onUpload}
      references={references}
      attachSlot={attachSlot}
    />
  )
}

// GitHub-flavoured markdown, edited in place. With onSave it autosaves (a description); with onSubmit
// it's a composer that posts on ⌘↵ or the send button and clears (a comment).
export type UploadedAttachment = { src: string; width?: number; height?: number }
export type UploadAttachment = (file: File) => Promise<UploadedAttachment>

function ComposerActions({
  disabled,
  upload,
  empty,
  pickFiles,
  submit,
}: {
  disabled: boolean
  upload: boolean
  empty: boolean | null
  pickFiles: () => void
  submit: () => void
}) {
  return (
    <div className='flex shrink-0 items-center gap-1'>
      <Button
        variant='ghost'
        size='icon'
        className='text-muted-foreground'
        disabled={disabled || !upload}
        aria-label='Attach image or video'
        onClick={pickFiles}
      >
        <Attachment01Icon />
      </Button>
      <InputGroupButton
        variant='default'
        size='icon-sm'
        aria-label='Comment (⌘↵)'
        disabled={empty ?? true}
        onClick={submit}
      >
        <ArrowUp02Icon />
      </InputGroupButton>
    </div>
  )
}

// The slash menu uses ARIA options while ProseMirror retains keyboard focus in the editor.
/* oxlint-disable jsx-a11y/prefer-tag-over-role */
export function MarkdownEditor({
  disabled = false,
  initial,
  label,
  placeholder,
  onSave,
  onSubmit,
  onUpload,
  references,
  quote,
  attachSlot,
  onReady,
}: {
  initial: string
  disabled?: boolean
  label: string
  placeholder: string
  onSave?: (markdown: string) => void | Promise<boolean>
  onSubmit?: (markdown: string) => void | Promise<boolean>
  onUpload?: UploadAttachment
  references?: IssueReferences
  // Markdown to append and focus, as Quote reply does; a new id appends again.
  quote?: { markdown: string; id: number }
  attachSlot?: HTMLElement | null
  onReady?: (editor: Editor) => void
}) {
  const [saved, setSaved] = useState(initial)
  const callbacks = useRef({ onSave, onSubmit, onUpload })
  useEffect(() => {
    callbacks.current = { onSave, onSubmit, onUpload }
  })
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined)
  const pendingUploads = useRef(new Set<string>())
  const input = useRef<HTMLInputElement>(null)
  // The paperclip appends to the end, like GitHub's attach; the slash item inserts at the caret.
  const appendNext = useRef(false)
  function pickFiles() {
    appendNext.current = true
    input.current?.click()
  }
  const [slash, setSlash] = useState<Slash | null>(null)
  const [active, setActive] = useState(0)
  const menu = useRef<HTMLDivElement>(null)
  useEffect(() => {
    menu.current?.querySelector('[data-selected=true]')?.scrollIntoView({ block: 'nearest' })
  }, [active, slash])
  const dismissed = useRef<number | null>(null)
  // The link field replaces the selection toolbar; while it has focus the editor doesn't, so the menu
  // reads this to stay open.
  const [link, setLink] = useState<string | null>(null)
  const linking = useRef(false)
  const bubble = useRef<HTMLDivElement>(null)
  // Stable, or the menu re-registers on every render and drops what it's showing.
  const showBubble = useCallback(
    ({ editor, state }: { editor: Editor; state: Editor['state'] }) =>
      (linking.current || editor.isFocused) &&
      !editor.isActive('image') &&
      !editor.isActive('video') &&
      (state.selection.empty
        ? editor.isActive('link')
        : !!state.doc.textBetween(state.selection.from, state.selection.to)),
    []
  )
  function openLink(href: string) {
    linking.current = true
    setLink(href)
  }
  function closeLink() {
    linking.current = false
    setLink(null)
  }
  const menuKey = useRef<(event: KeyboardEvent) => boolean>(() => false)
  const linkKey = useRef(() => {})
  const submitKey = useRef(() => {})
  // What the editor wrote for the body as loaded, so a save happens only after a real edit: re-serialising
  // can normalise a body (GitHub's \r\n line endings, spacing) without anyone changing it.
  const unchanged = useRef<string>(null)
  const dirty = useRef(false)
  function save(editor: Editor) {
    clearTimeout(timer.current)
    if (disabled || pendingUploads.current.size) return
    const markdown = markdownOf(editor)
    if (markdown === unchanged.current) return
    const previous = unchanged.current
    unchanged.current = markdown
    const saving = callbacks.current.onSave?.(markdown)
    if (saving instanceof Promise)
      void saving.then((ok) => {
        if (editor.isDestroyed || unchanged.current !== markdown) return
        if (ok) dirty.current = markdownOf(editor) !== markdown
        else unchanged.current = previous
      })
    setSaved(markdown)
  }
  function updateMenu(editor: Editor) {
    const next = slashAt(editor)
    if (!next) dismissed.current = null
    setSlash(next?.from === dismissed.current ? null : next)
    setActive(0)
  }
  function attach(editor: Editor, files: File[], position?: number) {
    const upload = callbacks.current.onUpload
    if (!upload) return
    if (position !== undefined) editor.commands.setTextSelection(position)
    for (const file of files) {
      const video = /\.(mp4|mov|webm)$/i.test(file.name)
      if (!/\.(png|jpe?g|gif|webp|svg|mp4|mov|webm)$/i.test(file.name)) {
        toast.error('Choose a PNG, JPG, GIF, WebP, SVG, MP4, MOV or WebM file.')
        continue
      }
      if (file.size > (video ? 100 : 10) * 1024 * 1024) {
        toast.error(`${video ? 'Videos' : 'Images'} must be ${video ? 100 : 10}MB or smaller.`)
        continue
      }
      const src = URL.createObjectURL(file)
      pendingUploads.current.add(src)
      uploads.set(src, { name: file.name, video })
      if (!video)
        void createImageBitmap(file)
          .then(({ width, height }) => updateMedia(editor, src, { width, height }))
          .catch(() => {})
      editor
        .chain()
        .insertContent({
          type: video ? 'video' : 'image',
          attrs: { src, alt: file.name, uploading: true },
        })
        // Leave the caret after the attachment, not selecting it, so typing never replaces it.
        .command(({ tr, state }) => {
          const after = tr.selection.to
          if (!tr.doc.resolve(after).nodeAfter)
            tr.insert(after, state.schema.nodes.paragraph!.create())
          tr.setSelection(TextSelection.near(tr.doc.resolve(after), 1))
          return true
        })
        .run()
      editor.view.focus()
      void upload(file)
        .then((attachment) => {
          if (attachment.src.startsWith('blob:'))
            throw new Error('Upload must return a persistent URL.')
          uploads.set(attachment.src, { name: file.name, video })
          if (!editor.isDestroyed) updateMedia(editor, src, { ...attachment, uploading: false })
        })
        .catch((error: unknown) => {
          toast.error(error instanceof Error ? error.message : 'Attachment upload failed.')
          if (!editor.isDestroyed) {
            editor.state.doc.descendants((node, pos) => {
              if (node.attrs.src === src)
                editor.commands.deleteRange({ from: pos, to: pos + node.nodeSize })
            })
          }
        })
        .finally(() => {
          pendingUploads.current.delete(src)
          uploads.delete(src)
          URL.revokeObjectURL(src)
          if (!editor.isDestroyed) save(editor)
        })
    }
  }
  const editor = useEditor({
    editable: !disabled,
    extensions: extensions(placeholder, references),
    content: saved,
    contentType: 'markdown',
    editorProps: {
      attributes: {
        class: 'description-document text-sm leading-relaxed',
        role: 'textbox',
        'aria-label': label,
        'aria-multiline': 'true',
        spellcheck: 'false',
      },
      handleKeyDown(view, event) {
        if (menuKey.current(event)) return true
        if ((event.metaKey || event.ctrlKey) && event.key === 'k' && !view.state.selection.empty) {
          event.preventDefault()
          linkKey.current()
          return true
        }
        if (
          callbacks.current.onSubmit &&
          (event.metaKey || event.ctrlKey) &&
          event.key === 'Enter'
        ) {
          event.preventDefault()
          submitKey.current()
          return true
        }
        if (event.key === 'Escape') {
          ;(view.dom as HTMLElement).blur()
          return true
        }
        return false
      },
      handlePaste(_view, event) {
        if (!editor) return false
        const files = Array.from(event.clipboardData?.files ?? [])
        if (files.length) {
          attach(editor, files)
          return true
        }
        const url = event.clipboardData?.getData('text/plain').trim() || ''
        if (/^https?:\/\/\S+$/.test(url) && !editor.state.selection.empty) {
          editor.chain().setLink({ href: url }).run()
          return true
        }
        if (isVideo(url)) {
          editor
            .chain()
            .insertContent({ type: 'video', attrs: { src: url } })
            .run()
          return true
        }
        return false
      },
      // A click on a link or issue chip follows it. ProseMirror only calls this for a click, so a drag
      // still selects; their text stays editable from the keyboard or beside them.
      handleClick(view, pos, event) {
        if (event.shiftKey || event.altKey) return false
        const href =
          (event.target as HTMLElement).closest('.issue-chip')?.getAttribute('data-href') ??
          view.state.doc.nodeAt(pos)?.marks.find((mark) => mark.type.name === 'link')?.attrs.href
        if (!href) return false
        window.open(href, '_blank', 'noopener')
        return true
      },
      handleDrop(view, event, _slice, moved) {
        const files = Array.from(event.dataTransfer?.files ?? [])
        if (!editor || moved || !files.length) return false
        event.preventDefault()
        attach(editor, files, view.posAtCoords({ left: event.clientX, top: event.clientY })?.pos)
        return true
      },
    },
    onUpdate({ editor }) {
      dirty.current = true
      clearTimeout(timer.current)
      timer.current = setTimeout(() => save(editor), 800)
      updateMenu(editor)
    },
    onSelectionUpdate({ editor }) {
      updateMenu(editor)
    },
    onBlur({ editor, event }) {
      save(editor)
      setSlash(null)
      // The menu skips one hide after any press inside it, so a toolbar click would leave it stuck open.
      if (
        !linking.current &&
        !bubble.current?.contains(event.relatedTarget as globalThis.Node | null)
      )
        editor.view.dispatch(editor.state.tr.setMeta(bubbleKey, 'hide'))
    },
  })
  const loaded = useRef(initial)
  useLayoutEffect(() => {
    if (!editor) return
    unchanged.current ??= markdownOf(editor)
    onReady?.(editor)
  }, [editor, onReady])
  useEffect(() => {
    if (!editor || loaded.current === initial || onSubmit) return
    const clean =
      !dirty.current &&
      markdownOf(editor) === unchanged.current &&
      pendingUploads.current.size === 0
    loaded.current = initial
    if (!clean) return
    editor.commands.setContent(initial, { contentType: 'markdown', emitUpdate: false })
    unchanged.current = markdownOf(editor)
    setSaved(initial)
  }, [editor, initial, onSubmit])
  useEffect(() => {
    editor?.setEditable(!disabled)
  }, [editor, disabled])
  const marks = useEditorState({
    editor,
    selector: ({ editor }) => ({
      bold: editor.isActive('bold'),
      italic: editor.isActive('italic'),
      strike: editor.isActive('strike'),
      code: editor.isActive('code'),
      link: editor.isActive('link'),
      href: editor.getAttributes('link').href as string | undefined,
      caret: editor.state.selection.empty,
    }),
  })
  useEffect(
    () => () => {
      clearTimeout(timer.current)
      if (!editor || editor.isDestroyed || pendingUploads.current.size) return
      const markdown = markdownOf(editor)
      if (markdown !== unchanged.current) callbacks.current.onSave?.(markdown)
    },
    [editor]
  )
  useEffect(() => {
    if (!editor) return
    menuKey.current = (event) => {
      if (!slash) return false
      if (event.key === 'Escape') {
        dismissed.current = slash.from
        setSlash(null)
        return true
      }
      if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
        setActive((value) =>
          commands.length
            ? (value + (event.key === 'ArrowDown' ? 1 : -1) + commands.length) % commands.length
            : 0
        )
        return true
      }
      if (event.key === 'Enter' && commands.length) {
        choose(active)
        return true
      }
      return false
    }
    linkKey.current = () => openLink(editor.getAttributes('link').href || '')
    submitKey.current = submit
  })
  useEffect(() => {
    if (!editor || !quote) return
    editor
      .chain()
      .focus('end')
      .insertContent(quote.markdown, { contentType: 'markdown' })
      // Answer below the quote: make sure it ends on an empty paragraph to type into.
      .command(({ tr, state }) => {
        const last = tr.doc.lastChild
        if (last?.type.name !== 'paragraph' || last.content.size)
          tr.insert(tr.doc.content.size, state.schema.nodes.paragraph!.create())
        return true
      })
      .focus('end')
      .run()
  }, [editor, quote])
  // Whitespace alone isn't a comment: the same check gates the send button and ⌘↵.
  const empty = useEditorState({
    editor,
    selector: ({ editor }) =>
      !!onSubmit && (disabled || pendingUploads.current.size > 0 || !markdownOf(editor).trim()),
  })
  function submit() {
    if (!editor) return
    const markdown = markdownOf(editor)
    if (disabled || pendingUploads.current.size || !markdown.trim()) return
    if (/\]\(blob:|src=["']blob:/i.test(markdown)) {
      toast.error("Couldn't post comment", { description: 'Finish uploading attachments first.' })
      return
    }
    const submitted = callbacks.current.onSubmit?.(markdown)
    editor.commands.clearContent(true)
    if (submitted instanceof Promise)
      void submitted.then((ok) => {
        if (!ok && !editor.isDestroyed)
          editor.commands.insertContentAt(0, markdown + '\n\n', { contentType: 'markdown' })
      })
  }
  if (!editor) return null
  const commands = [
    ...([1, 2, 3] as const).map((level) => ({
      label: `Heading ${level}`,
      group: 'text',
      icon: [Heading01Icon, Heading02Icon, Heading03Icon][level - 1]!,
      shortcut: `⌘⌥${level}`,
      run: () => editor.commands.toggleHeading({ level }),
    })),
    {
      label: 'Bulleted list',
      group: 'lists',
      icon: LeftToRightListBulletIcon,
      shortcut: '⌘⇧8',
      run: () => editor.commands.toggleBulletList(),
    },
    {
      label: 'Numbered list',
      group: 'lists',
      icon: LeftToRightListNumberIcon,
      shortcut: '⌘⇧7',
      run: () => editor.commands.toggleOrderedList(),
    },
    {
      label: 'Checklist',
      group: 'lists',
      icon: CheckListIcon,
      shortcut: '⌘⇧9',
      run: () => editor.commands.toggleTaskList(),
    },
    {
      label: 'Image or video',
      group: 'media',
      icon: Image01Icon,
      shortcut: '',
      run: () => {
        appendNext.current = false
        input.current?.click()
      },
    },
    {
      label: 'Code block',
      group: 'blocks',
      icon: CodeIcon,
      shortcut: '⌘⌥C',
      run: () => editor.commands.toggleCodeBlock(),
    },
    {
      label: 'Quote',
      group: 'blocks',
      icon: QuoteDownIcon,
      shortcut: '⌘⇧B',
      run: () => editor.commands.toggleBlockquote(),
    },
    {
      label: 'Divider',
      group: 'blocks',
      icon: MinusSignIcon,
      shortcut: '',
      run: () => editor.commands.setHorizontalRule(),
    },
  ].filter((command) => command.label.toLowerCase().includes(slash?.query.toLowerCase() ?? ''))
  function choose(index: number) {
    if (disabled || !slash || !commands[index]) return
    editor.chain().focus().deleteRange({ from: slash.from, to: slash.to }).run()
    commands[index].run()
    setSlash(null)
  }
  return (
    <div
      data-description-editor={onSubmit ? undefined : ''}
      data-saved-markdown={saved}
      className={onSubmit ? 'flex items-end gap-2' : undefined}
    >
      <EditorContent editor={editor} className={onSubmit ? 'min-w-0 flex-1 py-0.5' : undefined} />
      <BubbleMenu
        ref={bubble}
        pluginKey={bubbleKey}
        editor={editor}
        options={bubbleOptions}
        shouldShow={showBubble}
      >
        {link !== null ? (
          <form
            className='flex w-64 items-center gap-0.5 rounded-sm bg-popover p-0.5 pl-2 text-popover-foreground shadow-md ring-1 ring-border'
            onSubmit={(event) => {
              event.preventDefault()
              const href = link.trim()
              closeLink()
              const chain = editor.chain().focus().extendMarkRange('link')
              if (!href) chain.unsetLink().run()
              else
                chain
                  .setLink({ href: /^[a-z][\w+.-]*:/i.test(href) ? href : `https://${href}` })
                  .run()
            }}
          >
            <input
              ref={(input) => focusWhenShown(input)}
              disabled={disabled}
              aria-label='Link URL'
              placeholder='Enter link URL'
              value={link}
              onChange={(event) => setLink(event.target.value)}
              onKeyDown={(event) => {
                if (event.key !== 'Escape') return
                event.preventDefault()
                closeLink()
                editor.commands.focus()
              }}
              onBlur={(event) => {
                if (!event.currentTarget.form?.contains(event.relatedTarget)) closeLink()
              }}
              className='h-6 min-w-0 flex-1 bg-transparent text-xs outline-none placeholder:text-muted-foreground'
            />
            {marks?.link && (
              <>
                <span aria-hidden className='mx-0.5 h-4 w-px bg-border' />
                <Button
                  variant='ghost'
                  size='icon-sm'
                  className='rounded-menu-item'
                  aria-label='Open link'
                  render={
                    <a
                      href={editor.getAttributes('link').href}
                      target='_blank'
                      rel='noreferrer'
                      aria-label='Open link'
                    />
                  }
                >
                  <ArrowUpRight01Icon />
                </Button>
                <Button
                  variant='ghost'
                  size='icon-sm'
                  className='rounded-menu-item'
                  disabled={disabled}
                  aria-label='Remove link'
                  onClick={() => {
                    closeLink()
                    editor.chain().focus().extendMarkRange('link').unsetLink().run()
                  }}
                >
                  <Delete02Icon />
                </Button>
              </>
            )}
          </form>
        ) : marks?.caret && marks.href ? (
          <div
            role='presentation'
            className='flex max-w-80 items-center gap-0.5 rounded-sm bg-popover p-0.5 pl-2 text-popover-foreground shadow-md ring-1 ring-border'
            onMouseDown={(event) => event.preventDefault()}
          >
            <a
              href={marks.href}
              target='_blank'
              rel='noreferrer'
              className='min-w-0 truncate text-xs text-muted-foreground hover:text-foreground'
            >
              {marks.href}
            </a>
            <span aria-hidden className='mx-0.5 h-4 w-px shrink-0 bg-border' />
            <Button
              variant='ghost'
              size='icon-sm'
              className='rounded-menu-item'
              disabled={disabled}
              aria-label='Edit link'
              onClick={() => openLink(marks.href ?? '')}
            >
              <PencilEdit02Icon />
            </Button>
            <Button
              variant='ghost'
              size='icon-sm'
              className='rounded-menu-item'
              disabled={disabled}
              aria-label='Remove link'
              onClick={() => editor.chain().extendMarkRange('link').unsetLink().run()}
            >
              <Delete02Icon />
            </Button>
          </div>
        ) : (
          <div
            role='toolbar'
            tabIndex={-1}
            aria-label='Description formatting'
            className='flex items-center gap-0.5 rounded-sm bg-popover p-0.5 text-popover-foreground shadow-md ring-1 ring-border'
            onMouseDown={(event) => event.preventDefault()}
          >
            {[
              {
                label: 'Bold',
                mark: 'bold',
                icon: TextBoldIcon,
                run: () => editor.chain().toggleBold().run(),
              },
              {
                label: 'Italic',
                mark: 'italic',
                icon: TextItalicIcon,
                run: () => editor.chain().toggleItalic().run(),
              },
              {
                label: 'Strikethrough',
                mark: 'strike',
                icon: TextStrikethroughIcon,
                run: () => editor.chain().toggleStrike().run(),
              },
              {
                label: 'Inline code',
                mark: 'code',
                icon: CodeIcon,
                run: () => editor.chain().toggleCode().run(),
              },
              {
                label: 'Link',
                mark: 'link',
                icon: Link01Icon,
                run: () => linkKey.current(),
              },
            ].map(({ label, mark, icon: Icon, run }) => (
              <Button
                disabled={disabled}
                key={mark}
                variant='ghost'
                size='icon-sm'
                className='rounded-menu-item'
                aria-label={label}
                aria-pressed={marks?.[mark as keyof NonNullable<typeof marks>] === true}
                onClick={run}
              >
                <Icon />
              </Button>
            ))}
          </div>
        )}
      </BubbleMenu>
      {slash &&
        createPortal(
          <div
            ref={menu}
            role='presentation'
            className='fixed z-50 w-52 rounded-sm bg-popover p-1 text-popover-foreground shadow-md ring-1 ring-border'
            style={{ left: slash.left, top: slash.top, bottom: slash.bottom }}
            onMouseDown={(event) => event.preventDefault()}
          >
            <div
              role='listbox'
              aria-label='Description blocks'
              className='no-scrollbar overflow-y-auto'
              style={{ maxHeight: slashMenuHeight }}
            >
              {commands.map(({ label, group, icon: Icon, shortcut }, index) => (
                <Fragment key={label}>
                  {index > 0 && group !== commands[index - 1]!.group && (
                    <div
                      role='separator'
                      aria-label='Block group'
                      className='-mx-1 my-1 h-px bg-border'
                    />
                  )}
                  <div
                    role='option'
                    tabIndex={-1}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter' || event.key === ' ') {
                        event.preventDefault()
                        choose(index)
                      }
                    }}
                    aria-selected={index === active}
                    data-selected={index === active}
                    className='flex h-menu-item-compact cursor-pointer items-center gap-2 rounded-menu-item px-2 text-xs select-none data-[selected=true]:bg-accent data-[selected=true]:text-accent-foreground [&_svg]:size-3 [&_svg]:shrink-0'
                    onMouseMove={() => setActive(index)}
                    onClick={() => choose(index)}
                  >
                    <Icon />
                    {label}
                    {shortcut && (
                      <span className='ml-auto text-xs tracking-widest text-muted-foreground'>
                        {shortcut}
                      </span>
                    )}
                  </div>
                </Fragment>
              ))}
              {!commands.length && (
                <p className='px-2 py-1 text-xs text-muted-foreground'>No matching blocks</p>
              )}
            </div>
          </div>,
          document.body
        )}
      <input
        ref={input}
        disabled={disabled || !onUpload}
        type='file'
        multiple
        accept='.png,.jpg,.jpeg,.gif,.webp,.svg,.mp4,.mov,.webm'
        className='hidden'
        aria-label='Upload description attachments'
        onChange={(event) => {
          attach(
            editor,
            Array.from(event.target.files ?? []),
            appendNext.current ? editor.state.doc.content.size : undefined
          )
          event.target.value = ''
        }}
      />
      {/* A description's paperclip sits on its section heading, shown while the description is hovered or focused. */}
      {attachSlot &&
        createPortal(
          <Button
            variant='ghost'
            size='icon-xs'
            className='-my-1 text-muted-foreground opacity-0 group-focus-within/description:opacity-100 group-hover/description:opacity-100 focus-visible:opacity-100'
            disabled={disabled || !onUpload}
            aria-label='Attach image or video'
            title='Attach image or video'
            onClick={pickFiles}
          >
            <Attachment01Icon />
          </Button>,
          attachSlot
        )}
      {onSubmit && (
        <ComposerActions
          disabled={disabled}
          upload={!!onUpload}
          empty={empty}
          pickFiles={pickFiles}
          submit={submit}
        />
      )}
    </div>
  )
}

/* oxlint-enable jsx-a11y/prefer-tag-over-role */
