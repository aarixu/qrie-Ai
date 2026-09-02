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
        primary: 'rgb(var(--c-primary) / <alpha-value>)',
        'on-primary': 'rgb(var(--c-on-primary) / <alpha-value>)',
        'primary-container': 'rgb(var(--c-primary-container) / <alpha-value>)',
        'on-primary-container': 'rgb(var(--c-on-primary-container) / <alpha-value>)',
        'primary-fixed': 'rgb(var(--c-primary-fixed) / <alpha-value>)',
        'primary-fixed-dim': 'rgb(var(--c-primary-fixed-dim) / <alpha-value>)',
        'on-primary-fixed': 'rgb(var(--c-on-primary-fixed) / <alpha-value>)',
        'on-primary-fixed-variant': 'rgb(var(--c-on-primary-fixed-variant) / <alpha-value>)',
        'inverse-primary': 'rgb(var(--c-inverse-primary) / <alpha-value>)',
        'surface-tint': 'rgb(var(--c-surface-tint) / <alpha-value>)',

        secondary: 'rgb(var(--c-secondary) / <alpha-value>)',
        'on-secondary': 'rgb(var(--c-on-secondary) / <alpha-value>)',
        'secondary-container': 'rgb(var(--c-secondary-container) / <alpha-value>)',
        'on-secondary-container': 'rgb(var(--c-on-secondary-container) / <alpha-value>)',
        'secondary-fixed': 'rgb(var(--c-secondary-fixed) / <alpha-value>)',
        'secondary-fixed-dim': 'rgb(var(--c-secondary-fixed-dim) / <alpha-value>)',
        'on-secondary-fixed': 'rgb(var(--c-on-secondary-fixed) / <alpha-value>)',
        'on-secondary-fixed-variant': 'rgb(var(--c-on-secondary-fixed-variant) / <alpha-value>)',

        tertiary: 'rgb(var(--c-tertiary) / <alpha-value>)',
        'on-tertiary': 'rgb(var(--c-on-tertiary) / <alpha-value>)',
        'tertiary-container': 'rgb(var(--c-tertiary-container) / <alpha-value>)',
        'on-tertiary-container': 'rgb(var(--c-on-tertiary-container) / <alpha-value>)',
        'tertiary-fixed': 'rgb(var(--c-tertiary-fixed) / <alpha-value>)',
        'tertiary-fixed-dim': 'rgb(var(--c-tertiary-fixed-dim) / <alpha-value>)',
        'on-tertiary-fixed': 'rgb(var(--c-on-tertiary-fixed) / <alpha-value>)',
        'on-tertiary-fixed-variant': 'rgb(var(--c-on-tertiary-fixed-variant) / <alpha-value>)',

        error: 'rgb(var(--c-error) / <alpha-value>)',
        'on-error': 'rgb(var(--c-on-error) / <alpha-value>)',
        'error-container': 'rgb(var(--c-error-container) / <alpha-value>)',
        'on-error-container': 'rgb(var(--c-on-error-container) / <alpha-value>)',

        background: 'rgb(var(--c-background) / <alpha-value>)',
        'on-background': 'rgb(var(--c-on-background) / <alpha-value>)',
        surface: 'rgb(var(--c-surface) / <alpha-value>)',
        'on-surface': 'rgb(var(--c-on-surface) / <alpha-value>)',
        'surface-variant': 'rgb(var(--c-surface-variant) / <alpha-value>)',
        'on-surface-variant': 'rgb(var(--c-on-surface-variant) / <alpha-value>)',
        'surface-bright': 'rgb(var(--c-surface-bright) / <alpha-value>)',
        'surface-dim': 'rgb(var(--c-surface-dim) / <alpha-value>)',
        'surface-container-lowest': 'rgb(var(--c-surface-container-lowest) / <alpha-value>)',
        'surface-container-low': 'rgb(var(--c-surface-container-low) / <alpha-value>)',
        'surface-container': 'rgb(var(--c-surface-container) / <alpha-value>)',
        'surface-container-high': 'rgb(var(--c-surface-container-high) / <alpha-value>)',
        'surface-container-highest': 'rgb(var(--c-surface-container-highest) / <alpha-value>)',
        'inverse-surface': 'rgb(var(--c-inverse-surface) / <alpha-value>)',
        'inverse-on-surface': 'rgb(var(--c-inverse-on-surface) / <alpha-value>)',

        outline: 'rgb(var(--c-outline) / <alpha-value>)',
        'outline-variant': 'rgb(var(--c-outline-variant) / <alpha-value>)',

        // The classroom's call-screen palette, copied from Google Meet.
        //
        // Deliberately NOT theme variables: the stage is a dark room in both
        // themes (a lesson board is a lit screen in a dark auditorium, the way
        // Meet presents a shared screen), so an accent that flipped with the
        // app theme would be the one thing on it that changed for no reason.
        //
        // The ROOM stays Meet: a dark auditorium with a lit board, which was
        // decided and is not being reopened. What changed is the ACCENT — the
        // thing you press in it is the brand's amber rather than a borrowed
        // indigo, so the room belongs to this product while still reading as a
        // video call. Warm greys for the same reason the app's are warm.
        stage: '#1c1a17',
        'stage-primary': '#f3b84d',
        'on-stage-primary': '#2a1d02',
        'stage-primary-edge': '#d99f33',
        'stage-surface': '#3d382f',
        'stage-panel': '#2a2620',
        'stage-ink': '#ede6da',
        'stage-ink-dim': '#c2b8a6',
        'stage-blue': '#f5c260',
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
        'headline-xl': ['Quicksand Variable', 'Quicksand', 'Baloo 2', 'system-ui', 'sans-serif'],
        'headline-lg': ['Quicksand Variable', 'Quicksand', 'Baloo 2', 'system-ui', 'sans-serif'],
        'headline-lg-mobile': ['Quicksand Variable', 'Quicksand', 'Baloo 2', 'system-ui', 'sans-serif'],
        'headline-md': ['Quicksand Variable', 'Quicksand', 'Baloo 2', 'system-ui', 'sans-serif'],
        'body-lg': ['Lexend Variable', 'Lexend', 'Mukta', 'system-ui', 'sans-serif'],
        'body-md': ['Lexend Variable', 'Lexend', 'Mukta', 'system-ui', 'sans-serif'],
        'label-md': ['Lexend Variable', 'Lexend', 'Mukta', 'system-ui', 'sans-serif'],
        'label-sm': ['Lexend Variable', 'Lexend', 'Mukta', 'system-ui', 'sans-serif'],
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
