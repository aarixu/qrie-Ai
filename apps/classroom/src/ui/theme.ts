/**
 * Design language copied from the most established consumer-learning app
 * pattern (Duolingo-style): light surfaces, saturated brand colors, chunky
 * "pressable" buttons with a hard bottom shadow, bold rounded type (Nunito),
 * 2px card borders. One place for every chrome color so the whole product
 * looks like one product; canvas tones resolve in @ai-tutor/stage.
 */
export const theme = {
  bg: '#ffffff',
  bgSoft: '#f7f7f7',
  border: '#e5e5e5',

  text: '#3c3c3c',
  textMuted: '#777777',
  textFaint: '#afafaf',

  green: '#58cc02',
  greenDark: '#58a700',
  blue: '#1cb0f6',
  blueDark: '#1899d6',
  red: '#ff4b4b',
  yellow: '#ffc800',
  purple: '#ce82ff',

  font: "'Nunito', 'Segoe UI', system-ui, sans-serif",
} as const;

/** Duolingo-signature chunky button: solid fill, darker hard bottom shadow, presses down. */
export const chunky = (fill: string, shadow: string) =>
  ({
    border: 'none',
    borderRadius: 14,
    background: fill,
    color: '#ffffff',
    font: `800 15px ${theme.font}`,
    letterSpacing: 0.8,
    textTransform: 'uppercase',
    boxShadow: `0 4px 0 ${shadow}`,
    cursor: 'pointer',
    transition: 'filter 150ms, transform 100ms, box-shadow 100ms',
  }) as const;

/** Secondary button: white, 2px border, gray bold text. */
export const outlined = () =>
  ({
    borderRadius: 14,
    border: `2px solid ${theme.border}`,
    borderBottomWidth: 4,
    background: theme.bg,
    color: theme.textMuted,
    font: `800 15px ${theme.font}`,
    letterSpacing: 0.8,
    textTransform: 'uppercase',
    cursor: 'pointer',
    transition: 'background 150ms',
  }) as const;
