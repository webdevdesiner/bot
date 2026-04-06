/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      colors: {
        orion: {
          bg: '#0a0a0c',
          card: '#151518',
          accent: '#22d3ee',
          accentDim: '#0891b2'
        }
      },
      fontFamily: {
        sans: ['Inter', 'system-ui', 'sans-serif']
      },
      boxShadow: {
        neon: '0 0 12px rgba(34, 211, 238, 0.35)'
      }
    }
  },
  plugins: []
};
