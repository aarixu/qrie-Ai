import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'

/**
 * THE SCHOOL PORTAL'S EXAMPLE IDS. Written first.
 *
 * The demo school's IDs (DEMO-P1, DEMO-8A-1) are the example only in a build
 * for the demo school, as on the sign-in screen (sign-in-hints.test.tsx). A
 * build for a real school names no ID it did not make.
 */

const roots: Root[] = []
beforeAll(() => {
  ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
})
afterEach(() => {
  for (const root of roots.splice(0)) act(() => root.unmount())
  document.body.innerHTML = ''
})

async function render(mode: 'demo' | 'supabase', which: 'parents' | 'photos'): Promise<void> {
  vi.resetModules()
  vi.doMock('@/lib/backend', () => ({
    backend: { mode },
    api: { studentParents: async () => [], schoolStudents: async () => [], schoolTeachers: async () => [] },
  }))
  vi.doMock('@/features/school/reset-pin', () => ({ ResetPinButton: () => null }))
  const el = document.createElement('div')
  document.body.appendChild(el)
  const root = createRoot(el)
  roots.push(root)
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  const { ParentsCard } = await import('@/features/students/parents')
  const { PhotoUploadButton } = await import('@/features/school/photo-upload')
  await act(async () => {
    root.render(
      <QueryClientProvider client={client}>
        {which === 'parents' ? <ParentsCard studentId='s1' loginId='ABC-8A-1' name='Riya' /> : <PhotoUploadButton />}
      </QueryClientProvider>
    )
  })
  const open = [...document.querySelectorAll('button')].find((b) =>
    which === 'parents' ? b.textContent?.includes('Link a parent who has one') : b.textContent?.includes('Upload photos')
  )
  await act(async () => open!.click())
}

describe('the portal in a build for a real school', () => {
  it('suggests no demo ID for a parent to link', async () => {
    await render('supabase', 'parents')
    expect(document.querySelector('#parent-id')?.getAttribute('placeholder') ?? '').not.toContain('DEMO')
  })

  it('names no demo ID for the photos', async () => {
    await render('supabase', 'photos')
    expect(document.body.textContent).toContain('Name each picture by the person')
    expect(document.body.textContent).not.toContain('DEMO-8A-1')
  })
})

describe('the portal in a build for the demo school', () => {
  it('keeps the demo school’s IDs as the examples', async () => {
    await render('demo', 'parents')
    expect(document.querySelector('#parent-id')?.getAttribute('placeholder')).toBe('DEMO-P1')
    for (const root of roots.splice(0)) act(() => root.unmount())
    document.body.innerHTML = ''
    await render('demo', 'photos')
    expect(document.body.textContent).toContain('DEMO-8A-1.jpg')
  })
})
