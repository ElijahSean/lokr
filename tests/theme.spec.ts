/**
 * tests/theme.spec.ts — contrast of the colour tokens, light and dark (tasks 3.2, 3.1)
 *
 * Reads the colours from tailwind.palette.js, the one place their hex values
 * live (tailwind.config.js turns them into CSS variables), and checks each text
 * and background pairing the app uses against WCAG AA (4.5:1 for normal text),
 * in both themes. If one fails, a token change has made some screen hard to
 * read. Pairs are listed by where they appear, so a failure names the screen
 * to look at, and the theme is in the test name.
 */
import { createRequire } from 'node:module'
import { describe, it, expect } from 'vitest'

type Scale = Record<string, string>
type Papers = Record<string, { DEFAULT: string; strip: string }>
interface ThemedColors {
  slate: Scale
  primary: string
  brand: Scale
  danger: string
  warning: string
  success: string
  note: Papers
}
interface Palette {
  light: ThemedColors
  dark: ThemedColors
  fixed: { brand: Scale; accent: Scale; ink: Scale; statusDark: Scale }
}

// tailwind.palette.js is CommonJS (module.exports), so load it with require
const require = createRequire(import.meta.url)
const palette = require('../tailwind.palette.js') as Palette
const { accent, ink, statusDark } = palette.fixed
// Tailwind's default palette, for the stock reds the danger outlines use
const twColors = require('tailwindcss/colors') as { red: Scale }

const AA = 4.5
// WCAG 1.4.11 non-text contrast: dots, meter bars, icons and edges (task 3.3)
const GRAPHIC = 3
// CIE76 colour difference above which two papers read as different colours
const DISTINCT = 10

// WCAG 2.x relative luminance of a #rrggbb colour
function luminance(hex: string): number {
  const channels = [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16) / 255)
  const [r, g, b] = channels.map(c => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4))
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}

function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x)
  return (hi + 0.05) / (lo + 0.05)
}

// CIELAB (D65) of a #rrggbb colour, for telling the paper colours apart
function lab(hex: string): [number, number, number] {
  const [r, g, b] = [1, 3, 5]
    .map(i => parseInt(hex.slice(i, i + 2), 16) / 255)
    .map(c => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4))
  const x = (r * 0.4124 + g * 0.3576 + b * 0.1805) / 0.95047
  const y = r * 0.2126 + g * 0.7152 + b * 0.0722
  const z = (r * 0.0193 + g * 0.1192 + b * 0.9505) / 1.08883
  const f = (t: number) => (t > 0.008856 ? Math.cbrt(t) : 7.787 * t + 16 / 116)
  return [116 * f(y) - 16, 500 * (f(x) - f(y)), 200 * (f(y) - f(z))]
}

function colourDifference(a: string, b: string): number {
  const [p, q] = [lab(a), lab(b)]
  return Math.hypot(p[0] - q[0], p[1] - q[1], p[2] - q[2])
}

function expectReadable(text: string, background: string) {
  expect(contrast(text, background), `${text} on ${background}`).toBeGreaterThanOrEqual(AA)
}

function expectVisible(graphic: string, background: string) {
  expect(contrast(graphic, background), `${graphic} on ${background}`).toBeGreaterThanOrEqual(GRAPHIC)
}

describe('contrast helper', () => {
  it('matches the WCAG reference values', () => {
    expect(contrast('#000000', '#ffffff')).toBeCloseTo(21, 5)
    expect(contrast('#777777', '#ffffff')).toBeCloseTo(4.48, 2)
  })

  it('matches a CIE76 reference value', () => {
    expect(colourDifference('#000000', '#ffffff')).toBeCloseTo(100, 0)
  })
})

describe('the light theme is unchanged by dark mode (task 3.1)', () => {
  it('keeps every light token at its 3.2–3.4 value', () => {
    expect(palette.light).toEqual({
      slate: {
        50: '#ffffff', 100: '#0b1926', 200: '#232121', 300: '#393b3d', 400: '#4f4c4c', 500: '#636161',
        600: '#6a6767', 700: '#e4dddb', 800: '#efe9e7', 900: '#f7f3f2', 950: '#ffffff',
      },
      primary: '#0b1926',
      // label: the text-white the buttons used before 3.1
      brand: { 500: '#232121', 600: '#393b3d', label: '#ffffff' },
      danger: '#c64c3a',
      warning: '#9a6a1a',
      success: '#3d7a55',
      note: {
        yellow: { DEFAULT: '#fef9c3', strip: '#fef08a' },
        green:  { DEFAULT: '#dcfce7', strip: '#bbf7d0' },
        blue:   { DEFAULT: '#e0f2fe', strip: '#bae6fd' },
        pink:   { DEFAULT: '#fce7f3', strip: '#fbcfe8' },
        orange: { DEFAULT: '#ffedd5', strip: '#fed7aa' },
        white:  { DEFAULT: '#ffffff', strip: '#f6efee' },
        grey:   { DEFAULT: '#efe9e7', strip: '#e4dddb' },
        black:  { DEFAULT: '#232121', strip: '#121212' },
      },
    })
  })

  it('gives the dark theme the same tokens, so no class is left without a dark value', () => {
    const keys = (o: object): string[] =>
      Object.entries(o).flatMap(([k, v]) => (typeof v === 'string' ? [k] : keys(v).map(inner => `${k}.${inner}`)))
    expect(keys(palette.dark)).toEqual(keys(palette.light))
  })
})

describe('dark parts (unlock screen, top bar, footer), the same in both themes', () => {
  const surfaces = { page: ink.DEFAULT, surface: ink.surface, raised: ink.raised }

  for (const [name, bg] of Object.entries(surfaces)) {
    it(`main and secondary text stay readable on the ${name}`, () => {
      expectReadable(ink.text, bg)
      expectReadable(ink.muted, bg)
    })
  }

  it('the faintest text and the coral accent stay readable on the ink page', () => {
    expectReadable(ink.subtle, ink.DEFAULT)
    expectReadable(accent.DEFAULT, ink.DEFAULT)
  })

  it('dark labels stay readable on the warm-white pills', () => {
    expectReadable(ink.DEFAULT, ink.text)
    expectReadable(ink.DEFAULT, '#ffffff')  // their hover:bg-white
  })

  for (const [name, bg] of Object.entries({ ...surfaces, track: ink.border })) {
    it(`the create-vault meter's status bars stay visible on the ${name}`, () => {
      for (const graphic of [statusDark.danger, statusDark.warning, statusDark.success, ink.muted]) {
        expectVisible(graphic, bg)
      }
    })
  }
})

// The danger outline's stock reds per theme: DANGER_OUTLINE is red-600/700 on
// light and takes DANGER_OUTLINE_ON_DARK's red-400 under dark: (components/ui.ts)
const OUTLINE = {
  light: { label: twColors.red[700], border: twColors.red[600] },
  dark:  { label: twColors.red[400], border: twColors.red[400] },
}

// Papers whose colour is too close to the page get a hairline (NOTE_CLASSES' edge
// in StickyNoteView.tsx): white and grey in both themes, black in dark mode
const EDGED = { light: ['white', 'grey'], dark: ['white', 'grey', 'black'] }

for (const theme of ['light', 'dark'] as const) {
  const { slate, primary, brand, danger, warning, success, note } = palette[theme]
  const outline = OUTLINE[theme]

  describe(`${theme}: content below the top bar`, () => {
    const surfaces = { page: slate[950], card: slate[900], input: slate[800] }

    for (const [name, bg] of Object.entries(surfaces)) {
      it(`text stays readable on the ${name}`, () => {
        for (const text of [primary, slate[100], slate[200], slate[300], slate[400], slate[500], slate[600]]) {
          expectReadable(text, bg)
        }
      })

      it(`link text stays readable on the ${name}`, () => {
        expectReadable(brand[600], bg)
      })
    }

    it('focus rings stay visible against the page and the card', () => {
      // focus:ring-brand-500 on inputs, cards and list rows
      expectVisible(brand[500], slate[950])
      expectVisible(brand[500], slate[900])
    })
  })

  describe(`${theme}: buttons`, () => {
    it('the label stays readable on the main button and its hover', () => {
      // text-brand-label on bg-brand-500, hover:bg-brand-600 (graphite on light,
      // warm-white pills in dark mode)
      expectReadable(brand.label, brand[500])
      expectReadable(brand.label, brand[600])
    })

    it('quiet buttons stay readable, resting and on hover (task 3.5)', () => {
      // QUIET_BUTTON (Regenerate, Re-analyze) and the import file picker's button
      expectReadable(slate[300], slate[800])
      expectReadable(primary, slate[700])
    })
  })

  describe(`${theme}: status colours (task 3.3)`, () => {
    // Dots on chips (slate-800), meter bars on their track (slate-700), icons and
    // error edges on cards and the page. "good" is a brand-600 dot.
    const surfaces = { page: slate[950], card: slate[900], chip: slate[800], track: slate[700] }

    for (const [name, bg] of Object.entries(surfaces)) {
      it(`status dots, bars and icons stay visible on the ${name}`, () => {
        for (const graphic of [danger, warning, success, brand[600]]) expectVisible(graphic, bg)
      })
    }

    it('chip labels stay readable on the chip', () => {
      expectReadable(slate[300], slate[800])
    })

    it('the delete confirm outline stays readable on an entry card', () => {
      expectReadable(outline.label, slate[900])
      expectVisible(outline.border, slate[900])
    })

    it('the danger and notice edges stay visible beside the card and the page (task 3.5)', () => {
      for (const bg of [slate[900], slate[950]]) {
        expectVisible(danger, bg)
        expectVisible(warning, bg)
      }
    })
  })

  describe(`${theme}: sticky notes`, () => {
    // Every paper takes slate text except black, which takes light ink text (task 2.8)
    const slatePapers = Object.entries(note).filter(([name]) => name !== 'black')

    it('has the black paper, so the split below is real', () => {
      expect(note.black).toBeDefined()
    })

    for (const [name, paper] of slatePapers) {
      it(`text and controls stay readable on the ${name} paper`, () => {
        // title, body preview, "Untitled", placeholders, the footer, "Saved"
        for (const text of [primary, slate[100], slate[300], slate[400], slate[500]]) expectReadable(text, paper.DEFAULT)
        // the outline Discard / Yes, delete, and the warning icon beside a confirm
        expectReadable(outline.label, paper.DEFAULT)
        expectVisible(outline.border, paper.DEFAULT)
        expectVisible(danger, paper.DEFAULT)
      })
    }

    // Light only: the strip was a text surface until 3.4 took the band off. It is now
    // only the swatch and the list's dot, which dark mode makes a mid-tone instead.
    if (theme === 'light') {
      for (const [name, paper] of slatePapers) {
        it(`dark text stays readable on the ${name} strip`, () => {
          for (const text of [slate[100], slate[300], slate[400], twColors.red[700]]) expectReadable(text, paper.strip)
        })
      }
    }

    it('light text stays readable on the black paper and its strip', () => {
      for (const bg of [note.black.DEFAULT, note.black.strip]) {
        expectReadable(ink.text, bg)
        expectReadable(ink.muted, bg)
        expectReadable(twColors.red[400], bg)  // DANGER_OUTLINE_ON_DARK
      }
    })

    it("the black paper's warning icon and outline stay visible", () => {
      expectVisible(statusDark.danger, note.black.DEFAULT)
      expectVisible(twColors.red[400], note.black.DEFAULT)
    })

    it('the five coloured papers stay distinguishable from each other', () => {
      const coloured = ['yellow', 'green', 'blue', 'pink', 'orange'].map(name => [name, note[name].DEFAULT] as const)
      for (const [i, [a, hexA]] of coloured.entries()) {
        for (const [b, hexB] of coloured.slice(i + 1)) {
          expect(colourDifference(hexA, hexB), `${a} vs ${b}`).toBeGreaterThanOrEqual(DISTINCT)
        }
      }
    })

    it('every paper stands out from the page or has a hairline', () => {
      for (const [name, paper] of Object.entries(note)) {
        if (EDGED[theme].includes(name)) continue
        expect(colourDifference(paper.DEFAULT, slate[950]), `${name} paper on the page`).toBeGreaterThanOrEqual(DISTINCT)
      }
    })
  })
}
