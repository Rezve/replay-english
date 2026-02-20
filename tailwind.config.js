/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    './index.html',
    './src/renderer/**/*.{ts,tsx}',
  ],
  theme: {
    extend: {
      colors: {
        navy: {
          950: '#060b18',
          900: '#0a1220',
          800: '#0f1e36',
          700: '#162846',
          600: '#1e3457',
          500: '#254268',
        },
      },
    },
  },
  plugins: [],
};
