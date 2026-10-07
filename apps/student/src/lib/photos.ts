import { createAvatar } from '@dicebear/core'
import * as lorelei from '@dicebear/lorelei'
import { useQuery } from '@tanstack/react-query'
import { api } from '@/lib/backend'

/**
 * Faces, as in the teacher app (apps/lms/src/lib/photos.ts): the photo the
 * school gave (lms.account_photos), or until then an illustrated face drawn
 * from the person's ID (DiceBear's Lorelei, CC0 artwork).
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

/** This person's photo, if the school has given one and the viewer may see it. */
export function usePhoto(userId: string | undefined): string | null {
  const photo = useQuery({
    queryKey: ['photos', userId ?? ''],
    enabled: !!userId,
    staleTime: 5 * 60_000,
    queryFn: async () => {
      const [p] = await api.accountPhotos([userId!])
      return p ? `data:image/jpeg;base64,${p.base64}` : null
    },
  })
  return photo.data ?? null
}
