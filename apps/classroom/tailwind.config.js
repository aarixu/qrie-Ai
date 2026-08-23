/**
 * Design tokens, lifted verbatim from the Stitch design so screens generated
 * there paste in with no translation. This file IS the design system — nothing
 * in the app should hard-code a colour, radius or font.
 *
 * Material 3 naming (surface / on-surface / container) is Stitch's convention;
 * keeping it means a future Stitch export names the same things we do.
 */
/** @type {import('tailwindcss').Config} */
export default {
  darkMode: 'class',
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        primary: '#4648d4',
        'on-primary': '#ffffff',
        'primary-container': '#6063ee',
        'on-primary-container': '#fffbff',
        'primary-fixed': '#e1e0ff',
        'primary-fixed-dim': '#c0c1ff',
        'on-primary-fixed': '#07006c',
        'on-primary-fixed-variant': '#2f2ebe',
        'inverse-primary': '#c0c1ff',
        'surface-tint': '#494bd6',

        secondary: '#855300',
        'on-secondary': '#ffffff',
        'secondary-container': '#fea619',
        'on-secondary-container': '#684000',
        'secondary-fixed': '#ffddb8',
        'secondary-fixed-dim': '#ffb95f',
        'on-secondary-fixed': '#2a1700',
        'on-secondary-fixed-variant': '#653e00',

        tertiary: '#904900',
        'on-tertiary': '#ffffff',
        'tertiary-container': '#b55d00',
        'on-tertiary-container': '#fffbff',
        'tertiary-fixed': '#ffdcc5',
        'tertiary-fixed-dim': '#ffb783',
        'on-tertiary-fixed': '#301400',
        'on-tertiary-fixed-variant': '#703700',

        error: '#ba1a1a',
        'on-error': '#ffffff',
        'error-container': '#ffdad6',
        'on-error-container': '#93000a',

        background: '#f7f9fb',
        'on-background': '#191c1e',
        surface: '#f7f9fb',
        'on-surface': '#191c1e',
        'surface-variant': '#e0e3e5',
        'on-surface-variant': '#464554',
        'surface-bright': '#f7f9fb',
        'surface-dim': '#d8dadc',
        'surface-container-lowest': '#ffffff',
        'surface-container-low': '#f2f4f6',
        'surface-container': '#eceef0',
        'surface-container-high': '#e6e8ea',
        'surface-container-highest': '#e0e3e5',
        'inverse-surface': '#2d3133',
        'inverse-on-surface': '#eff1f3',

        outline: '#767586',
        'outline-variant': '#c7c4d7',

        // The classroom's call-screen palette, copied from Google Meet. Only
        // the in-class screen uses these; every other screen stays light.
        stage: '#202124',
        'stage-surface': '#3c4043',
        'stage-panel': '#2b2d31',
        'stage-ink': '#e8eaed',
        'stage-ink-dim': '#bdc1c6',
        'stage-blue': '#8ab4f8',
        'stage-green': '#34d872',
        'stage-green-container': '#0f5c2e',
        'stage-green-ink': '#7ce7a2',
        'stage-red': '#ea4335',
      },
      borderRadius: {
        DEFAULT: '0.25rem',
        lg: '0.5rem',
        xl: '0.75rem',
        full: '9999px',
      },
      spacing: {
        'base-unit': '8px',
        'stack-sm': '12px',
        'stack-md': '24px',
        'stack-lg': '48px',
        gutter: '16px',
        'margin-desktop': '32px',
        'margin-mobile': '16px',
        'card-padding': '24px',
      },
      fontFamily: {
        'headline-xl': ['Quicksand', 'system-ui', 'sans-serif'],
        'headline-lg': ['Quicksand', 'system-ui', 'sans-serif'],
        'headline-lg-mobile': ['Quicksand', 'system-ui', 'sans-serif'],
        'headline-md': ['Quicksand', 'system-ui', 'sans-serif'],
        'body-lg': ['Lexend', 'system-ui', 'sans-serif'],
        'body-md': ['Lexend', 'system-ui', 'sans-serif'],
        'label-md': ['Lexend', 'system-ui', 'sans-serif'],
        'label-sm': ['Lexend', 'system-ui', 'sans-serif'],
      },
      fontSize: {
        'headline-xl': ['40px', { lineHeight: '48px', letterSpacing: '-0.02em', fontWeight: '700' }],
        'headline-lg': ['32px', { lineHeight: '40px', fontWeight: '700' }],
        'headline-lg-mobile': ['28px', { lineHeight: '34px', fontWeight: '700' }],
        'headline-md': ['24px', { lineHeight: '32px', fontWeight: '600' }],
        'body-lg': ['18px', { lineHeight: '28px', fontWeight: '400' }],
        'body-md': ['16px', { lineHeight: '24px', fontWeight: '400' }],
        'label-md': ['14px', { lineHeight: '20px', fontWeight: '500' }],
        'label-sm': ['12px', { lineHeight: '16px', fontWeight: '600' }],
      },
    },
  },
  plugins: [],
};
