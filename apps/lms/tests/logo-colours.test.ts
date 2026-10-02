import { describe, expect, it } from 'vitest'
import { dominantColours } from '@/lib/logo-colours'

/** RGBA pixels: `n` of each colour, as a canvas would give them. */
function pixels(...runs: [string, number, number?][]): Uint8ClampedArray {
  const out: number[] = []
  for (const [hex, n, alpha = 255] of runs) {
    const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16))
    for (let k = 0; k < n; k++) out.push(r!, g!, b!, alpha)
  }
  return new Uint8ClampedArray(out)
}

const close = (a: string, b: string) =>
  [1, 3, 5].every((i) => Math.abs(parseInt(a.slice(i, i + 2), 16) - parseInt(b.slice(i, i + 2), 16)) <= 24)

describe("a logo's colours", () => {
  it('are its two strongest different hues, most used first', () => {
    const [primary, accent] = dominantColours(pixels(['#0b5fd9', 600], ['#ffc85c', 250], ['#ffffff', 300], ['#111111', 50]))
    expect(close(primary!, '#0b5fd9')).toBe(true)
    expect(close(accent!, '#ffc85c')).toBe(true)
  })

  it('ignore white, black, greys and see-through pixels', () => {
    expect(dominantColours(pixels(['#ffffff', 500], ['#808080', 300], ['#000000', 200], ['#e11d48', 400, 0]))).toEqual([])
  })

  it('give one colour when the logo has one hue', () => {
    const found = dominantColours(pixels(['#15803d', 500], ['#16a34a', 300], ['#ffffff', 200]))
    expect(found).toHaveLength(1)
  })
})
