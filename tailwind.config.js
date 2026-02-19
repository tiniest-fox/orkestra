const colors = require('tailwindcss/colors')

/** @type {import('tailwindcss').Config} */
export default {
  darkMode: 'media',
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
        // Accent colors — orange shifted toward red, anchored at #F04A00
        orange: {
          50: '#fff5ef',
          100: '#ffe8d9',
          200: '#ffcdb3',
          300: '#ffa87a',
          400: '#ff7a3d',
          500: '#F04A00',
          600: '#cc3d00',
          700: '#a33000',
          800: '#7a2400',
          900: '#521800',
          950: '#2e0d00',
        },
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
        'forge-sans': ['IBM Plex Sans', 'system-ui', '-apple-system', 'sans-serif'],
        'forge-mono': ['IBM Plex Mono', 'SF Mono', 'Cascadia Code', 'monospace'],
      },
      borderRadius: {
        'panel': '12px',
        'panel-sm': '8px',
      },
      boxShadow: {
        // Soft, diffuse shadows with multiple layers for a "growing out of background" effect
        'panel': '0px 0px 16px 4px rgb(0 0 0 / 0.1), 0px 0px 2px 1px rgb(0 0 0 / 0.02)',
        // Elevated: more prominent lift for hover states
        'panel-hover': '0px 2px 24px 6px rgb(0 0 0 / 0.14), 0px 0px 4px 1px rgb(0 0 0 / 0.04)',
        // Pressed: flattened, minimal shadow
        'panel-press': '0px 0px 4px 1px rgb(0 0 0 / 0.06), 0px 0px 1px 0px rgb(0 0 0 / 0.02)',
      },
    },
  },
  plugins: [require("@tailwindcss/typography")],
}
