import { useState } from 'react'
import { useMutation } from '@tanstack/react-query'
import { Check } from 'lucide-react'
import { toast } from 'sonner'
import { api } from '@/lib/backend'
import { useAuthStore } from '@/stores/auth-store'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Page } from '@/components/layout/page'

const PRESETS = ['#4f46e5', '#0e7490', '#15803d', '#b91c1c', '#c2410c', '#7c3aed', '#be185d', '#1e3a8a']
const HEX = /^#[0-9a-fA-F]{6}$/

/** Black or white on `hex`, as the student app picks it (apps/student/src/lib/brand.ts). */
function readableOn(hex: string): string {
  const [r, g, b] = [1, 3, 5].map((i) => {
    const c = parseInt(hex.slice(i, i + 2), 16) / 255
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4
  })
  return 0.2126 * r + 0.7152 * g + 0.0722 * b > 0.4 ? '#000000' : '#ffffff'
}

/**
 * The school's own look for the student app (lms.set_school_brand). The
 * server keeps only a #rrggbb colour; the student app wears it from the next
 * sign-in.
 */
export function SchoolSettingsPage() {
  const me = useAuthStore((s) => s.me)
  const setMe = useAuthStore((s) => s.setMe)
  const current = typeof me?.brand?.primary === 'string' ? me.brand.primary : '#4f46e5'
  const [colour, setColour] = useState(current)
  const save = useMutation({
    mutationFn: () => api.setSchoolBrand({ primary: colour }),
    onSuccess: async () => {
      toast.success('Saved. Students see the new colour next time they open the app.')
      const fresh = await api.me()
      if (fresh) setMe(fresh)
    },
    onError: (e) => toast.error((e as Error).message),
  })
  const valid = HEX.test(colour)

  return (
    <Page title='School settings' description={me ? `${me.schoolName} · school code ${me.schoolCode}` : undefined}>
      <div className='grid gap-6 lg:grid-cols-2'>
        <Card>
          <CardHeader>
            <CardTitle>Student app colour</CardTitle>
            <CardDescription>Your school’s colour, on every student’s phone.</CardDescription>
          </CardHeader>
          <CardContent className='space-y-4'>
            <div className='flex flex-wrap gap-2'>
              {PRESETS.map((p) => (
                <button
                  key={p}
                  type='button'
                  aria-label={`Use ${p}`}
                  onClick={() => setColour(p)}
                  className='grid size-9 place-items-center rounded-full ring-offset-2 ring-offset-background focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none'
                  style={{ background: p }}
                >
                  {colour.toLowerCase() === p && <Check className='size-4' style={{ color: readableOn(p) }} />}
                </button>
              ))}
            </div>
            <div className='flex items-end gap-2'>
              <div className='space-y-1.5'>
                <Label htmlFor='brand-hex'>Or type a colour</Label>
                <Input id='brand-hex' value={colour} onChange={(e) => setColour(e.target.value.trim())} className='w-36 font-mono' />
              </div>
              <input
                type='color'
                aria-label='Pick a colour'
                value={valid ? colour : '#000000'}
                onChange={(e) => setColour(e.target.value)}
                className='h-9 w-12 cursor-pointer rounded border bg-transparent'
              />
            </div>
            {!valid && <p className='text-sm text-destructive'>A colour is written #rrggbb, e.g. #0e7490.</p>}
            <Button disabled={!valid || save.isPending} onClick={() => save.mutate()}>
              {save.isPending ? 'Saving…' : 'Save colour'}
            </Button>
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Preview</CardTitle>
            <CardDescription>How the top of the student app will look.</CardDescription>
          </CardHeader>
          <CardContent>
            <div className='mx-auto w-64 overflow-hidden rounded-3xl border-4 border-foreground/80 shadow-lg'>
              <div
                className='px-4 pt-6 pb-4'
                style={{ background: valid ? colour : '#4f46e5', color: readableOn(valid ? colour : '#4f46e5') }}
              >
                <p className='text-xs opacity-80'>{me?.schoolName ?? 'Your school'}</p>
                <p className='text-lg font-semibold'>Hi, Riya</p>
              </div>
              <div className='space-y-2 bg-background p-3'>
                <div className='h-12 rounded-lg bg-muted' />
                <div className='h-12 rounded-lg bg-muted' />
                <div className='flex justify-around border-t pt-2 text-[10px]'>
                  {['Home', 'Work', 'Learn', 'Progress'].map((t, i) => (
                    <span key={t} style={i === 0 && valid ? { color: colour } : undefined}>
                      {t}
                    </span>
                  ))}
                </div>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>
    </Page>
  )
}
