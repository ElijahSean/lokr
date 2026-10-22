// PostCSS processes CSS files before the browser sees them.
// Tailwind CSS uses PostCSS to generate utility classes from your source files.
module.exports = {
  plugins: {
    tailwindcss: {},   // Generates Tailwind utility classes
    autoprefixer: {},  // Adds vendor prefixes for cross-browser compatibility
  },
}
