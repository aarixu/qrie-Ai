/**
 * A school's colours, suggested from its logo: the most used hue, and the
 * next most used one that is clearly a different hue. White, black, greys and
 * see-through pixels are not colours here. Only a suggestion — the admin
 * picks.
 */

const BUCKETS = 24 // 15 degrees of hue each
const APART = 45 // degrees between the two colours, at least

function hsl(r: number, g: number, b: number): [number, number, number] {
  const [R, G, B] = [r / 255, g / 255, b / 255]
  const max = Math.max(R, G, B)
  const min = Math.min(R, G, B)
  const l = (max + min) / 2
  if (max === min) return [0, 0, l]
  const d = max - min
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min)
  const h = max === R ? ((G - B) / d + (G < B ? 6 : 0)) * 60 : max === G ? ((B - R) / d + 2) * 60 : ((R - G) / d + 4) * 60
  return [h, s, l]
}

const hex = (n: number) => Math.round(n).toString(16).padStart(2, '0')

/** Up to two #rrggbb colours from RGBA pixels, most used first. */
export function dominantColours(rgba: Uint8ClampedArray): string[] {
  const buckets = Array.from({ length: BUCKETS }, () => ({ n: 0, r: 0, g: 0, b: 0, hue: 0 }))
  let coloured = 0
  for (let i = 0; i + 3 < rgba.length; i += 4) {
    const [r, g, b, a] = [rgba[i]!, rgba[i + 1]!, rgba[i + 2]!, rgba[i + 3]!]
    if (a < 128) continue
    const [h, s, l] = hsl(r, g, b)
    if (s < 0.25 || l > 0.9 || l < 0.1) continue
    const k = buckets[Math.floor(h / (360 / BUCKETS)) % BUCKETS]!
    k.n += 1
    k.r += r
    k.g += g
    k.b += b
    k.hue += h
    coloured += 1
  }
  const ranked = buckets.filter((k) => k.n > 0).sort((a, b) => b.n - a.n)
  if (!ranked.length) return []
  const colour = (k: (typeof ranked)[number]) => `#${hex(k.r / k.n)}${hex(k.g / k.n)}${hex(k.b / k.n)}`
  const first = ranked[0]!
  const firstHue = first.hue / first.n
  const second = ranked.slice(1).find((k) => {
    const d = Math.abs(k.hue / k.n - firstHue) % 360
    return Math.min(d, 360 - d) >= APART && k.n >= coloured * 0.05
  })
  return second ? [colour(first), colour(second)] : [colour(first)]
}

/** The logo at `src` (a data URL), read at 64 × 64 for its colours. */
export async function coloursOfLogo(src: string): Promise<string[]> {
  const img = new Image()
  img.src = src
  await img.decode()
  const canvas = document.createElement('canvas')
  canvas.width = 64
  canvas.height = 64
  const ctx = canvas.getContext('2d')!
  ctx.drawImage(img, 0, 0, 64, 64)
  return dominantColours(ctx.getImageData(0, 0, 64, 64).data)
}
