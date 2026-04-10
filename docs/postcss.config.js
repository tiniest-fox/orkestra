// Tailwind v4 is handled by the @tailwindcss/vite plugin — no PostCSS plugin needed.
// This file exists to prevent the root postcss.config.js (Tailwind v3) from being
// picked up by Vite when building the docs site.
export default {
  plugins: {},
};
