module.exports = {
  content: [
    "./src/**/*.{js,jsx,ts,tsx}",
    "./public/index.html"
  ],
  theme: {
    extend: {
      fontSize: {
        'dynamic': 'var(--text-size)' // Add custom size
      },
      keyframes: {
        scrollBorder: {
          '0%': { backgroundPosition: '0% 0%' },
          '100%': { backgroundPosition: '0% 100%' },
        },
      },
      animation: {
        scrollBorder: 'scrollBorder 2s linear infinite',
      },
    },
  },
  plugins: [],
}