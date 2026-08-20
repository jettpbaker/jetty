/** Viewport coordinates of a textarea caret, for anchoring a popup above it. */
export function caretViewportRect(
  textarea: HTMLTextAreaElement,
  position: number
): { top: number; left: number; height: number } {
  const style = getComputedStyle(textarea)
  const mirror = document.createElement('div')
  const props = [
    'boxSizing',
    'fontFamily',
    'fontSize',
    'fontStyle',
    'fontWeight',
    'letterSpacing',
    'lineHeight',
    'paddingTop',
    'paddingRight',
    'paddingBottom',
    'paddingLeft',
    'borderTopWidth',
    'borderRightWidth',
    'borderBottomWidth',
    'borderLeftWidth',
    'textAlign',
    'textTransform',
    'textIndent',
    'whiteSpace',
    'wordBreak',
    'wordSpacing',
    'wordWrap',
  ] as const
  for (const prop of props) {
    mirror.style[prop] = style[prop]
  }
  mirror.style.position = 'absolute'
  mirror.style.visibility = 'hidden'
  mirror.style.overflow = 'hidden'
  mirror.style.whiteSpace = 'pre-wrap'
  mirror.style.wordWrap = 'break-word'
  mirror.style.width = `${textarea.clientWidth}px`
  mirror.style.top = '0'
  mirror.style.left = '-9999px'

  mirror.textContent = textarea.value.slice(0, position)
  const marker = document.createElement('span')
  marker.textContent = textarea.value.slice(position) || '.'
  mirror.appendChild(marker)
  document.body.appendChild(mirror)

  const textareaRect = textarea.getBoundingClientRect()
  const top = textareaRect.top + marker.offsetTop - textarea.scrollTop
  const left = textareaRect.left + marker.offsetLeft - textarea.scrollLeft
  const height = marker.offsetHeight
  mirror.remove()
  return { top, left, height }
}
