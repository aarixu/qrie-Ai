/**
 * Saves text as a file on the person's device. A CSV starts with a byte-order
 * mark so Excel reads it as UTF-8 (the import strips the mark again).
 */
export function downloadText(fileName: string, text: string, type = 'text/csv'): void {
  const body = type === 'text/csv' ? `﻿${text}` : text
  save(fileName, new Blob([body], { type: `${type};charset=utf-8` }))
}

/** Saves a file the server sent as base64 (a notice's attachment) on the person's device. */
export function downloadBase64(fileName: string, base64: string, type: string): void {
  save(fileName, new Blob([Uint8Array.from(atob(base64), (c) => c.charCodeAt(0))], { type }))
}

function save(fileName: string, blob: Blob): void {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = fileName
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}
