import { describe, expect, it } from 'vitest'
import { idFromFileName } from '@/features/school/photo-upload'

describe('a photo file named by school ID', () => {
  it('reads the ID whatever the case, extension or copy number', () => {
    expect(idFromFileName('demo-8a-1.jpg')).toBe('DEMO-8A-1')
    expect(idFromFileName('DEMO-8A-1 (1).JPG')).toBe('DEMO-8A-1')
    expect(idFromFileName('  DEMO-T06.png')).toBe('DEMO-T06')
    expect(idFromFileName('DEMO-A1024.photo.jpeg')).toBe('DEMO-A1024.PHOTO')
  })
})
