/**
 * The one place the theme decision is made and applied.
 *
 * `system` follows the OS live; an explicit choice wins over it. Applying means
 * two things and both matter: the `dark` class on <html> (every token in
 * theme.css keys off it) and the browser-chrome theme-color meta, because an
 * app that goes dark while the address bar stays white looks broken, not dark.
 *
 * index.html runs a tiny inline copy of this logic before first paint — a
 * dark-theme student must never see a white flash. Keep the two in step.
 */

export type Theme = 'system' | 'light' | 'dark';

/**
 * The chrome colours, matching --c-background in theme.css EXACTLY — Riso
 * paper #FAF7F0 in the light room, #141318 in the dark. These predated even
 * the amber palette once (#f7f9fb/#101418), and because applyTheme re-stamps
 * the theme-color meta on every load, the stale pair silently overwrote the
 * correct values index.html and the manifest carried. If theme.css moves,
 * this moves in the same commit or the address bar disagrees with the page.
 */
const CHROME = { light: '#faf7f0', dark: '#141318' } as const;

export const isDark = (theme: Theme): boolean =>
  theme === 'dark' ||
  (theme === 'system' &&
    typeof matchMedia === 'function' &&
    matchMedia('(prefers-color-scheme: dark)').matches);

export function applyTheme(theme: Theme): void {
  const dark = isDark(theme);
  document.documentElement.classList.toggle('dark', dark);
  document
    .querySelector('meta[name="theme-color"]')
    ?.setAttribute('content', dark ? CHROME.dark : CHROME.light);
}

/**
 * Keep the document in step with a preference, including OS flips while the
 * app is open when the preference is `system`. Returns the undo.
 */
export function watchTheme(theme: Theme): () => void {
  applyTheme(theme);
  if (theme !== 'system' || typeof matchMedia !== 'function') return () => {};
  const query = matchMedia('(prefers-color-scheme: dark)');
  const onFlip = () => applyTheme(theme);
  query.addEventListener('change', onFlip);
  return () => query.removeEventListener('change', onFlip);
}
