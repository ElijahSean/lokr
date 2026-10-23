const plugin = require('tailwindcss/plugin')
const { light, dark, fixed } = require('./tailwind.palette.js')

// Dark mode (task 3.1): every colour in the palette's `light`/`dark` pair becomes a
// CSS variable, `--c-slate-100` and so on, holding "r g b" so Tailwind's opacity
// modifiers still work. The plugin below writes the light values on :root and the
// dark ones under prefers-color-scheme: dark, so the theme comes from CSS alone:
// no flash on load, no stored preference, and a live system switch just repaints.
function hexToRgb(hex) {
  return [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16)).join(' ')
}

// { slate: { 100: '#..' } } → class values { slate: { 100: 'rgb(var(--c-slate-100) / <alpha-value>)' } }
// and variables { '--c-slate-100': '11 25 38' }. DEFAULT drops out of the name.
function toVariables(group, path = []) {
  const classes = {}
  const vars = {}
  for (const [key, value] of Object.entries(group)) {
    const name = [...path, key].filter(part => part !== 'DEFAULT').join('-')
    if (typeof value === 'string') {
      classes[key] = `rgb(var(--c-${name}) / <alpha-value>)`
      vars[`--c-${name}`] = hexToRgb(value)
    } else {
      const inner = toVariables(value, [...path, key])
      classes[key] = inner.classes
      Object.assign(vars, inner.vars)
    }
  }
  return { classes, vars }
}

const themed = toVariables(light)
const darkVars = toVariables(dark).vars

/** @type {import('tailwindcss').Config} */
module.exports = {
  // Only include CSS for classes actually used in source files (tree-shaking)
  content: [
    './app/**/*.{ts,tsx}',
    './components/**/*.{ts,tsx}',
    './hooks/**/*.{ts,tsx}',
  ],
  // `dark:` follows the system setting, the same media query as the variables;
  // used only for the few dark-only touches (hairlines, the notes' hovers and lines)
  darkMode: 'media',
  theme: {
    extend: {
      // YouVersion colour theme (task 3.2) with dark values (task 3.1). The hex
      // values and their notes live in tailwind.palette.js; tests/theme.spec.ts
      // checks every text/background pairing in both themes (WCAG AA, 4.5:1).
      colors: {
        // Light parts (everything below the vault's top bar). The scale stays
        // inverted: high numbers = light backgrounds, low numbers = dark text
        // (dark mode keeps the meaning: high = surfaces, low = text).
        slate: themed.classes.slate,
        primary: themed.classes.primary,
        // Buttons and active states: graphite on light, warm-white pills in dark mode.
        // The name stays `brand` so the existing classes keep working.
        brand: { ...fixed.brand, ...themed.classes.brand },
        accent: fixed.accent,
        // Dark parts: the unlock screen and the vault's top bar and footer. Kept
        // apart from `slate`, whose inverted names would paint light-on-light there,
        // and the same in both themes.
        ink: fixed.ink,
        // Status colours (task 3.3): dots, meter bars, icons and thin edges only,
        // never a fill or text (WCAG's 3:1 for graphics). DEFAULT swaps with the
        // theme; `dark` is the unlock screen's, fixed.
        danger:  { DEFAULT: themed.classes.danger,  dark: fixed.statusDark.danger },
        warning: { DEFAULT: themed.classes.warning, dark: fixed.statusDark.warning },
        success: { DEFAULT: themed.classes.success, dark: fixed.statusDark.success },
        // Sticky-note papers (tasks 2.1, 2.8): muted dark tints in dark mode
        note: themed.classes.note,
      },
      // System fonts only (task 3.2): youversion.com's Aktiv Grotesk and Denton are
      // licensed, and loading any font from the web would be a network call.
      // `serif` is the italic accent, after the site's "Faith in *Real Life*".
      fontFamily: {
        sans: ['"Segoe UI"', 'system-ui', '-apple-system', 'Roboto', '"Helvetica Neue"', 'Arial', 'sans-serif'],
        serif: ['Georgia', 'Cambria', '"Times New Roman"', 'serif'],
      },
      // Notebook-paper ruled lines for lined sticky notes (task 2.1). The spacing
      // matches the text's line height (leading-7 in the open note, leading-4
      // on cards) so text sits on the lines; used with bg-local so they scroll.
      backgroundImage: {
        'notebook-lines':
          'repeating-linear-gradient(to bottom, transparent 0, transparent calc(1.75rem - 1px), rgb(0 0 0 / 0.14) calc(1.75rem - 1px), rgb(0 0 0 / 0.14) 1.75rem)',
        'notebook-lines-sm':
          'repeating-linear-gradient(to bottom, transparent 0, transparent calc(1rem - 1px), rgb(0 0 0 / 0.12) calc(1rem - 1px), rgb(0 0 0 / 0.12) 1rem)',
        // The same rulings in white, for the black paper (task 2.8)
        'notebook-lines-light':
          'repeating-linear-gradient(to bottom, transparent 0, transparent calc(1.75rem - 1px), rgb(255 255 255 / 0.14) calc(1.75rem - 1px), rgb(255 255 255 / 0.14) 1.75rem)',
        'notebook-lines-light-sm':
          'repeating-linear-gradient(to bottom, transparent 0, transparent calc(1rem - 1px), rgb(255 255 255 / 0.12) calc(1rem - 1px), rgb(255 255 255 / 0.12) 1rem)',
      },
      // Subtle animation for loading spinner and transitions
      animation: {
        'spin-slow': 'spin 2s linear infinite',
        'fade-in': 'fadeIn 0.3s ease-in-out',
      },
      keyframes: {
        fadeIn: {
          '0%': { opacity: '0', transform: 'translateY(4px)' },
          '100%': { opacity: '1', transform: 'translateY(0)' },
        },
      },
    },
  },
  plugins: [
    // The theme's variables, and `color-scheme` so native controls (scrollbars,
    // the file input, autofill) follow the system too
    plugin(({ addBase }) => {
      addBase({
        ':root': { ...themed.vars, colorScheme: 'light dark' },
        '@media (prefers-color-scheme: dark)': { ':root': darkVars },
      })
    }),
  ],
}
