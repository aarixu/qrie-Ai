/**
 * A phone photo of a notebook page, made small enough to send on a school
 * child's data plan: at most 1600 px on its long side, as a JPEG. A page
 * stays readable at that size, and the file lands well under the 5 MB the
 * bucket accepts (0025).
 */
const LONG_SIDE = 1600

export async function shrinkPhoto(file: File): Promise<Blob> {
  let bitmap: ImageBitmap
  try {
    bitmap = await createImageBitmap(file)
  } catch {
    throw new Error('This photo could not be opened. Take it again with the camera.')
  }
  const scale = Math.min(1, LONG_SIDE / Math.max(bitmap.width, bitmap.height))
  const canvas = document.createElement('canvas')
  canvas.width = Math.round(bitmap.width * scale)
  canvas.height = Math.round(bitmap.height * scale)
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('This phone could not prepare the photo.')
  ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height)
  bitmap.close()
  const blob = await new Promise<Blob | null>((resolve) =>
    canvas.toBlob(resolve, 'image/jpeg', 0.8)
  )
  if (!blob) throw new Error('This phone could not prepare the photo.')
  return blob
}
