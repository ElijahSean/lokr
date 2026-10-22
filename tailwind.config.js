/** @type {import('tailwindcss').Config} */
module.exports = {
  // Only include CSS for classes actually used in source files (tree-shaking)
  content: [
    './app/**/*.{ts,tsx}',
    './components/**/*.{ts,tsx}',
    './hooks/**/*.{ts,tsx}',
  ],
  theme: {
    extend: {
      // YouVersion colour theme (task 3.2). Values marked "YV" are youversion.com's
      // own CSS variables (--_colors---*, read 2026-10-23); "derived" ones were tuned
      // so text keeps WCAG AA contrast (4.5:1), which tests/theme.spec.ts enforces.
      colors: {
        // Light parts (everything below the vault's top bar). The scale stays
        // inverted: high numbers = light backgrounds, low numbers = dark text.
        // Sticky notes rely on slate-100 staying dark on their pastel paper.
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
        // Buttons and active states on the light parts: neutral graphite, matching
        // the logo tile (Elijah, 2026-10-23, after trying a red and then a coral).
        // The name stays `brand` so the ~70 existing classes keep working. On the
        // dark parts the buttons are warm-white pills (ink.text) instead, since
        // graphite would vanish there.
        brand: {
          50:  '#f4f1f0',
          100: '#e4dddb',
          200: '#bfbdbd',  // YV gray-20
          300: '#828080',  // YV gray-25
          400: '#636161',  // YV gray-30
          500: '#232121',  // button fill (YV gray-40), white label 15.9:1
          600: '#393b3d',  // hover, link text (YV --grey)
          700: '#1a1818',
          800: '#121212',
          900: '#0b0b0b',
        },
        // The one colour left: YouVersion's coral, kept small. DEFAULT for focus
        // rings and icons on the dark parts; `strong` for the logo's keyhole.
        accent: {
          DEFAULT: '#e76b4f',  // YV --coral
          strong:  '#c64c3a',  // derived
        },
        // Dark parts: the unlock screen and the vault's top bar and footer, like
        // youversion.com's dark sections. Kept apart from `slate`, whose inverted
        // names would paint light-on-light here. Task 3.1 extends these for dark mode.
        ink: {
          DEFAULT: '#121212',  // page (YV background-color--alternate)
          surface: '#232121',  // cards (YV gray-40)
          raised:  '#2e2b2b',  // inputs and hover on a surface (derived)
          border:  '#393b3d',  // borders (YV --grey)
          text:    '#f6efee',  // main text (YV warm-neutral)
          muted:   '#bfbdbd',  // secondary text (YV gray-20)
          subtle:  '#828080',  // faintest text, on the ink page only (YV gray-25)
        },
        // Sticky-note paper colours (task 2.1). DEFAULT is the paper, `strip` the
        // slightly darker top band. Values are Tailwind's -100/-200 shades, named
        // here so dark mode (task 3.1) can retune every note in one place.
        note: {
          yellow: { DEFAULT: '#fef9c3', strip: '#fef08a' },
          green:  { DEFAULT: '#dcfce7', strip: '#bbf7d0' },
          blue:   { DEFAULT: '#e0f2fe', strip: '#bae6fd' },
          pink:   { DEFAULT: '#fce7f3', strip: '#fbcfe8' },
          orange: { DEFAULT: '#ffedd5', strip: '#fed7aa' },
        },
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
  plugins: [],
}
