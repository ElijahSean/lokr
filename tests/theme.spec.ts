/**
 * tests/theme.spec.ts — text contrast of the colour tokens (task 3.2)
 *
 * Reads the colours straight from tailwind.config.js and checks each text and
 * background pairing the app uses against WCAG AA (4.5:1 for normal text). If
 * one fails, a token change has made some screen hard to read. Pairs are listed
 * by where they appear, so a failure names the screen to look at.
 */
import { createRequire } from 'node:module'
import { describe, it, expect } from 'vitest'

type Scale = Record<string, string>
interface ThemeColors {
  slate: Scale
  primary: string
  brand: Scale
  accent: Scale
  ink: Scale
  danger: Scale
  warning: Scale
  success: Scale
  note: Record<string, { DEFAULT: string; strip: string }>
}

// tailwind.config.js is CommonJS (module.exports), so load it with require
const require = createRequire(import.meta.url)
const config = require('../tailwind.config.js') as { theme: { extend: { colors: ThemeColors } } }
const { slate, primary, brand, accent, ink, danger, warning, success, note } = config.theme.extend.colors
// Tailwind's default palette, for the stock reds the danger outlines use
const twColors = require('tailwindcss/colors') as { red: Scale }

const WHITE = '#ffffff'
const AA = 4.5
// WCAG 1.4.11 non-text contrast: dots, meter bars, icons and edges (task 3.3)
const GRAPHIC = 3

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
})

describe('light parts (below the top bar)', () => {
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
})

describe('buttons', () => {
  it('white labels stay readable on the graphite button and its hover', () => {
    expectReadable(WHITE, brand[500])
    expectReadable(WHITE, brand[600])
  })

  it('dark labels stay readable on the warm-white pills of the dark parts', () => {
    expectReadable(ink.DEFAULT, ink.text)
    expectReadable(ink.DEFAULT, WHITE)
  })
})

describe('dark parts (unlock screen, top bar, footer)', () => {
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
})

describe('status colours (task 3.3)', () => {
  // Light: dots on chips (slate-800), meter bars on their track (slate-700),
  // icons and error edges on cards and the page. "good" is a graphite dot.
  const light = { page: slate[950], card: slate[900], chip: slate[800], track: slate[700] }
  // Dark: the create-vault strength meter, its bar on the ink-border track
  const dark = { page: ink.DEFAULT, surface: ink.surface, raised: ink.raised, track: ink.border }

  for (const [name, bg] of Object.entries(light)) {
    it(`status dots, bars and icons stay visible on the ${name}`, () => {
      for (const graphic of [danger.DEFAULT, warning.DEFAULT, success.DEFAULT, brand[600]]) {
        expectVisible(graphic, bg)
      }
    })
  }

  for (const [name, bg] of Object.entries(dark)) {
    it(`dark status bars stay visible on the ${name}`, () => {
      for (const graphic of [danger.dark, warning.dark, success.dark, ink.muted]) {
        expectVisible(graphic, bg)
      }
    })
  }

  it('chip labels stay readable on the chip', () => {
    expectReadable(slate[300], slate[800])
  })

  it('the delete confirm outline stays readable on an entry card', () => {
    expectReadable(twColors.red[700], slate[900])  // DANGER_OUTLINE label
    expectVisible(twColors.red[600], slate[900])   // DANGER_OUTLINE border
  })
})

describe('sticky notes', () => {
  // Every paper takes dark slate text except black, which takes light ink text (task 2.8)
  const lightPapers = Object.entries(note).filter(([name]) => name !== 'black')

  it('has the black paper, so the split below is real', () => {
    expect(note.black).toBeDefined()
  })

  for (const [name, paper] of lightPapers) {
    it(`dark text stays readable on the ${name} paper and its strip`, () => {
      // paper: title, body preview, "Untitled" and placeholders, the footer
      for (const text of [slate[100], slate[300], slate[500]]) expectReadable(text, paper.DEFAULT)
      // strip: toolbar buttons and "Saved", plus the danger red of the confirms
      for (const text of [slate[100], slate[300], slate[400], twColors.red[700]]) expectReadable(text, paper.strip)
    })
  }

  it('light text stays readable on the black paper and its strip', () => {
    for (const bg of [note.black.DEFAULT, note.black.strip]) {
      expectReadable(ink.text, bg)
      expectReadable(ink.muted, bg)
      expectReadable(twColors.red[400], bg)  // DANGER_OUTLINE_ON_DARK and the confirm text
    }
  })
})
