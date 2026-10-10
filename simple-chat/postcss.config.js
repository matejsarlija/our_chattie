// Tailwind v4 ships its PostCSS plugin as a separate package.
// `autoprefixer` is intentionally absent: v4 compiles via Lightning CSS,
// which handles prefixing internally.
module.exports = {
  plugins: {
    '@tailwindcss/postcss': {},
  },
};
