/**
 * Color math for the audit: parse what `getComputedStyle` returns, composite
 * translucent layers, and compute WCAG contrast. Kept pure so the rules that
 * decide whether text is readable are testable without a browser.
 * @module dsh-design/color
 */

/** A parsed color with straight (non-premultiplied) alpha. */
export interface Rgba {
  r: number
  g: number
  b: number
  /** 0-1. */
  a: number
}

const RGB_FUNCTION = /^rgba?\(\s*([\d.]+)[\s,]+([\d.]+)[\s,]+([\d.]+)(?:\s*[,/]\s*([\d.]+%?))?\s*\)$/i
const HEX = /^#([0-9a-f]{3,8})$/i

/**
 * Parse a computed-style color string.
 * @param value - `rgb()`, `rgba()`, `#rgb`, `#rrggbb(aa)`, or `transparent`.
 * @returns the parsed color, or undefined when the syntax is not recognized
 *   (a modern color function this audit does not model, for instance).
 */
export function parseColor(value: string): Rgba | undefined {
  const text = value.trim().toLowerCase()
  if (text === 'transparent') return { r: 0, g: 0, b: 0, a: 0 }
  const fn = RGB_FUNCTION.exec(text)
  if (fn) {
    const alpha = fn[4] === undefined
      ? 1
      : fn[4].endsWith('%') ? Number(fn[4].slice(0, -1)) / 100 : Number(fn[4])
    return { r: Number(fn[1]), g: Number(fn[2]), b: Number(fn[3]), a: clamp01(alpha) }
  }
  const hex = HEX.exec(text)
  if (!hex) return undefined
  const digits = hex[1]
  const expand = (part: string): number => parseInt(part.length === 1 ? part + part : part, 16)
  if (digits.length === 3 || digits.length === 4) {
    return {
      r: expand(digits[0]), g: expand(digits[1]), b: expand(digits[2]),
      a: digits.length === 4 ? expand(digits[3]) / 255 : 1,
    }
  }
  if (digits.length === 6 || digits.length === 8) {
    return {
      r: expand(digits.slice(0, 2)), g: expand(digits.slice(2, 4)), b: expand(digits.slice(4, 6)),
      a: digits.length === 8 ? expand(digits.slice(6, 8)) / 255 : 1,
    }
  }
  return undefined
}

/**
 * Composite a translucent color over an opaque one.
 * @param over - the upper layer.
 * @param under - the lower layer, treated as opaque.
 * @returns the resulting opaque color.
 */
export function composite(over: Rgba, under: Rgba): Rgba {
  const a = clamp01(over.a)
  return {
    r: over.r * a + under.r * (1 - a),
    g: over.g * a + under.g * (1 - a),
    b: over.b * a + under.b * (1 - a),
    a: 1,
  }
}

/**
 * WCAG relative luminance.
 * @param color - an opaque color.
 * @returns luminance in 0-1.
 */
export function luminance(color: Rgba): number {
  const channel = (value: number): number => {
    const c = value / 255
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4
  }
  return 0.2126 * channel(color.r) + 0.7152 * channel(color.g) + 0.0722 * channel(color.b)
}

/**
 * WCAG contrast ratio between two opaque colors.
 * @param a - one color.
 * @param b - the other.
 * @returns the ratio, from 1 (identical) to 21 (black on white).
 */
export function contrastRatio(a: Rgba, b: Rgba): number {
  const la = luminance(a)
  const lb = luminance(b)
  const [light, dark] = la >= lb ? [la, lb] : [lb, la]
  return (light + 0.05) / (dark + 0.05)
}

/**
 * The contrast WCAG AA requires for this text.
 *
 * Large text is 18pt (24px) or 14pt (18.66px) bold and above, and is allowed
 * 3:1 because size compensates for lower contrast.
 * @param fontSizePx - computed font size in px.
 * @param fontWeight - computed numeric weight.
 * @returns the required ratio.
 */
export function requiredContrast(fontSizePx: number, fontWeight: number): number {
  const large = fontSizePx >= 24 || (fontSizePx >= 18.66 && fontWeight >= 700)
  return large ? 3 : 4.5
}

/**
 * Whether a color reads as a neutral (grey, black, white) rather than part of
 * the palette. Neutrals are excluded from palette-size accounting because a
 * grey scale is structure, not a color choice.
 * @param color - the color to classify.
 * @param saturationThreshold - HSL saturation below which a color is neutral.
 * @returns true for neutrals.
 */
export function isNeutral(color: Rgba, saturationThreshold: number): boolean {
  const max = Math.max(color.r, color.g, color.b)
  const min = Math.min(color.r, color.g, color.b)
  if (max === min) return true
  const lightness = (max + min) / 2 / 255
  const delta = (max - min) / 255
  const saturation = lightness > 0.5 ? delta / (2 - (max + min) / 255) : delta / ((max + min) / 255)
  return saturation < saturationThreshold
}

/**
 * The hue angle of a color, for detecting a specific hue family.
 * @param color - the color to measure.
 * @returns hue in degrees, 0-360.
 */
export function hue(color: Rgba): number {
  const r = color.r / 255
  const g = color.g / 255
  const b = color.b / 255
  const max = Math.max(r, g, b)
  const min = Math.min(r, g, b)
  const delta = max - min
  if (delta === 0) return 0
  let value: number
  if (max === r) value = ((g - b) / delta) % 6
  else if (max === g) value = (b - r) / delta + 2
  else value = (r - g) / delta + 4
  const degrees = value * 60
  return degrees < 0 ? degrees + 360 : degrees
}

/**
 * Format a color for a report.
 * @param color - the color to render.
 * @returns a short `rgb()`/`rgba()` string.
 */
export function formatColor(color: Rgba): string {
  const round = (n: number): number => Math.round(n)
  return color.a >= 1
    ? `rgb(${round(color.r)}, ${round(color.g)}, ${round(color.b)})`
    : `rgba(${round(color.r)}, ${round(color.g)}, ${round(color.b)}, ${Number(color.a.toFixed(2))})`
}

/**
 * Clamp to the 0-1 alpha range.
 * @param value - raw alpha.
 * @returns the clamped value.
 */
function clamp01(value: number): number {
  if (Number.isNaN(value)) return 1
  return Math.min(1, Math.max(0, value))
}
