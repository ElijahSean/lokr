/**
 * tailwind.palette.js — the colours behind the light parts' tokens, light and dark (task 3.1)
 *
 * The one place these hex values live. tailwind.config.js turns each `light`/`dark`
 * pair into a CSS variable that a `prefers-color-scheme: dark` media query swaps,
 * so components keep their class names and the theme follows the system with no
 * JavaScript (and no stored preference: CLAUDE.md, no localStorage).
 * tests/theme.spec.ts reads this file for its contrast checks in both themes.
 *
 * `light` and `dark` must have the same keys. `fixed` holds the colours that are
 * the same in both themes: the dark parts' `ink` (unlock screen, top bar, footer
 * look the same either way), the coral accent and the status `dark` values.
 * Values marked "YV" are youversion.com's own (task 3.2); "derived" were tuned so
 * text keeps WCAG AA contrast.
 */
module.exports = {
  light: {
    // The inverted scale (task 3.2): high numbers = light backgrounds, low = dark text
    slate: {
      50:  '#ffffff',  // unused, kept so the scale has no gap
      100: '#0b1926',  // main text (YV black)
      200: '#232121',  // emphasis text (YV gray-40)
      300: '#393b3d',  // secondary text, monospace pw display (YV --grey)
      400: '#4f4c4c',  // labels (derived)
      500: '#636161',  // muted text, placeholders (YV gray-30)
      600: '#6a6767',  // faintest text, tick marks (derived: YV gray-25 is too faint on light)
      700: '#e4dddb',  // borders, strength-meter track (derived)
      800: '#efe9e7',  // inputs, hover, secondary surfaces (derived)
      900: '#f7f3f2',  // cards (the site's large rounded panels)
      950: '#ffffff',  // page (YV white)
    },
    primary: '#0b1926',  // main text (YV black)
    // Only the two shades in use swap; `label` is the text and spinner on a button
    brand: {
      500:   '#232121',  // button fill (YV gray-40), focus rings
      600:   '#393b3d',  // hover, link text, the "good" strength dot (YV --grey)
      label: '#ffffff',
    },
    // Status colours (task 3.3), for dots, meter bars, icons and thin edges only
    danger:  '#c64c3a',  // = accent.strong, the logo's keyhole
    warning: '#9a6a1a',  // derived ochre (Tailwind's amber-600 is 2.65:1 on inputs)
    success: '#3d7a55',  // derived sage
    // Sticky-note papers (tasks 2.1, 2.8). DEFAULT is the paper; `strip` is now only
    // the swatch and the list's colour dot (3.4 took the band off)
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
  },

  // Dark mode (Elijah, 2026-10-23): the content takes the unlock screen's ink, so
  // the app reads as one dark surface; the scale keeps its meaning (high numbers
  // are surfaces, low numbers text), now dark surfaces under light text
  dark: {
    slate: {
      50:  '#121212',
      100: '#f6efee',  // main text (= ink.text)
      200: '#ebe5e4',  // derived
      300: '#d6d2d1',  // derived
      400: '#bfbdbd',  // = ink.muted
      500: '#aaa7a7',  // derived: YV gray-25 is 3.5:1 on inputs
      600: '#9a9797',  // derived
      700: '#393b3d',  // = ink.border
      800: '#2e2b2b',  // = ink.raised
      900: '#232121',  // = ink.surface
      950: '#121212',  // = ink
    },
    primary: '#f6efee',
    // Warm-white pills with dark labels, like the unlock screen's buttons (Elijah, 2026-10-23)
    brand: {
      500:   '#f6efee',
      600:   '#ffffff',
      label: '#121212',
    },
    danger:  '#e76b4f',  // = danger.dark
    warning: '#d9a441',  // = warning.dark
    success: '#6fbf8a',  // = success.dark
    // Muted dark tints with light text (Elijah, 2026-10-23); the swatch is a
    // mid-tone so the colours still tell apart at dot size
    note: {
      yellow: { DEFAULT: '#36331a', strip: '#857a35' },
      green:  { DEFAULT: '#1c3124', strip: '#4a7d59' },
      blue:   { DEFAULT: '#1a2c3b', strip: '#4a7396' },
      pink:   { DEFAULT: '#3a2130', strip: '#94567c' },
      orange: { DEFAULT: '#3e2617', strip: '#9c6238' },
      white:  { DEFAULT: '#333131', strip: '#d6d2d1' },
      grey:   { DEFAULT: '#2e2b2b', strip: '#6a6767' },
      black:  { DEFAULT: '#232121', strip: '#121212' },
    },
  },

  fixed: {
    // The other brand shades, unused by components today; kept for the scale
    brand: {
      50:  '#f4f1f0',
      100: '#e4dddb',
      200: '#bfbdbd',  // YV gray-20
      300: '#828080',  // YV gray-25
      400: '#636161',  // YV gray-30
      700: '#1a1818',
      800: '#121212',
      900: '#0b0b0b',
    },
    // YouVersion's coral, kept small: focus rings and icons on the dark parts;
    // `strong` for the logo's keyhole
    accent: {
      DEFAULT: '#e76b4f',  // YV --coral
      strong:  '#c64c3a',  // derived
    },
    // The dark parts: the unlock screen and the vault's top bar and footer
    ink: {
      DEFAULT: '#121212',  // page (YV background-color--alternate)
      surface: '#232121',  // cards (YV gray-40)
      raised:  '#2e2b2b',  // inputs and hover on a surface (derived)
      border:  '#393b3d',  // borders (YV --grey)
      text:    '#f6efee',  // main text (YV warm-neutral)
      muted:   '#bfbdbd',  // secondary text (YV gray-20)
      subtle:  '#828080',  // faintest text, on the ink page only (YV gray-25)
    },
    // Status colours on the dark parts (the unlock screen's meter)
    statusDark: {
      danger:  '#e76b4f',  // = accent (YV --coral)
      warning: '#d9a441',  // derived
      success: '#6fbf8a',  // derived
    },
  },
}
