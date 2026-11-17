import type { Config } from 'tailwindcss';

// Tokens Vice Sunset NUI (fuente: CLAUDE.md sección 3).
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        vice: {
          night: '#2E1A47',
          plum: '#7B2C6F',
          rose: '#E14B7B',
          orange: '#F69259',
          magenta: '#E1307E',
          coral: '#F67E56',
          ink: '#1A0A22',
          text: '#FBF1F5',
          gold: '#FFC857',
          cyan: '#5ED6E0',
          lilac: '#B79CFF',
        },
      },
      fontFamily: {
        display: ['Jost', 'system-ui', 'sans-serif'],
        body: ['Poppins', 'system-ui', 'sans-serif'],
      },
      backgroundImage: {
        'vice-sunset':
          'linear-gradient(180deg, #2E1A47 0%, #7B2C6F 38%, #E14B7B 72%, #F69259 100%)',
        'vice-accent': 'linear-gradient(90deg, #E1307E 0%, #F67E56 100%)',
      },
      backdropBlur: {
        hud: '14px',
      },
      boxShadow: {
        hud: '0 10px 40px rgba(26, 10, 34, 0.45)',
      },
      keyframes: {
        slideUp: {
          from: { transform: 'translateY(100%)' },
          to: { transform: 'translateY(0)' },
        },
        slideInRight: {
          from: { transform: 'translateX(100%)' },
          to: { transform: 'translateX(0)' },
        },
        pulse: {
          '0%, 100%': { opacity: '1' },
          '50%': { opacity: '0.55' },
        },
      },
      animation: {
        'slide-up': 'slideUp 0.28s ease-out both',
        'slide-in-right': 'slideInRight 0.28s ease-out both',
        'vice-pulse': 'pulse 1.6s ease-in-out infinite',
      },
    },
  },
  plugins: [],
} satisfies Config;
