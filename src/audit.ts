/**
 * The audit rules. Each one turns measurements taken from a rendered page into
 * violations that name an element and a number, so a report says "seven type
 * sizes, here they are" rather than "the hierarchy feels off".
 *
 * Every rule here is a pure function of the collected snapshot: the browser
 * measures, this decides.
 * @module dsh-design/audit
 */

import {
  composite,
  contrastRatio,
  formatColor,
  hue,
  isNeutral,
  parseColor,
  requiredContrast,
  type Rgba,
} from './color.js'

/** One element as measured in the page. */
export interface ElementSample {
  /** A short human-locatable description, e.g. `button.primary`. */
  selector: string
  /** Trimmed text content, when the element renders text directly. */
  text?: string
  /** Computed font size in px. */
  fontSizePx: number
  /** Computed numeric font weight. */
  fontWeight: number
  /** Computed font-family list, verbatim. */
  fontFamily: string
  /** Computed text color, verbatim. */
  color: string
  /** Effective background behind the element, resolved by walking ancestors. */
  backgroundColor: string
  /** Computed background-image, verbatim (`none` when absent). */
  backgroundImage: string
  /** Border-box width in px. */
  widthPx: number
  /** Border-box height in px. */
  heightPx: number
  /** Non-zero spacing values in px: paddings, margins, gaps. */
  spacingPx: number[]
  /** Whether the element is a control a person is expected to hit. */
  interactive: boolean
  /** Rendered characters per line, for running text only. */
  charsPerLine?: number
}

/** What the page as a whole looked like. */
export interface PageSample {
  /** Page URL. */
  url: string
  /** Document title. */
  title: string
  /** Viewport width the measurements were taken at. */
  viewportWidthPx: number
  /** Every visible element the collector sampled. */
  elements: ElementSample[]
}

/** How strict the audit is. */
export interface AuditOptions {
  /** Spacing values must be multiples of this many px. */
  spacingBasePx: number
  /** More distinct text sizes than this means the hierarchy is unplanned. */
  maxTypeSizes: number
  /** More distinct non-neutral colors than this means palette drift. */
  maxPaletteColors: number
  /** HSL saturation below which a color counts as neutral. */
  neutralSaturation: number
  /** Interactive elements smaller than this in either axis are hard to hit. */
  minTapTargetPx: number
  /** Running text wider than this many characters per line is tiring to read. */
  maxCharsPerLine: number
}

/** Sensible defaults; every one is a deployment config field. */
export const DEFAULT_OPTIONS: AuditOptions = {
  spacingBasePx: 4,
  maxTypeSizes: 6,
  maxPaletteColors: 8,
  neutralSaturation: 0.15,
  minTapTargetPx: 44,
  maxCharsPerLine: 75,
}

/** How much a violation matters. */
export type Severity = 'high' | 'medium' | 'low'

/** One thing the page got wrong. */
export interface Violation {
  /** Stable rule id, e.g. `contrast`. */
  rule: string
  /** How much it matters. */
  severity: Severity
  /** What is wrong, including the measured value. */
  message: string
  /** Elements it applies to, at most a handful. */
  elements: string[]
}

/** The finished audit. */
export interface AuditResult {
  /** Violations, most severe first. */
  violations: Violation[]
  /** Measurements worth reporting even when nothing is wrong. */
  summary: {
    elementsSampled: number
    typeSizes: number[]
    paletteColors: string[]
    contrastFailures: number
    offGridSpacings: number[]
  }
}

const SEVERITY_RANK: Record<Severity, number> = { high: 0, medium: 1, low: 2 }
/** Font stacks a browser falls back to when nothing was chosen. */
const DEFAULT_STACKS = new Set(['times', 'times new roman', 'serif', '-webkit-standard', 'system-ui'])
/**
 * Hue band of the generated-design gradient cliche, from violet through
 * fuchsia. The lower bound is 250 rather than 260 because the single most
 * common offender — Tailwind `violet-500`, `#8b5cf6` — sits at 258. Pure blue
 * (240) stays outside: blue gradients are an ordinary design choice.
 */
const CLICHE_HUE_MIN = 250
const CLICHE_HUE_MAX = 305
/** Emoji and pictographs, used to catch emoji standing in for icons. */
const EMOJI = /\p{Extended_Pictographic}/u

/**
 * Run every rule over a page sample.
 * @param page - the measurements taken from the rendered page.
 * @param options - strictness settings.
 * @returns violations plus the measurements behind them.
 */
export function auditPage(page: PageSample, options: AuditOptions): AuditResult {
  const violations: Violation[] = []
  const visibleText = page.elements.filter(element => (element.text ?? '') !== '')

  // Type scale: an unplanned hierarchy shows up as a long tail of sizes.
  const typeSizes = [...new Set(visibleText.map(element => round(element.fontSizePx)))].sort((a, b) => a - b)
  if (typeSizes.length > options.maxTypeSizes) {
    violations.push({
      rule: 'type-scale',
      severity: 'medium',
      message:
        `${typeSizes.length} distinct text sizes (${typeSizes.join(', ')}px); at most `
        + `${options.maxTypeSizes} keeps a readable hierarchy. Pick a scale and map every element onto it.`,
      elements: [],
    })
  }

  // Contrast: the one rule with an external standard behind it.
  const contrastFailures: { selector: string; ratio: number; required: number }[] = []
  for (const element of visibleText) {
    const foreground = parseColor(element.color)
    const background = parseColor(element.backgroundColor)
    if (!foreground || !background) continue
    // The collector resolves an opaque backdrop, so compositing the text color
    // over it is enough to model what the eye sees.
    const ratio = contrastRatio(composite(foreground, background), background)
    const required = requiredContrast(element.fontSizePx, element.fontWeight)
    if (ratio < required) contrastFailures.push({ selector: element.selector, ratio, required })
  }
  if (contrastFailures.length > 0) {
    const worst = [...contrastFailures].sort((a, b) => a.ratio - b.ratio).slice(0, 5)
    violations.push({
      rule: 'contrast',
      severity: 'high',
      message:
        `${contrastFailures.length} text element(s) fail WCAG AA. Worst: `
        + worst.map(f => `${f.selector} at ${f.ratio.toFixed(2)}:1 (needs ${f.required}:1)`).join('; ')
        + '.',
      elements: worst.map(f => f.selector),
    })
  }

  // Spacing grid: arbitrary gaps are the clearest tell of unconsidered layout.
  const offGrid = new Map<number, string[]>()
  for (const element of page.elements) {
    for (const value of element.spacingPx) {
      const rounded = round(value)
      if (rounded === 0 || rounded % options.spacingBasePx === 0) continue
      const seen = offGrid.get(rounded) ?? []
      if (seen.length < 3) seen.push(element.selector)
      offGrid.set(rounded, seen)
    }
  }
  if (offGrid.size > 0) {
    const values = [...offGrid.keys()].sort((a, b) => a - b)
    violations.push({
      rule: 'spacing-grid',
      severity: 'medium',
      message:
        `${values.length} spacing value(s) are not multiples of ${options.spacingBasePx}px: `
        + `${values.slice(0, 10).join(', ')}. Snap spacing to the scale so rhythm is deliberate.`,
      elements: [...new Set([...offGrid.values()].flat())].slice(0, 5),
    })
  }

  // Palette drift: neutrals are structure, saturated colors are choices.
  const palette = new Map<string, string[]>()
  for (const element of page.elements) {
    for (const raw of [element.color, element.backgroundColor]) {
      const color = parseColor(raw)
      if (!color || color.a === 0) continue
      if (isNeutral(color, options.neutralSaturation)) continue
      const key = formatColor({ ...color, a: 1 })
      const seen = palette.get(key) ?? []
      if (seen.length < 3) seen.push(element.selector)
      palette.set(key, seen)
    }
  }
  const paletteColors = [...palette.keys()]
  if (paletteColors.length > options.maxPaletteColors) {
    violations.push({
      rule: 'palette',
      severity: 'medium',
      message:
        `${paletteColors.length} distinct non-neutral colors; at most ${options.maxPaletteColors} `
        + 'keeps a palette recognizable. Reduce to one accent plus supporting tones.',
      elements: [],
    })
  }

  // Tap targets: a measurable accessibility floor, not a taste call.
  const smallTargets = page.elements.filter(element =>
    element.interactive
    && element.widthPx > 0 && element.heightPx > 0
    && (element.widthPx < options.minTapTargetPx || element.heightPx < options.minTapTargetPx))
  if (smallTargets.length > 0) {
    violations.push({
      rule: 'tap-target',
      severity: 'medium',
      message:
        `${smallTargets.length} interactive element(s) are smaller than ${options.minTapTargetPx}px: `
        + smallTargets.slice(0, 5).map(t => `${t.selector} (${round(t.widthPx)}x${round(t.heightPx)})`).join('; ')
        + '.',
      elements: smallTargets.slice(0, 5).map(t => t.selector),
    })
  }

  // Line length: long measures are the most common readability miss.
  const longLines = page.elements.filter(element =>
    element.charsPerLine !== undefined && element.charsPerLine > options.maxCharsPerLine)
  if (longLines.length > 0) {
    violations.push({
      rule: 'line-length',
      severity: 'low',
      message:
        `${longLines.length} text block(s) exceed ${options.maxCharsPerLine} characters per line `
        + `(longest ${Math.max(...longLines.map(l => l.charsPerLine ?? 0))}). Constrain the measure.`,
      elements: longLines.slice(0, 5).map(l => l.selector),
    })
  }

  violations.push(...antiPatterns(page, visibleText))
  violations.sort((a, b) => SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity])

  return {
    violations,
    summary: {
      elementsSampled: page.elements.length,
      typeSizes,
      paletteColors,
      contrastFailures: contrastFailures.length,
      offGridSpacings: [...offGrid.keys()].sort((a, b) => a - b),
    },
  }
}

/**
 * The specific tells of a generated-looking page.
 * @param page - the page sample.
 * @param visibleText - elements that render text.
 * @returns anti-pattern violations.
 */
function antiPatterns(page: PageSample, visibleText: ElementSample[]): Violation[] {
  const found: Violation[] = []

  const defaultFont = visibleText.filter((element) => {
    const first = element.fontFamily.split(',')[0]?.trim().replace(/^["']|["']$/g, '').toLowerCase()
    return first !== undefined && DEFAULT_STACKS.has(first)
  })
  if (defaultFont.length > 0 && defaultFont.length >= visibleText.length / 2) {
    found.push({
      rule: 'default-font',
      severity: 'medium',
      message:
        'Most text renders in the browser default stack, so no typographic choice was made. '
        + 'Set a deliberate family for body and headings.',
      elements: defaultFont.slice(0, 3).map(element => element.selector),
    })
  }

  const purpleGradients = page.elements.filter((element) => {
    if (!element.backgroundImage.includes('gradient')) return false
    const stops = element.backgroundImage.match(/rgba?\([^)]*\)|#[0-9a-f]{3,8}/gi) ?? []
    return stops.some((stop) => {
      const color = parseColor(stop)
      if (color === undefined || isNeutral(color, 0.25)) return false
      const angle = hue(color)
      return angle >= CLICHE_HUE_MIN && angle <= CLICHE_HUE_MAX
    })
  })
  if (purpleGradients.length > 0) {
    found.push({
      rule: 'purple-gradient',
      severity: 'low',
      message:
        `${purpleGradients.length} element(s) use a violet gradient — the most recognizable `
        + 'generated-design cliche. Choose a color that means something for this product.',
      elements: purpleGradients.slice(0, 3).map(element => element.selector),
    })
  }

  const emojiControls = page.elements.filter(element =>
    element.interactive && EMOJI.test(element.text ?? ''))
  if (emojiControls.length > 0) {
    found.push({
      rule: 'emoji-icons',
      severity: 'low',
      message:
        `${emojiControls.length} control(s) use emoji as iconography, which renders differently on `
        + 'every platform and reads as unfinished. Use an icon set or text.',
      elements: emojiControls.slice(0, 3).map(element => element.selector),
    })
  }

  return found
}

/**
 * Round to one decimal so sub-pixel noise does not fragment the counts.
 * @param value - a measured px value.
 * @returns the rounded value.
 */
function round(value: number): number {
  return Math.round(value * 10) / 10
}

/**
 * Render an audit as the text the model reads.
 * @param result - the finished audit.
 * @returns the model-facing report.
 */
export function renderAudit(result: AuditResult): string {
  const { summary, violations } = result
  const lines = [
    violations.length === 0
      ? `No violations across ${summary.elementsSampled} elements.`
      : `${violations.length} design violation(s) across ${summary.elementsSampled} elements.`,
    `Type sizes: ${summary.typeSizes.length === 0 ? 'none measured' : summary.typeSizes.join(', ') + 'px'}`,
    `Non-neutral colors: ${summary.paletteColors.length === 0 ? 'none' : summary.paletteColors.join(', ')}`,
  ]
  for (const violation of violations) {
    lines.push('', `## [${violation.severity}] ${violation.rule}`, violation.message)
    if (violation.elements.length > 0) lines.push(`Elements: ${violation.elements.join(', ')}`)
  }
  return lines.join('\n')
}

/**
 * Colors are compared as opaque values; exported for the collector's tests.
 * @param color - any parsed color.
 * @returns the same color at full alpha.
 */
export function opaque(color: Rgba): Rgba {
  return { ...color, a: 1 }
}
