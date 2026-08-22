/**
 * "Raat ki Kaksha" — the app looks like a real Indian classroom blackboard at
 * night: deep green slate, chalk inks, a wooden tray. One place for every
 * chrome color so the whole product looks like one product. Content never
 * carries colors — canvas tones resolve in @ai-tutor/stage, chrome here.
 */
export const theme = {
  /** Deep green-black slate — unmistakably a blackboard, not "generic dark mode". */
  bg: '#0d1411',
  bgDeep: '#090e0b',
  /** The board itself: slightly greener, with a vignette applied where used. */
  board: 'radial-gradient(120% 100% at 50% 0%, #16221c 0%, #101a15 55%, #0c130f 100%)',
  /** Wooden chalk-tray / frame browns. */
  wood: '#5a4030',
  woodDark: '#3d2b1f',
  woodGrad: 'linear-gradient(180deg, #6b4c38 0%, #533b2a 45%, #3d2b1f 100%)',

  chalk: '#eef1ea',
  chalkDim: '#9fb0a5',
  chalkLine: 'rgba(238,241,234,0.16)',
  /** A piece of yellow chalk — the one accent everything important uses. */
  accent: '#f5c84c',
  accentInk: '#241a04',
  good: '#8fd6a8',
  danger: '#f09a9a',

  surface: 'rgba(238,241,234,0.05)',
  surfaceBorder: 'rgba(238,241,234,0.13)',

  /** Chalk handwriting (Devanagari-capable) for anything "written on the board". */
  fontChalk: "'Kalam', 'Segoe Print', 'Comic Sans MS', cursive",
  /** Warm rounded UI text for buttons, captions, labels. */
  font: "'Baloo 2', 'Segoe UI', system-ui, sans-serif",
} as const;
