/**
 * The measurement pass. `COLLECT_SCRIPT` runs inside the page and returns a
 * {@link PageSample}; it is a string rather than a function so it can be
 * evaluated verbatim in the browser realm without a bundler step, and so the
 * audit rules stay in Node where they are testable.
 * @module dsh-design/collect
 */

/**
 * Sentinel returned as an element's background when the real backdrop cannot
 * be modelled — a gradient, an image, or a color syntax this audit does not
 * parse. Node treats it as unparseable and skips the element rather than
 * inventing a ratio, because guessing white behind a dark hero reports a
 * contrast failure that does not exist.
 */
export const UNKNOWN_BACKDROP = 'dsh-design-unknown'

/**
 * Script evaluated in the page. Returns a JSON-serializable PageSample.
 *
 * Editing rules: it must not import anything, must not throw on exotic
 * documents, and must never report a backdrop it did not actually find. An
 * element whose backdrop is a gradient or an unparsed color reports
 * {@link UNKNOWN_BACKDROP}; only a genuinely transparent layer is walked past.
 */
export const COLLECT_SCRIPT = String.raw`(() => {
  const MAX_ELEMENTS = 400
  const UNKNOWN = 'dsh-design-unknown'
  const RGB = /^rgba?\(\s*([\d.]+)[\s,]+([\d.]+)[\s,]+([\d.]+)(?:\s*[,/]\s*([\d.]+%?))?\s*\)$/i

  const isVisible = (el) => {
    // checkVisibility accounts for ancestor opacity and content-visibility,
    // which reading the element's own computed style cannot: opacity does not
    // inherit and an opacity:0 ancestor still lays its children out.
    if (typeof el.checkVisibility === 'function') {
      if (!el.checkVisibility({ opacityProperty: true, visibilityProperty: true, contentVisibilityAuto: true })) {
        return false
      }
    } else {
      const style = getComputedStyle(el)
      if (style.display === 'none' || style.visibility === 'hidden' || Number(style.opacity) === 0) return false
    }
    const rect = el.getBoundingClientRect()
    return rect.width > 0 && rect.height > 0
  }

  const alphaOf = (color) => {
    const match = RGB.exec(color)
    if (!match) return undefined
    if (match[4] === undefined) return 1
    return match[4].endsWith('%') ? Number(match[4].slice(0, -1)) / 100 : Number(match[4])
  }

  // Walk to the first layer that actually paints. A gradient or image, or a
  // color syntax we cannot read, ends the walk as UNKNOWN rather than being
  // treated as "nothing painted here".
  const backdropOf = (el) => {
    let node = el
    while (node) {
      const style = getComputedStyle(node)
      if (style.backgroundImage && style.backgroundImage !== 'none') return UNKNOWN
      const color = style.backgroundColor
      const alpha = alphaOf(color)
      if (alpha === undefined) return color === 'transparent' ? undefined : UNKNOWN
      if (alpha >= 1) return color
      // A translucent layer is approximated by continuing to the layer below;
      // the audit treats the result as the effective backdrop.
      node = node.parentElement
    }
    // Nothing painted anywhere up the tree: the canvas is the browser default.
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
    if (!isVisible(el)) continue
    const style = getComputedStyle(el)
    const rect = el.getBoundingClientRect()
    const text = ownText(el)
    const fontSizePx = px(style.fontSize)
    const backdrop = backdropOf(el)
    const sample = {
      selector: describe(el),
      fontSizePx,
      fontWeight: Number(style.fontWeight) || 400,
      fontFamily: style.fontFamily,
      color: style.color,
      backgroundColor: backdrop === undefined ? UNKNOWN : backdrop,
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
