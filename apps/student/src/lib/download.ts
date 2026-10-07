/** Saves a file the server sent as base64 (a notice's attachment) on the phone. */
export function downloadBase64(fileName: string, base64: string, type: string): void {
  const url = URL.createObjectURL(new Blob([Uint8Array.from(atob(base64), (c) => c.charCodeAt(0))], { type }))
  const a = document.createElement('a')
  a.href = url
  a.download = fileName
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}
