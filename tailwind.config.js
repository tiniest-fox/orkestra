const colors = require('tailwindcss/colors')

/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./service.html",
    "./src/**/*.{js,ts,jsx,tsx}",
    "./.storybook/**/*.{ts,tsx}",
  ],
  // Use media query strategy so dark: variants respond to the OS color scheme.
  // Forge design tokens use CSS variables for automatic dark mode; dark: variants
  // are used only for standard Tailwind palette colors (stone, amber, purple) in
  // taskStateColors.ts and stageColors.ts.
  darkMode: 'media',
  theme: {
    extend: {
      colors: {
        // Backgrounds — reference CSS variables so light/dark values flip automatically
        canvas: 'var(--forge-canvas)',
        surface: 'var(--forge-surface)',
        'surface-raised': 'var(--forge-surface-raised)',
        'surface-2': 'var(--forge-surface-2)',
        'surface-3': 'var(--forge-surface-3)',
        'surface-hover': 'var(--forge-surface-hover)',

        // Text
        text: {
          primary: 'var(--forge-text-primary)',
          secondary: 'var(--forge-text-secondary)',
          tertiary: 'var(--forge-text-tertiary)',
          quaternary: 'var(--forge-text-quaternary)',
        },

        // Border
        border: 'var(--forge-border)',

        // Accent (pink-red) — RGB channels for opacity modifier support (bg-accent/8, border-accent/30, etc.)
        accent: {
          DEFAULT: 'rgb(var(--forge-accent) / <alpha-value>)',
          soft: 'var(--forge-accent-soft)',
          hover: 'var(--forge-accent-hover)',
        },

        // Status colors
        // error, info, warning, success use RGB channel format to support opacity modifiers
        status: {
          success: { DEFAULT: 'rgb(var(--forge-status-success) / <alpha-value>)', bg: 'var(--forge-status-success-bg)' },
          error:   { DEFAULT: 'rgb(var(--forge-status-error) / <alpha-value>)', hover: 'var(--forge-status-error-hover)', bg: 'var(--forge-status-error-bg)' },
          warning: { DEFAULT: 'rgb(var(--forge-status-warning) / <alpha-value>)', bg: 'var(--forge-status-warning-bg)' },
          info:    { DEFAULT: 'rgb(var(--forge-status-info) / <alpha-value>)', hover: 'var(--forge-status-info-hover)', bg: 'var(--forge-status-info-bg)' },
          purple:  { DEFAULT: 'var(--forge-status-purple)', bg: 'var(--forge-status-purple-bg)' },
          pink:    { DEFAULT: 'var(--forge-status-pink)', bg: 'var(--forge-status-pink-bg)' },
          cyan:    { DEFAULT: 'var(--forge-status-cyan)', bg: 'var(--forge-status-cyan-bg)' },
          orange:  { DEFAULT: 'var(--forge-status-orange)', bg: 'var(--forge-status-orange-bg)' },
        },

        // Workflow action colors
        // RGB channel format enables opacity modifier syntax (border-violet/40, border-teal/40, border-merge/30)
        // `extend` semantics preserve the default Tailwind violet/teal palette (violet-100, teal-200, etc.)
        violet: { DEFAULT: 'rgb(var(--forge-violet) / <alpha-value>)', hover: 'var(--forge-violet-hover)' },
        teal:   { DEFAULT: 'rgb(var(--forge-teal) / <alpha-value>)', hover: 'var(--forge-teal-hover)' },
        merge:  { DEFAULT: 'rgb(var(--forge-merge) / <alpha-value>)', hover: 'var(--forge-merge-hover)' },

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
        // CSS variables flip between light (diffuse drop shadows) and dark (edge-light ring)
        'panel': 'var(--forge-shadow-panel)',
        'panel-hover': 'var(--forge-shadow-panel-hover)',
        'panel-press': 'var(--forge-shadow-panel-press)',
      },
    },
  },
  plugins: [require("@tailwindcss/typography")],
}
