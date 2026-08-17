import { describe, expect, it } from 'vitest'
import { auditPage, DEFAULT_OPTIONS, renderAudit, type ElementSample, type PageSample } from '../src/audit.js'

function element(overrides: Partial<ElementSample> = {}): ElementSample {
  return {
    selector: 'p',
    text: 'Some copy',
    fontSizePx: 16,
    fontWeight: 400,
    fontFamily: 'Inter, sans-serif',
    color: 'rgb(20, 20, 20)',
    backgroundColor: 'rgb(255, 255, 255)',
    backgroundImage: 'none',
    widthPx: 600,
    heightPx: 24,
    spacingPx: [8, 16],
    interactive: false,
    ...overrides,
  }
}

function page(elements: ElementSample[]): PageSample {
  return { url: 'http://localhost/x', title: 'x', viewportWidthPx: 1280, elements }
}

const rule = (result: ReturnType<typeof auditPage>, name: string) =>
  result.violations.find(violation => violation.rule === name)

describe('a page that follows the system', () => {
  const clean = auditPage(page([
    element({ selector: 'h1', fontSizePx: 32, fontWeight: 700 }),
    element({ selector: 'h2', fontSizePx: 24, fontWeight: 600 }),
    element({ selector: 'p' }),
    element({ selector: 'button.primary', interactive: true, widthPx: 120, heightPx: 44, color: 'rgb(255,255,255)', backgroundColor: 'rgb(20, 90, 200)' }),
  ]), DEFAULT_OPTIONS)

  it('reports no violations', () => {
    expect(clean.violations).toEqual([])
  })

  it('still reports what it measured', () => {
    expect(clean.summary.elementsSampled).toBe(4)
    expect(clean.summary.typeSizes).toEqual([16, 24, 32])
    expect(clean.summary.contrastFailures).toBe(0)
    expect(renderAudit(clean)).toMatch(/No violations across 4 elements/)
  })
})

describe('contrast', () => {
  it('flags text below WCAG AA and names the worst offender with its ratio', () => {
    const result = auditPage(page([
      element({ selector: 'p.muted', color: 'rgb(200, 200, 200)' }),
      element({ selector: 'p.ok' }),
    ]), DEFAULT_OPTIONS)
    const violation = rule(result, 'contrast')
    expect(violation?.severity).toBe('high')
    expect(violation?.message).toMatch(/1 text element\(s\) fail WCAG AA/)
    expect(violation?.message).toMatch(/p\.muted at 1\.\d+:1 \(needs 4\.5:1\)/)
    expect(result.summary.contrastFailures).toBe(1)
  })

  it('allows large text the 3:1 threshold', () => {
    // 3.36:1 — clears the large-text bar, misses the body-text bar.
    const grey = 'rgb(140, 140, 140)'
    const large = auditPage(page([element({ selector: 'h1', fontSizePx: 32, color: grey })]), DEFAULT_OPTIONS)
    const small = auditPage(page([element({ selector: 'p', fontSizePx: 14, color: grey })]), DEFAULT_OPTIONS)
    expect(rule(large, 'contrast')).toBeUndefined()
    expect(rule(small, 'contrast')).toBeDefined()
  })

  it('accounts for text alpha rather than reading the declared color', () => {
    const result = auditPage(page([
      element({ selector: 'p.faded', color: 'rgba(60, 60, 60, 0.3)' }),
    ]), DEFAULT_OPTIONS)
    expect(rule(result, 'contrast')).toBeDefined()
  })

  it('skips elements whose color syntax it cannot model instead of guessing', () => {
    const result = auditPage(page([element({ color: 'oklch(0.7 0.1 200)' })]), DEFAULT_OPTIONS)
    expect(rule(result, 'contrast')).toBeUndefined()
    expect(result.summary.contrastFailures).toBe(0)
  })
})

describe('type scale', () => {
  it('flags an unplanned hierarchy and lists the sizes', () => {
    const sizes = [11, 13, 15, 16, 18, 21, 28]
    const result = auditPage(page(sizes.map((size, i) => element({ selector: `p.s${i}`, fontSizePx: size }))), DEFAULT_OPTIONS)
    const violation = rule(result, 'type-scale')
    expect(violation?.message).toMatch(/7 distinct text sizes \(11, 13, 15, 16, 18, 21, 28px\)/)
  })

  it('counts sizes only from elements that render text', () => {
    const result = auditPage(page([
      element({ fontSizePx: 16 }),
      element({ selector: 'div.wrapper', text: undefined, fontSizePx: 13 }),
    ]), DEFAULT_OPTIONS)
    expect(result.summary.typeSizes).toEqual([16])
  })
})

describe('spacing grid', () => {
  it('flags values off the scale and names them', () => {
    const result = auditPage(page([
      element({ selector: 'div.card', spacingPx: [8, 16, 13, 7] }),
    ]), DEFAULT_OPTIONS)
    const violation = rule(result, 'spacing-grid')
    expect(violation?.message).toMatch(/2 spacing value\(s\) are not multiples of 4px: 7, 13/)
    expect(violation?.elements).toContain('div.card')
  })

  it('honours a different base', () => {
    const eight = auditPage(page([element({ spacingPx: [12] })]), { ...DEFAULT_OPTIONS, spacingBasePx: 8 })
    const four = auditPage(page([element({ spacingPx: [12] })]), DEFAULT_OPTIONS)
    expect(rule(eight, 'spacing-grid')).toBeDefined()
    expect(rule(four, 'spacing-grid')).toBeUndefined()
  })
})

describe('palette', () => {
  it('counts non-neutral colors only, so a grey ramp is free', () => {
    const greys = ['rgb(10,10,10)', 'rgb(60,60,60)', 'rgb(120,120,120)', 'rgb(200,200,200)', 'rgb(245,245,245)']
    const result = auditPage(page(greys.map((color, i) => element({ selector: `p.g${i}`, color }))), DEFAULT_OPTIONS)
    expect(rule(result, 'palette')).toBeUndefined()
    expect(result.summary.paletteColors).toEqual([])
  })

  it('flags drift once too many distinct accents appear', () => {
    const colors = ['rgb(200,30,30)', 'rgb(30,200,30)', 'rgb(30,30,200)', 'rgb(200,200,30)',
      'rgb(200,30,200)', 'rgb(30,200,200)', 'rgb(240,120,20)', 'rgb(120,20,240)', 'rgb(20,240,120)']
    const result = auditPage(page(colors.map((color, i) => element({ selector: `p.c${i}`, color }))), DEFAULT_OPTIONS)
    expect(rule(result, 'palette')?.message).toMatch(/9 distinct non-neutral colors/)
  })
})

describe('tap targets and line length', () => {
  it('flags controls smaller than the floor with their measured size', () => {
    const result = auditPage(page([
      element({ selector: 'a.tiny', interactive: true, widthPx: 20, heightPx: 18 }),
    ]), DEFAULT_OPTIONS)
    expect(rule(result, 'tap-target')?.message).toMatch(/a\.tiny \(20x18\)/)
  })

  it('ignores non-interactive elements of any size', () => {
    const result = auditPage(page([element({ widthPx: 4, heightPx: 4 })]), DEFAULT_OPTIONS)
    expect(rule(result, 'tap-target')).toBeUndefined()
  })

  it('flags an over-long measure only for running text', () => {
    const long = auditPage(page([element({ selector: 'p.wide', charsPerLine: 120 })]), DEFAULT_OPTIONS)
    const short = auditPage(page([element({ selector: 'p.ok', charsPerLine: 68 })]), DEFAULT_OPTIONS)
    expect(rule(long, 'line-length')?.message).toMatch(/longest 120/)
    expect(rule(short, 'line-length')).toBeUndefined()
  })
})

describe('anti-patterns', () => {
  it('flags a violet gradient by hue rather than by literal string', () => {
    const result = auditPage(page([
      // Tailwind violet-500 to indigo-500: the canonical generated hero.
      element({ selector: 'header.hero', backgroundImage: 'linear-gradient(135deg, rgb(139, 92, 246), rgb(99, 102, 241))' }),
    ]), DEFAULT_OPTIONS)
    expect(rule(result, 'purple-gradient')?.elements).toContain('header.hero')
  })

  it('leaves a non-violet gradient alone', () => {
    const result = auditPage(page([
      element({ backgroundImage: 'linear-gradient(90deg, rgb(20, 120, 80), rgb(10, 60, 40))' }),
    ]), DEFAULT_OPTIONS)
    expect(rule(result, 'purple-gradient')).toBeUndefined()
  })

  it('flags the default font stack only when most text uses it', () => {
    const mostly = auditPage(page([
      element({ selector: 'p.a', fontFamily: 'Times New Roman' }),
      element({ selector: 'p.b', fontFamily: 'serif' }),
      element({ selector: 'p.c', fontFamily: 'Inter, sans-serif' }),
    ]), DEFAULT_OPTIONS)
    const rare = auditPage(page([
      element({ selector: 'p.a', fontFamily: 'Times New Roman' }),
      element({ selector: 'p.b', fontFamily: 'Inter, sans-serif' }),
      element({ selector: 'p.c', fontFamily: 'Inter, sans-serif' }),
    ]), DEFAULT_OPTIONS)
    expect(rule(mostly, 'default-font')).toBeDefined()
    expect(rule(rare, 'default-font')).toBeUndefined()
  })

  it('flags emoji used as control iconography, but not emoji in prose', () => {
    const control = auditPage(page([element({ selector: 'button.save', text: '💾 Save', interactive: true })]), DEFAULT_OPTIONS)
    const prose = auditPage(page([element({ selector: 'p', text: 'We shipped it 🎉' })]), DEFAULT_OPTIONS)
    expect(rule(control, 'emoji-icons')).toBeDefined()
    expect(rule(prose, 'emoji-icons')).toBeUndefined()
  })
})

describe('report', () => {
  it('orders violations by severity and renders the measured numbers', () => {
    const result = auditPage(page([
      element({ selector: 'p.muted', color: 'rgb(210, 210, 210)', spacingPx: [7] }),
      element({ selector: 'a.tiny', interactive: true, widthPx: 10, heightPx: 10 }),
    ]), DEFAULT_OPTIONS)
    expect(result.violations[0].severity).toBe('high')
    const text = renderAudit(result)
    expect(text).toMatch(/design violation\(s\) across 2 elements/)
    expect(text).toMatch(/## \[high\] contrast/)
  })
})

// The audit's own review caught these: a gradient or unparsed backdrop used to
// be reported as white, which turned "white text on a dark hero" — the most
// common landing-page pattern there is — into a contrast violation that does
// not exist. A linter that cries wolf on the commonest layout gets switched off.
describe('unmeasurable backdrops', () => {
  it('skips contrast for an element whose backdrop could not be modelled', () => {
    const result = auditPage(page([
      element({ selector: 'h1.hero', color: 'rgb(255, 255, 255)', backgroundColor: 'dsh-design-unknown' }),
    ]), DEFAULT_OPTIONS)
    expect(rule(result, 'contrast')).toBeUndefined()
    expect(result.summary.contrastFailures).toBe(0)
  })

  it('does not let an unmeasurable backdrop enter the palette count', () => {
    const result = auditPage(page([
      element({ backgroundColor: 'dsh-design-unknown', color: 'rgb(20,20,20)' }),
    ]), DEFAULT_OPTIONS)
    expect(result.summary.paletteColors).toEqual([])
  })

  it('still audits everything else on the same page', () => {
    const result = auditPage(page([
      element({ selector: 'h1.hero', color: 'rgb(255,255,255)', backgroundColor: 'dsh-design-unknown', spacingPx: [13] }),
    ]), DEFAULT_OPTIONS)
    expect(rule(result, 'spacing-grid')).toBeDefined()
  })
})

// Auditing dsh's own professionally-built Web UI produced two false-positive
// classes: 1px and 2px values (borders and optical nudges, not rhythm), and
// 28x28 desktop icon buttons measured against the 44px touch guideline when
// WCAG 2.2 AA asks for 24.
describe('calibration against a real application', () => {
  it('ignores hairline values below the spacing base', () => {
    const result = auditPage(page([element({ selector: 'div.rule', spacingPx: [1, 2, 3] })]), DEFAULT_OPTIONS)
    expect(rule(result, 'spacing-grid')).toBeUndefined()
  })

  it('still flags off-grid values at or above the base', () => {
    const result = auditPage(page([element({ spacingPx: [1, 6, 14] })]), DEFAULT_OPTIONS)
    expect(rule(result, 'spacing-grid')?.message).toMatch(/6, 14/)
    expect(rule(result, 'spacing-grid')?.message).not.toMatch(/\b1\b,/)
  })

  it('suggests the finer scale when every off-grid value fits one', () => {
    const result = auditPage(page([element({ spacingPx: [6, 10, 14] })]), DEFAULT_OPTIONS)
    expect(rule(result, 'spacing-grid')?.message).toMatch(/multiple of 2px, so this project may be on a 2px scale/)
    expect(rule(result, 'spacing-grid')?.message).toMatch(/set spacingBasePx: 2/)
  })

  it('asks for the scale plainly when the values fit no finer one', () => {
    const result = auditPage(page([element({ spacingPx: [7, 9] })]), DEFAULT_OPTIONS)
    expect(rule(result, 'spacing-grid')?.message).toMatch(/Snap spacing to the scale/)
  })

  it('defaults to the WCAG AA target size, not the touch guideline', () => {
    expect(DEFAULT_OPTIONS.minTapTargetPx).toBe(24)
    const desktopIcon = page([element({ selector: 'button.icon', interactive: true, widthPx: 28, heightPx: 28 })])
    expect(rule(auditPage(desktopIcon, DEFAULT_OPTIONS), 'tap-target')).toBeUndefined()
    // A touch-first deployment raises it and gets the stricter answer back.
    expect(rule(auditPage(desktopIcon, { ...DEFAULT_OPTIONS, minTapTargetPx: 44 }), 'tap-target')).toBeDefined()
  })

  it('still flags genuinely tiny controls at the AA threshold', () => {
    const result = auditPage(page([element({ selector: 'a.tiny', interactive: true, widthPx: 16, heightPx: 16 })]), DEFAULT_OPTIONS)
    expect(rule(result, 'tap-target')?.message).toMatch(/a\.tiny \(16x16\)/)
  })
})
