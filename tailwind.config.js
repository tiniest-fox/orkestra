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
        // Sage - Primary accent
        sage: {
          50: '#f6f7f4',
          100: '#e8ebe3',
          200: '#d1d7c7',
          300: '#b5c0a5',
          400: '#9caf88',
          500: '#7d9668',
          600: '#637a52',
          700: '#4f6142',
          800: '#3d4a34',
          900: '#2d3727',
        },
        // Semantic colors
        success: '#4a7c59',
        warning: '#c4a35a',
        error: '#b54a4a',
        info: '#5a8ec4',
        blocked: '#c47a4a',
      },
      fontFamily: {
        sans: ['"Source Sans 3"', 'system-ui', 'sans-serif'],
        heading: ['Geist', '"Source Sans 3"', 'system-ui', 'sans-serif'],
        mono: ['Geist Mono', 'ui-monospace', 'monospace'],
      },
      borderRadius: {
        'panel': '12px',
        'panel-sm': '8px',
      },
      boxShadow: {
        'panel': '0 1px 3px 0 rgb(0 0 0 / 0.08), 0 1px 2px -1px rgb(0 0 0 / 0.08)',
        'panel-elevated': '0 10px 15px -3px rgb(0 0 0 / 0.08), 0 4px 6px -4px rgb(0 0 0 / 0.08)',
      },
    },
  },
  plugins: [require("@tailwindcss/typography")],
}
