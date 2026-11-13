/** @type {import('tailwindcss').Config} */
module.exports = {
  darkMode: 'class',
  content: ['./src/**/*.{js,jsx}'],
  theme: {
    extend: {
      colors: {
        burgundy: {
          DEFAULT: '#762F48',
          deep: '#542033',
          soft: '#F4EAEF',
        },
        midnight: {
          DEFAULT: '#17243C',
          light: '#223354',
          deep: '#0F1829',
        },
        warm: '#F5F1EE',
        surface: {
          DEFAULT: 'var(--surface)',
          muted: 'var(--surface-muted)',
          subtle: 'var(--surface-subtle)',
        },
        ink: {
          DEFAULT: 'var(--ink)',
          muted: 'var(--ink-muted)',
        },
        border: 'var(--border-color)',
      },
      fontFamily: {
        sans: ['Inter', 'ui-sans-serif', 'system-ui', '-apple-system', 'Segoe UI', 'sans-serif'],
      },
      boxShadow: {
        card: '0 1px 3px rgba(23, 36, 60, 0.06), 0 1px 2px rgba(23, 36, 60, 0.04)',
        elevated: '0 8px 24px rgba(23, 36, 60, 0.08)',
      },
    },
  },
  plugins: [],
};
