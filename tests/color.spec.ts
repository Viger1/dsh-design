import { describe, expect, it } from 'vitest'
import {
  composite,
  contrastRatio,
  formatColor,
  hue,
  isNeutral,
  luminance,
  parseColor,
  requiredContrast,
} from '../src/color.js'

describe('parseColor', () => {
  it('parses the forms getComputedStyle returns', () => {
    expect(parseColor('rgb(255, 0, 0)')).toEqual({ r: 255, g: 0, b: 0, a: 1 })
    expect(parseColor('rgba(0, 0, 0, 0.5)')).toEqual({ r: 0, g: 0, b: 0, a: 0.5 })
    expect(parseColor('rgb(1 2 3 / 50%)')).toEqual({ r: 1, g: 2, b: 3, a: 0.5 })
  })

  it('parses hex in every length', () => {
    expect(parseColor('#fff')).toEqual({ r: 255, g: 255, b: 255, a: 1 })
    expect(parseColor('#FF8800')).toEqual({ r: 255, g: 136, b: 0, a: 1 })
    expect(parseColor('#00000080')?.a).toBeCloseTo(0.5, 2)
  })

  it('treats transparent as fully clear black', () => {
    expect(parseColor('transparent')).toEqual({ r: 0, g: 0, b: 0, a: 0 })
  })

  it('returns undefined for syntax it does not model, instead of guessing', () => {
    expect(parseColor('color(display-p3 1 0 0)')).toBeUndefined()
    expect(parseColor('oklch(0.7 0.1 200)')).toBeUndefined()
    expect(parseColor('not a color')).toBeUndefined()
  })
})

describe('contrast', () => {
  it('matches the WCAG reference values', () => {
    const black = { r: 0, g: 0, b: 0, a: 1 }
    const white = { r: 255, g: 255, b: 255, a: 1 }
    expect(contrastRatio(black, white)).toBeCloseTo(21, 5)
    expect(contrastRatio(white, white)).toBeCloseTo(1, 5)
    // #767676 on white is the canonical 4.5:1 boundary case.
    expect(contrastRatio({ r: 118, g: 118, b: 118, a: 1 }, white)).toBeCloseTo(4.54, 1)
  })

  it('is symmetric', () => {
    const a = { r: 30, g: 80, b: 200, a: 1 }
    const b = { r: 240, g: 240, b: 230, a: 1 }
    expect(contrastRatio(a, b)).toBeCloseTo(contrastRatio(b, a), 10)
  })

  it('computes luminance from the sRGB curve, not a naive average', () => {
    // Green contributes far more luminance than blue at equal channel value.
    expect(luminance({ r: 0, g: 255, b: 0, a: 1 })).toBeGreaterThan(luminance({ r: 0, g: 0, b: 255, a: 1 }))
  })

  it('requires 3:1 only for genuinely large text', () => {
    expect(requiredContrast(16, 400)).toBe(4.5)
    expect(requiredContrast(24, 400)).toBe(3)
    expect(requiredContrast(19, 700)).toBe(3)
    expect(requiredContrast(19, 400)).toBe(4.5)
  })
})

describe('composite', () => {
  it('blends a translucent layer over an opaque one', () => {
    const result = composite({ r: 0, g: 0, b: 0, a: 0.5 }, { r: 255, g: 255, b: 255, a: 1 })
    expect(result).toEqual({ r: 127.5, g: 127.5, b: 127.5, a: 1 })
  })

  it('passes an opaque layer through and drops a fully clear one', () => {
    const red = { r: 255, g: 0, b: 0, a: 1 }
    const white = { r: 255, g: 255, b: 255, a: 1 }
    expect(composite(red, white)).toEqual({ ...red, a: 1 })
    expect(composite({ r: 0, g: 0, b: 0, a: 0 }, white)).toEqual(white)
  })

  it('makes half-opacity grey text on white fail contrast that opaque text would pass', () => {
    const white = { r: 255, g: 255, b: 255, a: 1 }
    const grey = { r: 90, g: 90, b: 90, a: 1 }
    const faded = { ...grey, a: 0.4 }
    expect(contrastRatio(grey, white)).toBeGreaterThan(4.5)
    expect(contrastRatio(composite(faded, white), white)).toBeLessThan(4.5)
  })
})

describe('isNeutral', () => {
  it('classifies greys, black, and white as neutral', () => {
    for (const color of [{ r: 0, g: 0, b: 0 }, { r: 255, g: 255, b: 255 }, { r: 128, g: 128, b: 128 }]) {
      expect(isNeutral({ ...color, a: 1 }, 0.15)).toBe(true)
    }
  })

  it('classifies a saturated brand color as part of the palette', () => {
    expect(isNeutral({ r: 220, g: 30, b: 60, a: 1 }, 0.15)).toBe(false)
  })

  it('treats a barely tinted grey as neutral', () => {
    expect(isNeutral({ r: 130, g: 128, b: 126, a: 1 }, 0.15)).toBe(true)
  })
})

describe('hue', () => {
  it('places the primaries where they belong', () => {
    expect(hue({ r: 255, g: 0, b: 0, a: 1 })).toBeCloseTo(0, 1)
    expect(hue({ r: 0, g: 255, b: 0, a: 1 })).toBeCloseTo(120, 1)
    expect(hue({ r: 0, g: 0, b: 255, a: 1 })).toBeCloseTo(240, 1)
  })

  // Tailwind violet-500 is the most common offender and sits at 258, which is
  // why the audit's band starts at 250 rather than the tidier-looking 260.
  it('places the cliche violets and purples between 250 and 305', () => {
    for (const [r, g, b] of [[139, 92, 246], [168, 85, 247], [217, 70, 239]]) {
      const angle = hue({ r, g, b, a: 1 })
      expect(angle).toBeGreaterThanOrEqual(250)
      expect(angle).toBeLessThanOrEqual(305)
    }
  })

  it('keeps plain blue outside that band', () => {
    expect(hue({ r: 0, g: 0, b: 255, a: 1 })).toBeLessThan(250)
  })
})

describe('formatColor', () => {
  it('rounds and keeps alpha only when it matters', () => {
    expect(formatColor({ r: 127.5, g: 0, b: 0, a: 1 })).toBe('rgb(128, 0, 0)')
    expect(formatColor({ r: 0, g: 0, b: 0, a: 0.5 })).toBe('rgba(0, 0, 0, 0.5)')
  })
})
