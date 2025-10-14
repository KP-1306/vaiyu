/** @type {import('tailwindcss').Config} */
export default {
  darkMode: 'class',
  content: [
    './index.html',
    './src/**/*.{ts,tsx}',
  ],
  theme: {
    extend: {
      colors: {
        brand: {
          primary: '#0F62FE', // V (Blue — water, calm intelligence)
          air:     '#00C853', // A (Green — freshness, connection)
          spark:   '#FF3B30', // i (Red — AI spark)
          earth:   '#FFD60A', // y (Yellow — stability)
          space:   '#8E8E93', // u (Grey — awareness)
        },
      },
      boxShadow: {
        glowBlue:   '0 2px 6px rgba(15,98,254,0.45)',
        glowGreen:  '0 2px 6px rgba(0,200,83,0.45)',
        glowRed:    '0 2px 6px rgba(255,59,48,0.45)',
        glowYellow: '0 2px 6px rgba(255,214,10,0.45)',
        glowGrey:   '0 2px 6px rgba(142,142,147,0.45)',
      },
    },
  },
  // If you ever apply classes dynamically (e.g., `shadow-${color}`), uncomment:
  // safelist: [
  //   'shadow-glowBlue','shadow-glowGreen','shadow-glowRed','shadow-glowYellow','shadow-glowGrey',
  //   'text-brand-primary','text-brand-air','text-brand-spark','text-brand-earth','text-brand-space',
  // ],
  plugins: [],
};
