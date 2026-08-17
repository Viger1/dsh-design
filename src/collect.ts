/**
 * The measurement pass. `COLLECT_SCRIPT` runs inside the page and returns a
 * {@link PageSample}; it is a string rather than a function so it can be
 * evaluated verbatim in the browser realm without a bundler step, and so the
 * audit rules stay in Node where they are testable.
 * @module dsh-design/collect
 */

/**
 * Script evaluated in the page. Returns a JSON-serializable PageSample.
 *
 * Design notes for anyone editing this: it must not import anything, must not
 * throw on exotic documents, and must resolve an OPAQUE backdrop per text
 * element — contrast against `rgba(0,0,0,0)` is meaningless, and walking to
 * the first painted ancestor is what a person actually sees.
 */
export const COLLECT_SCRIPT = String.raw`(() => {
  const MAX_ELEMENTS = 400
  const isVisible = (el, style) => {
    if (style.display === 'none' || style.visibility === 'hidden' || Number(style.opacity) === 0) return false
    const rect = el.getBoundingClientRect()
    return rect.width > 0 && rect.height > 0
  }
  const opaqueBackdrop = (el) => {
    let node = el
    while (node) {
      const style = getComputedStyle(node)
      const bg = style.backgroundColor
      const match = /^rgba?\(\s*([\d.]+)[\s,]+([\d.]+)[\s,]+([\d.]+)(?:\s*[,/]\s*([\d.]+))?\s*\)$/i.exec(bg)
      if (match) {
        const alpha = match[4] === undefined ? 1 : Number(match[4])
        if (alpha >= 1) return bg
      }
      node = node.parentElement
    }
    return 'rgb(255, 255, 255)'
  }
  const describe = (el) => {
    const tag = el.tagName.toLowerCase()
    const id = el.id ? '#' + el.id : ''
    const cls = typeof el.className === 'string' && el.className.trim()
      ? '.' + el.className.trim().split(/\s+/).slice(0, 2).join('.')
      : ''
    return (tag + id + cls).slice(0, 60)
  }
  const INTERACTIVE = new Set(['a', 'button', 'input', 'select', 'textarea', 'summary'])
  const isInteractive = (el) => {
    const tag = el.tagName.toLowerCase()
    if (INTERACTIVE.has(tag)) return true
    const role = el.getAttribute('role')
    return role === 'button' || role === 'link' || role === 'checkbox' || role === 'tab'
  }
  const ownText = (el) => {
    let text = ''
    for (const node of el.childNodes) {
      if (node.nodeType === 3) text += node.textContent
    }
    return text.replace(/\s+/g, ' ').trim()
  }
  const px = (value) => {
    const n = parseFloat(value)
    return Number.isFinite(n) ? n : 0
  }

  const elements = []
  for (const el of document.body.querySelectorAll('*')) {
    if (elements.length >= MAX_ELEMENTS) break
    const style = getComputedStyle(el)
    if (!isVisible(el, style)) continue
    const rect = el.getBoundingClientRect()
    const text = ownText(el)
    const fontSizePx = px(style.fontSize)
    const sample = {
      selector: describe(el),
      fontSizePx,
      fontWeight: Number(style.fontWeight) || 400,
      fontFamily: style.fontFamily,
      color: style.color,
      backgroundColor: opaqueBackdrop(el),
      backgroundImage: style.backgroundImage,
      widthPx: rect.width,
      heightPx: rect.height,
      spacingPx: [
        style.paddingTop, style.paddingRight, style.paddingBottom, style.paddingLeft,
        style.marginTop, style.marginRight, style.marginBottom, style.marginLeft,
        style.rowGap, style.columnGap,
      ].map(px).filter(v => v > 0),
      interactive: isInteractive(el),
    }
    if (text) {
      sample.text = text.slice(0, 120)
      // Approximate the measure: average glyph advance is about 0.5em.
      const perLine = fontSizePx > 0 ? rect.width / (fontSizePx * 0.5) : 0
      // Only running text has a measure worth judging.
      if (text.length > 80 && perLine > 0) sample.charsPerLine = Math.round(perLine)
    }
    elements.push(sample)
  }

  return {
    url: location.href,
    title: document.title,
    viewportWidthPx: window.innerWidth,
    elements,
  }
})()`
