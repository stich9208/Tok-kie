/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    "./app/**/*.{js,ts,jsx,tsx,mdx}",
    "./components/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        canvas: 'var(--canvas)',
        'surface-nav': 'var(--surface-nav)',
        'surface-card': 'var(--surface-card)',
        'surface-card-hover': 'var(--surface-card-hover)',
        'surface-container': 'var(--surface-container)',
        'surface-border': 'var(--surface-border)',
        'surface-border-light': 'var(--surface-border-light)',
        'text-primary': 'var(--text-primary)',
        'text-secondary': 'var(--text-secondary)',
        'mint-accent': 'var(--mint-accent)',
        'mint-bg': 'var(--mint-bg)',
        'lavender-accent': 'var(--lavender-accent)',
        'lavender-bg': 'var(--lavender-bg)',
        'amber-accent': 'var(--amber-accent)',
        'amber-bg': 'var(--amber-bg)',
        'pink-accent': 'var(--pink-accent)',
        'pink-bg': 'var(--pink-bg)',
      },
      fontFamily: {
        serif: ['var(--font-playfair)', 'Georgia', 'serif'],
        sans: ['var(--font-sora)', 'system-ui', 'sans-serif'],
      },
      borderRadius: {
        '2xl': '1.25rem',
        '3xl': '1.5rem',
      }
    },
  },
  plugins: [],
}
