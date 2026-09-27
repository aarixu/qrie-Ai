/**
 * Saves text as a file on the person's device. A CSV starts with a byte-order
 * mark so Excel reads it as UTF-8 (the import strips the mark again).
 */
export function downloadText(fileName: string, text: string, type = 'text/csv'): void {
  const body = type === 'text/csv' ? `﻿${text}` : text
  const url = URL.createObjectURL(new Blob([body], { type: `${type};charset=utf-8` }))
  const a = document.createElement('a')
  a.href = url
  a.download = fileName
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}
