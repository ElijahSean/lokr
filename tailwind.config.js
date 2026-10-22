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
      colors: {
        // BibleProject light-cream neutral scale (inverted for light theme).
        // High numbers = light backgrounds; low numbers = dark text.
        // Source: global.css neutral-* tokens from bibleproject.com
        slate: {
          50:  '#f9fafc',  // barely used
          100: '#1b1b1b',  // near-black — primary text (globals.css text-slate-100)
          200: '#2e2e2e',  // very dark — hover-emphasis text
          300: '#424242',  // dark — monospace pw display, secondary button text
          400: '#555555',  // medium-dark — labels, secondary text
          500: '#767676',  // medium — muted text, placeholders (BP neutral-45)
          600: '#909090',  // light-medium — very muted text, footer, tick marks
          700: '#e0dfdf',  // very light — borders, strength-meter track (BP neutral-30)
          800: '#edeceb',  // near-white — input backgrounds, secondary surfaces (BP neutral-20)
          900: '#ffffff',  // white — card surfaces
          950: '#f6f5f4',  // warm cream — page background (BP neutral-10)
        },
        // BP primary text color — replaces hardcoded text-white on content
        primary: '#1b1b1b',
        // BibleProject brand — cyan scale matching the logo gradient (#00c8f8 → #0077a8)
        // Source: --color-brand: #00b3e5 from bp.css
        brand: {
          50:  '#e0f8ff',
          100: '#b3eeff',
          200: '#7de3ff',
          300: '#3dd4f8',
          400: '#0fc4ef',
          500: '#00b3e5',  // BP primary cyan — buttons, active states
          600: '#0090bb',  // hover — matches logo keyhole color
          700: '#006d8f',
          800: '#004a62',
          900: '#002735',
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
