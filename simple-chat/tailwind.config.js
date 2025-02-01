module.exports = {
  content: [
    "./src/**/*.{js,jsx,ts,tsx}",
    "./public/index.html"
  ],
  theme: {
    extend: {
      fontSize: {
        'dynamic': 'var(--text-size)' // Add custom size
      }
    },
  },
  plugins: [],
}