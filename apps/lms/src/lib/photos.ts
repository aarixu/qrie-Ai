import { createAvatar } from '@dicebear/core'
import * as lorelei from '@dicebear/lorelei'
import { useQuery } from '@tanstack/react-query'
import { api } from '@/lib/backend'

/**
 * People's faces. A photo is the school's (lms.account_photos); until the
 * school uploads one, a person gets an illustrated face drawn from their ID
 * (DiceBear's Lorelei, CC0 artwork), the same face every time.
 */

const BACKGROUNDS = ['b6e3f4', 'c0aede', 'd1d4f9', 'ffd5dc', 'ffdfbf', 'c7f0d8', 'fde68a', 'bae6fd']
// Skin and hair as children in Indian classrooms have them; no beards.
const SKIN = ['f1c27d', 'e0ac69', 'd4a373', 'c68642', 'a86b3c', '8d5524']
const HAIR = ['0e0e0e', '1f1410', '2c1b18', '3b2219', '4a312c']
const drawn = new Map<string, string>()

/** An illustrated face for `seed` (a user id), as an address an <img> can show. */
export function drawnFace(seed: string): string {
  let uri = drawn.get(seed)
  if (!uri) {
    uri = createAvatar(lorelei, { seed, backgroundColor: BACKGROUNDS, skinColor: SKIN, hairColor: HAIR, beardProbability: 0, radius: 50 }).toDataUri()
    drawn.set(seed, uri)
  }
  return uri
}

/** The photos of these people the viewer may see, by user id, asked for 300 at a time. */
export function usePhotos(userIds: string[]): Map<string, string> {
  const ids = [...new Set(userIds)].sort()
  const photos = useQuery({
    queryKey: ['photos', ids.join(',')],
    enabled: ids.length > 0,
    staleTime: 5 * 60_000,
    queryFn: async () => {
      const out = new Map<string, string>()
      for (let i = 0; i < ids.length; i += 300) {
        for (const p of await api.accountPhotos(ids.slice(i, i + 300))) {
          out.set(p.userId, `data:image/jpeg;base64,${p.base64}`)
        }
      }
      return out
    },
  })
  return photos.data ?? EMPTY
}

const EMPTY = new Map<string, string>()

/**
 * A picture shrunk to a square JPEG of at most 64 KB, as base64 — the only
 * kind lms.set_account_photo keeps. The centre of the picture is kept.
 */
export async function photoForUpload(file: File, size = 256): Promise<string> {
  if (!file.type.startsWith('image/')) throw new Error(`${file.name} is not a picture.`)
  const bitmap = await createImageBitmap(file).catch(() => {
    throw new Error(`${file.name} could not be opened as a picture.`)
  })
  const side = Math.min(bitmap.width, bitmap.height)
  const canvas = document.createElement('canvas')
  canvas.width = size
  canvas.height = size
  const ctx = canvas.getContext('2d')!
  ctx.fillStyle = '#ffffff'
  ctx.fillRect(0, 0, size, size)
  ctx.drawImage(bitmap, (bitmap.width - side) / 2, (bitmap.height - side) / 2, side, side, 0, 0, size, size)
  bitmap.close()
  for (const quality of [0.86, 0.75, 0.62, 0.5]) {
    const data = canvas.toDataURL('image/jpeg', quality).replace(/^data:image\/jpeg;base64,/, '')
    if ((data.length * 3) / 4 <= 64 * 1024) return data
  }
  throw new Error(`${file.name} is too detailed to fit in 64 KB.`)
}
