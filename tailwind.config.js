const colors = require('tailwindcss/colors')

/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        // Stone - Warm neutral base
        stone: {
          50: '#fafaf9',
          100: '#f5f5f4',
          200: '#e7e5e4',
          300: '#d6d3d1',
          400: '#a8a29e',
          500: '#78716c',
          600: '#57534e',
          700: '#44403c',
          800: '#292524',
          900: '#1c1917',
        },
        // Accent colors (Tailwind defaults)
        orange: colors.orange,
        purple: colors.purple,
        // Semantic color aliases
        success: colors.emerald,
        warning: colors.amber,
        error: colors.red,
        info: colors.blue,
      },
      fontFamily: {
        sans: ['Geist', 'system-ui', 'sans-serif'],
        heading: ['Geist', 'system-ui', 'sans-serif'],
        mono: ['Geist Mono', 'ui-monospace', 'monospace'],
      },
      borderRadius: {
        'panel': '12px',
        'panel-sm': '8px',
      },
      boxShadow: {
        // Soft, diffuse shadows with multiple layers for a "growing out of background" effect
        'panel': '0px 0px 16px 4px rgb(0 0 0 / 0.1), 0px 0px 2px 1px rgb(0 0 0 / 0.02);',
      },
    },
  },
  plugins: [require("@tailwindcss/typography")],
}
