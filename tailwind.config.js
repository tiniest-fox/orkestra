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
        // Backgrounds
        canvas: '#FAF8FC',            // page background (was --canvas)
        surface: '#FFFFFF',            // card/panel bg
        'surface-raised': '#FEFCFA',  // elevated surface
        'surface-2': '#F4F0F8',       // elevated panel bg (was --surface-2)
        'surface-3': '#DDD7E4',       // pressed/active surface (was --surface-3)
        'surface-hover': '#F5F2F8',   // hover surface (was --surface-hover)

        // Text
        text: {
          primary: '#1C1820',          // was --text-0
          secondary: '#5A5068',        // was --text-1
          tertiary: '#7A7288',         // was --text-2
          quaternary: '#9E96AC',       // was --text-3
        },

        // Border
        border: '#E4DFE9',             // was --border

        // Accent (pink-red, was --accent)
        accent: {
          DEFAULT: '#E83558',
          soft: 'rgba(232, 53, 88, 0.08)',
          hover: '#D42B4C',
        },

        // Status colors
        status: {
          success: { DEFAULT: '#16A34A', bg: 'rgba(22, 163, 74, 0.07)' },
          error:   { DEFAULT: '#DC2626', bg: 'rgba(220, 38, 38, 0.06)' },
          warning: { DEFAULT: '#D97706', bg: '#fef3c7' },
          info:    { DEFAULT: '#2563EB', bg: 'rgba(37, 99, 235, 0.06)' },
          purple:  { DEFAULT: '#9333ea', bg: '#f3e8ff' },
          pink:    { DEFAULT: '#db2777', bg: '#fce7f3' },
          cyan:    { DEFAULT: '#0891b2', bg: '#cffafe' },
          orange:  { DEFAULT: '#ea580c', bg: '#ffedd5' },
        },

        // Keep standard Tailwind stone palette for one-off use
        stone: colors.stone,
        purple: colors.purple,
      },
      fontFamily: {
        sans: ['IBM Plex Sans', 'system-ui', '-apple-system', 'sans-serif'],
        mono: ['IBM Plex Mono', 'SF Mono', 'Cascadia Code', 'monospace'],
      },
      fontSize: {
        // Typography scale — IBM Plex Mono/Sans, size + line-height paired
        'forge-mono-sm':    ['11px', { lineHeight: '16px' }],  // tool calls, script output
        'forge-mono-md':    ['12px', { lineHeight: '18px' }],  // diff lines, code content
        'forge-mono-label': ['10px', { lineHeight: '14px' }],  // structural labels, dividers
        'forge-body':       ['13px', { lineHeight: '20px' }],  // thinking, assistant prose
        'forge-body-md':    ['14px', { lineHeight: '20px' }],  // prose h2, slightly above body
        'forge-body-lg':    ['15px', { lineHeight: '22px' }],  // prose h1, top of heading scale
      },
      borderRadius: {
        'panel': '12px',
        'panel-sm': '8px',
      },
      animation: {
        'drawer-in': 'drawer-in 180ms ease-out both',
      },
      keyframes: {
        'drawer-in': {
          from: { transform: 'translateX(100%)' },
          to: { transform: 'translateX(0)' },
        },
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
