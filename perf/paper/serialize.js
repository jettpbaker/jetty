// Executed in the isolated browser by capture.ts; coordinates preserve grid, tables and scroll positions.
window.__paperCapture = async function captureDOM(selector, colors) {
  const root = document.querySelector(selector)
  if (!root) throw new Error(`No capture root: ${selector}`)
  const origin =
    root === document.body
      ? { x: 0, y: 0, width: innerWidth, height: innerHeight }
      : root.getBoundingClientRect()
  let background = 'rgba(0, 0, 0, 0)'
  for (let ancestor = root; ancestor; ancestor = ancestor.parentElement) {
    const color = getComputedStyle(ancestor).backgroundColor
    if (color !== 'rgba(0, 0, 0, 0)') {
      background = color
      break
    }
  }
  const images = []
  let serial = 0
  const escape = (value) =>
    String(value)
      .replaceAll('&', '&amp;')
      .replaceAll('"', '&quot;')
      .replaceAll('<', '&lt;')
      .replaceAll('>', '&gt;')
  const px = (value) => `${Math.round(value * 100) / 100}px`
  const font = (style) => (style.fontFamily.includes('Mono') ? 'Geist Mono' : 'Geist')
  const token = (value) => (colors[value] ? `var(${colors[value]})` : value)
  const intersect = (a, b) => ({
    left: Math.max(a.left, b.left),
    top: Math.max(a.top, b.top),
    right: Math.min(a.right, b.right),
    bottom: Math.min(a.bottom, b.bottom),
  })
  const initialClip = {
    left: origin.x,
    top: origin.y,
    right: origin.x + origin.width,
    bottom: origin.y + origin.height,
  }

  function position(rect, parent) {
    return `position:absolute;left:${px(rect.x - parent.x)};top:${px(rect.y - parent.y)};width:${px(rect.width)};height:${px(rect.height)};box-sizing:border-box;`
  }

  function typography(style) {
    return `font-family:${font(style)};font-size:${style.fontSize};font-weight:${style.fontWeight};font-style:${style.fontStyle};line-height:${style.lineHeight === 'normal' ? px(parseFloat(style.fontSize) * 1.2) : style.lineHeight};letter-spacing:${style.letterSpacing === 'normal' ? '0em' : `${parseFloat(style.letterSpacing) / parseFloat(style.fontSize)}em`};color:${token(style.color)};text-decoration:${style.textDecorationLine};`
  }

  function text(node, parent, style, clip) {
    const value = node.textContent
    if (!value.trim()) return ''
    const range = document.createRange()
    const lines = []
    let line = null
    for (let i = 0; i < value.length; i++) {
      range.setStart(node, i)
      range.setEnd(node, i + 1)
      const rect = range.getBoundingClientRect()
      if (!rect.width || !rect.height) continue
      if (!line || Math.abs(rect.y - line.rect.y) > 1) {
        line = { text: '', rect: { x: rect.x, y: rect.y, width: 0, height: rect.height } }
        lines.push(line)
      }
      line.text += value[i]
      line.rect.width = rect.right - line.rect.x
    }
    return lines
      .filter((line) => line.rect.y + line.rect.height > clip.top && line.rect.y < clip.bottom)
      .map((line) => {
        const height =
          style.lineHeight === 'normal'
            ? parseFloat(style.fontSize) * 1.2
            : parseFloat(style.lineHeight)
        const rect = {
          ...line.rect,
          y: line.rect.y + (line.rect.height - height) / 2,
          height,
          width: line.rect.width + 0.5,
        }
        return `<div layer-name="Text" style="${position(rect, parent)}${typography(style)}display:block;white-space:pre;">${escape(line.text)}</div>`
      })
      .join('')
  }

  async function visit(element, parent, clip, isRoot = false) {
    const style = getComputedStyle(element)
    const rect = element.getBoundingClientRect()
    if (
      style.display === 'none' ||
      style.visibility === 'hidden' ||
      parseFloat(style.opacity) === 0
    )
      return ''
    if (style.display === 'contents') {
      let html = ''
      for (const child of element.children) html += await visit(child, parent, clip)
      return html
    }
    if (rect.width <= 1 || rect.height <= 1) {
      let html = ''
      for (const child of element.children) html += await visit(child, parent, clip)
      return html
    }
    if (
      rect.right <= clip.left ||
      rect.left >= clip.right ||
      rect.bottom <= clip.top ||
      rect.top >= clip.bottom
    )
      return ''
    if (['SCRIPT', 'STYLE', 'LINK', 'META', 'NOSCRIPT'].includes(element.tagName)) return ''
    const name =
      element.getAttribute('aria-label') ??
      element.getAttribute('data-perf-region') ??
      element.getAttribute('data-slot') ??
      element.tagName.toLowerCase()
    const own = isRoot
      ? { x: origin.x, y: origin.y, width: origin.width, height: origin.height }
      : rect
    let css = position(own, parent) + 'display:block;'
    for (const property of [
      'background-color',
      'background-image',
      'border-top-width',
      'border-right-width',
      'border-bottom-width',
      'border-left-width',
      'border-top-style',
      'border-right-style',
      'border-bottom-style',
      'border-left-style',
      'border-top-color',
      'border-right-color',
      'border-bottom-color',
      'border-left-color',
      'border-top-left-radius',
      'border-top-right-radius',
      'border-bottom-left-radius',
      'border-bottom-right-radius',
      'box-shadow',
      'opacity',
    ]) {
      const value = style.getPropertyValue(property)
      if (
        value &&
        value !== 'none' &&
        value !== '0px' &&
        value !== 'rgba(0, 0, 0, 0)' &&
        !(property === 'opacity' && value === '1')
      )
        css += `${property}:${token(value)};`
    }
    for (const side of ['Top', 'Right', 'Bottom', 'Left']) {
      const width = style['border' + side + 'Width']
      if (parseFloat(width))
        css += `border-${side.toLowerCase()}:${width} ${style['border' + side + 'Style']} ${token(style['border' + side + 'Color'])};`
    }
    let childClip = clip
    if (
      ['hidden', 'clip', 'scroll', 'auto'].includes(style.overflowX) ||
      ['hidden', 'clip', 'scroll', 'auto'].includes(style.overflowY)
    ) {
      childClip = intersect(clip, rect)
      css += 'overflow:hidden;'
    }
    if (element.tagName.toLowerCase() === 'svg') {
      const clone = element.cloneNode(true)
      const originals = [element, ...element.querySelectorAll('*')]
      const copies = [clone, ...clone.querySelectorAll('*')]
      for (let i = 0; i < originals.length; i++) {
        const computed = getComputedStyle(originals[i])
        copies[i].removeAttribute('class')
        copies[i].removeAttribute('style')
        for (const attribute of [
          'fill',
          'stroke',
          'stroke-width',
          'stroke-linecap',
          'stroke-linejoin',
          'fill-rule',
          'clip-rule',
          'vector-effect',
          'opacity',
        ])
          copies[i].setAttribute(attribute, computed.getPropertyValue(attribute))
      }
      clone.setAttribute('style', css)
      clone.setAttribute('layer-name', name)
      return clone.outerHTML
    }
    if (
      style.backdropFilter !== 'none' ||
      style.backgroundClip === 'text' ||
      (style.maskImage !== 'none' && !style.maskImage.includes('linear-gradient')) ||
      element.shadowRoot ||
      ['CANVAS', 'VIDEO', 'IFRAME'].includes(element.tagName) ||
      element.matches('.cm-editor')
    ) {
      const key = `__PAPER_IMAGE_${serial++}__`
      const cropped = intersect(clip, rect)
      images.push({
        key,
        name,
        reason:
          style.backdropFilter !== 'none'
            ? 'CSS backdrop filter'
            : style.backgroundClip === 'text'
              ? 'CSS text gradient'
              : style.maskImage !== 'none'
                ? 'CSS image mask'
                : element.shadowRoot
                  ? 'shadow DOM (Pierre renderer)'
                  : element.tagName.toLowerCase(),
        x: cropped.left,
        y: cropped.top,
        width: cropped.right - cropped.left,
        height: cropped.bottom - cropped.top,
      })
      return `<img layer-name="${escape(name)} (screenshot)" src="${key}" style="${position({ x: cropped.left, y: cropped.top, width: cropped.right - cropped.left, height: cropped.bottom - cropped.top }, parent)}" />`
    }
    if (element.tagName === 'IMG') {
      const response = await fetch(element.currentSrc || element.src)
      const blob = await response.blob()
      const data = await new Promise((resolve) => {
        const reader = new FileReader()
        reader.onload = () => resolve(reader.result)
        reader.readAsDataURL(blob)
      })
      return `<img layer-name="${escape(name)}" src="${data}" style="${css}object-fit:${style.objectFit};" />`
    }
    let contents = ''
    const inner = {
      x: own.x + parseFloat(style.borderLeftWidth),
      y: own.y + parseFloat(style.borderTopWidth),
    }
    for (const child of element.childNodes) {
      if (child.nodeType === Node.TEXT_NODE) contents += text(child, inner, style, childClip)
      else if (child.nodeType === Node.ELEMENT_NODE)
        contents += await visit(child, inner, childClip)
    }
    if (['INPUT', 'TEXTAREA'].includes(element.tagName)) {
      const placeholder = !element.value
      const inputStyle = placeholder ? getComputedStyle(element, '::placeholder') : style
      const x = parseFloat(style.paddingLeft),
        y = parseFloat(style.paddingTop)
      contents = `<div style="position:absolute;left:${px(x)};top:${px(y)};width:${px(rect.width - x - parseFloat(style.paddingRight))};${typography(inputStyle)}white-space:pre-wrap;">${escape(element.value || element.placeholder)}</div>`
    }
    if (style.maskImage !== 'none' && style.maskImage.includes('linear-gradient')) {
      const bounds = intersect(clip, rect)
      const horizontal = /to right|90deg/.test(style.maskImage)
      const strips = horizontal
        ? [{ x: bounds.right - 16, y: bounds.top, width: 16, height: bounds.bottom - bounds.top }]
        : [
            { x: bounds.left, y: bounds.top, width: bounds.right - bounds.left, height: 24 },
            {
              x: bounds.left,
              y: bounds.bottom - 24,
              width: bounds.right - bounds.left,
              height: 24,
            },
          ]
      for (const strip of strips) {
        if (strip.width <= 0 || strip.height <= 0) continue
        const key = `__PAPER_IMAGE_${serial++}__`
        images.push({ key, name: 'CSS mask edge', reason: 'CSS gradient mask', ...strip })
        contents += `<img layer-name="CSS mask edge (screenshot)" src="${key}" style="${position(strip, inner)}" />`
      }
    }
    if (
      !contents &&
      style.backgroundColor === 'rgba(0, 0, 0, 0)' &&
      style.backgroundImage === 'none' &&
      style.boxShadow === 'none' &&
      !['Top', 'Right', 'Bottom', 'Left'].some((side) =>
        parseFloat(style['border' + side + 'Width'])
      )
    )
      return ''
    return `<div layer-name="${escape(name)}" style="${css}">${contents}</div>`
  }
  const html = await visit(root, origin, initialClip, true)
  return {
    html,
    background,
    images,
    width: Math.ceil(origin.width),
    height: Math.ceil(origin.height),
  }
}
