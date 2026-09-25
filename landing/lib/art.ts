/**
 * EVERY PICTURE ON THIS SITE, IN ONE PLACE, WITH ITS REAL SIZE.
 *
 * These used to be nine 1.5 MB PNG URLs pasted across four page files, pointing
 * at a blob store nothing in this repo controls. 13.4 MB on one page, and a
 * single point of failure for the logo and every illustration at once.
 * `tools/bin/fetch-landing-art.mjs` brought them home as WebP: 736 KB, 95%
 * smaller, and ours.
 *
 * WHY THE DIMENSIONS ARE HERE. An <img> without width and height has no shape
 * until its bytes arrive, so the browser lays the page out at zero height and
 * then jumps it when each picture lands. On a slow connection — the one this
 * product is for — that is the whole page moving under a thumb. With both
 * attributes the browser reserves the box from the first paint. They are the
 * INTRINSIC size, not the drawn size; CSS still decides how big it looks.
 */
export interface Art {
  src: string
  w: number
  h: number
}

const art = (name: string, w: number, h: number): Art => ({ src: `/art/${name}.webp`, w, h })

export const ART = {
  /**
   * Aarav's mark, from docs/brand/qrie-logo.png. `logoLight` is the SAME
   * picture: the old pair had a separately lightened copy for the ink footer,
   * and this one needs none — the amber carries 11.2:1 there. The name stays
   * so no page has to change.
   */
  logo: art('logo', 256, 246),
  logoLight: art('logo-light', 256, 246),
  hero: art('hero', 1000, 667),
  desk: art('desk', 900, 600),
  teacher: art('teacher', 900, 576),
  learner: art('learner', 900, 576),
  focus: art('focus', 900, 576),
  hand: art('hand', 900, 576),
  students: art('students', 900, 576),
  prizeCash: art('prize-cash', 400, 400),
  prizeConsole: art('prize-console', 400, 400),
  prizePhone: art('prize-phone', 400, 400),
} as const

/**
 * The attributes an <img> needs to not cost more than it is worth.
 *
 * `eager` is for the ONE picture above the fold. Everything else waits until it
 * is nearly on screen, which is the difference between a landing page that
 * downloads 736 KB before it shows anything and one that shows the hero and
 * fetches the rest as somebody scrolls. Marking everything eager, or nothing,
 * are both wrong in the same way: lazy-loading the hero delays the only image
 * that is definitely seen.
 */
export const imgProps = (a: Art, alt: string, eager = false) => ({
  src: a.src,
  alt,
  width: a.w,
  height: a.h,
  loading: eager ? ('eager' as const) : ('lazy' as const),
  decoding: eager ? ('sync' as const) : ('async' as const),
  ...(eager ? { fetchPriority: 'high' as const } : {}),
})
