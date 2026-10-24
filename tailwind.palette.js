/**
 * tailwind.palette.js — SPACED-inspired light and dark colours (task 3.6)
 *
 * The one place application theme hex values live. tailwind.config.js turns
 * each `light`/`dark` pair into CSS variables selected by the root theme class,
 * which app/layout.tsx renders from the persistent allowlisted preference.
 *
 * Published SPACED anchors from the reference supplied by Elijah:
 * #2D2E32 charcoal, #F4F4F4 matte white, #9F9FA0 mid grey,
 * #D1D1D1 light grey, #368CDD blue, #587499 muted blue and #D4E2EE pale blue.
 * Other values below are derived for hierarchy, interaction or WCAG contrast.
 * `light` and `dark` must expose the same keys; tests/theme.spec.ts enforces it.
 */
module.exports = {
  light: {
    // Inverted for compatibility: low numbers are text, high numbers surfaces.
    slate: {
      50:  '#FFFFFF',
      100: '#17181C', // derived near-black main text
      200: '#2D2E32', // SPACED charcoal
      300: '#45474D', // derived secondary text
      400: '#555860', // derived labels
      500: '#5F6269', // derived muted text
      600: '#65686F', // derived faint text; 4.55:1 on the raised surface
      700: '#D1D1D1', // SPACED light grey border
      800: '#E7E8EA', // derived raised/input surface
      900: '#FFFFFF', // matte card
      950: '#F4F4F4', // SPACED matte-white page
    },
    primary: '#17181C',
    brand: {
      500:   '#256AA9', // darker derivation of SPACED blue; 5.66:1 with white
      600:   '#1D568A', // derived hover/link blue
      label: '#FFFFFF',
    },
    // Semantic status colours stay separate from the blue brand.
    danger:  '#B84350',
    warning: '#8A6415',
    success: '#397556',
    // Coloured papers remain functional content colours. The neutral papers
    // move onto the SPACED palette; `strip` also colours swatches/list dots.
    note: {
      yellow: { DEFAULT: '#fef9c3', strip: '#fef08a' },
      green:  { DEFAULT: '#dcfce7', strip: '#bbf7d0' },
      blue:   { DEFAULT: '#D4E2EE', strip: '#bae6fd' },
      pink:   { DEFAULT: '#fce7f3', strip: '#fbcfe8' },
      orange: { DEFAULT: '#ffedd5', strip: '#fed7aa' },
      white:  { DEFAULT: '#FFFFFF', strip: '#F4F4F4' },
      grey:   { DEFAULT: '#E7E8EA', strip: '#DADBDD' },
      black:  { DEFAULT: '#2D2E32', strip: '#0F1013' },
    },
    // The unlock screen, top bar and footer follow the selected theme too.
    shell: {
      DEFAULT: '#F4F4F4',
      surface: '#FFFFFF',
      raised:  '#E7E8EA',
      border:  '#D1D1D1',
      text:    '#17181C',
      muted:   '#555860',
      subtle:  '#65686F',
    },
  },

  dark: {
    slate: {
      50:  '#0F1013',
      100: '#F4F4F4',
      200: '#E7E8EA',
      300: '#D1D1D1',
      400: '#C0C1C4',
      500: '#B2B3B7',
      600: '#A8A9AD', // derived faint text; 4.77:1 on the raised surface
      700: '#45474D',
      800: '#393B41',
      900: '#2D2E32', // SPACED charcoal card
      950: '#0F1013', // derived glossy-black page
    },
    primary: '#F4F4F4',
    brand: {
      500:   '#368CDD', // SPACED blue; 5.39:1 with the dark label
      600:   '#64AAEC', // derived hover/link blue; 4.53:1 on raised surfaces
      label: '#0F1013',
    },
    danger:  '#F06B78',
    warning: '#E0AA46',
    success: '#72C58E',
    note: {
      yellow: { DEFAULT: '#36331a', strip: '#857a35' },
      green:  { DEFAULT: '#1c3124', strip: '#4a7d59' },
      blue:   { DEFAULT: '#1a2c3b', strip: '#4a7396' },
      pink:   { DEFAULT: '#3a2130', strip: '#94567c' },
      orange: { DEFAULT: '#3e2617', strip: '#9c6238' },
      white:  { DEFAULT: '#31343A', strip: '#D1D1D1' },
      grey:   { DEFAULT: '#292B30', strip: '#9F9FA0' },
      black:  { DEFAULT: '#202226', strip: '#0F1013' },
    },
    shell: {
      DEFAULT: '#0F1013',
      surface: '#2D2E32',
      raised:  '#393B41',
      border:  '#555860',
      text:    '#F4F4F4',
      muted:   '#D1D1D1',
      subtle:  '#A8A9AD',
    },
  },

  fixed: {
    // Remaining brand steps expose the other published SPACED blues/greys.
    brand: {
      50:  '#F4F4F4',
      100: '#D4E2EE',
      200: '#D1D1D1',
      300: '#9F9FA0',
      400: '#587499',
      700: '#1D568A',
      800: '#153F65',
      900: '#0D283F',
    },
    accent: {
      DEFAULT: '#368CDD', // SPACED blue
      strong:  '#256AA9', // accessible derived blue
    },
    // Fixed dark-paper colours. Black notes use these in either app theme,
    // so they must not swap with the application shell.
    ink: {
      DEFAULT: '#0F1013',
      surface: '#2D2E32',
      raised:  '#393B41',
      border:  '#555860',
      text:    '#F4F4F4',
      muted:   '#D1D1D1',
      subtle:  '#9F9FA0',
    },
    // Fixed bright variants used on the black paper and other always-dark areas.
    statusDark: {
      danger:  '#FF8996',
      warning: '#E0AA46',
      success: '#72C58E',
    },
  },
}
