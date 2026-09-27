import { useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { Check, ImageUp, Trash2 } from 'lucide-react'
import { toast } from 'sonner'
import { api } from '@/lib/backend'
import { readableOn, useSchoolLogo } from '@/lib/brand'
import { useAuthStore } from '@/stores/auth-store'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Page } from '@/components/layout/page'

const PRESETS = ['#4f46e5', '#0e7490', '#15803d', '#b91c1c', '#c2410c', '#7c3aed', '#be185d', '#1e3a8a']
const HEX = /^#[0-9a-fA-F]{6}$/

const LOGO_TYPES = ['image/png', 'image/jpeg'] as const
const LOGO_MAX = 256 * 1024

/** A file's bytes as base64, without the data-URL prefix. */
function base64Of(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader()
    r.onload = () => resolve(String(r.result).replace(/^data:[^,]*,/, ''))
    r.onerror = () => reject(new Error('Could not read that file.'))
    r.readAsDataURL(file)
  })
}

/**
 * The school's own look (lms.set_school_brand, lms.set_school_logo): its
 * colour and logo, on both apps and on every report card. The server keeps
 * only a #rrggbb colour and a PNG or JPEG of 256 KB at most.
 */
export function SchoolSettingsPage() {
  const me = useAuthStore((s) => s.me)
  const setMe = useAuthStore((s) => s.setMe)
  const current = typeof me?.brand?.primary === 'string' ? me.brand.primary : '#4f46e5'
  const [colour, setColour] = useState(current)
  const save = useMutation({
    mutationFn: () => api.setSchoolBrand({ primary: colour }),
    onSuccess: async () => {
      toast.success('Saved. This app wears it now; students see it next time they open theirs.')
      const fresh = await api.me()
      if (fresh) setMe(fresh)
    },
    onError: (e) => toast.error((e as Error).message),
  })
  const valid = HEX.test(colour)
  const queryClient = useQueryClient()
  const logo = useSchoolLogo()
  const setLogo = useMutation({
    mutationFn: async (file: File | null) => {
      if (!file) return api.setSchoolLogo(null, null)
      if (!(LOGO_TYPES as readonly string[]).includes(file.type)) throw new Error('A logo must be a PNG or a JPEG.')
      if (file.size > LOGO_MAX) throw new Error('A logo must be 256 KB or smaller.')
      return api.setSchoolLogo(file.type as (typeof LOGO_TYPES)[number], await base64Of(file))
    },
    onSuccess: (_, file) => {
      toast.success(file ? 'Logo saved.' : 'Logo removed.')
      queryClient.invalidateQueries({ queryKey: ['school-logo'] })
    },
    onError: (e) => toast.error((e as Error).message),
  })

  return (
    <Page title='School settings' description={me ? `${me.schoolName} · school code ${me.schoolCode}` : undefined}>
      <div className='grid gap-6 lg:grid-cols-2'>
        <Card className='lg:col-span-2'>
          <CardHeader>
            <CardTitle>School logo</CardTitle>
            <CardDescription>
              Shown in both apps and on every report card. A PNG or JPEG, 256 KB at most; square works best.
            </CardDescription>
          </CardHeader>
          <CardContent className='flex flex-wrap items-center gap-4'>
            <div className='grid size-20 place-items-center overflow-hidden rounded-xl border bg-white'>
              {logo ? (
                <img src={logo} alt='The school logo' className='size-full object-contain' />
              ) : (
                <span className='px-2 text-center text-xs text-muted-foreground'>No logo yet</span>
              )}
            </div>
            <Button asChild variant='outline' disabled={setLogo.isPending}>
              <label className='cursor-pointer'>
                <ImageUp /> {logo ? 'Change logo' : 'Upload logo'}
                <input
                  type='file'
                  accept='image/png,image/jpeg'
                  className='sr-only'
                  onChange={(e) => {
                    const file = e.target.files?.[0]
                    e.target.value = ''
                    if (file) setLogo.mutate(file)
                  }}
                />
              </label>
            </Button>
            {logo && (
              <Button variant='ghost' disabled={setLogo.isPending} onClick={() => setLogo.mutate(null)}>
                <Trash2 /> Remove
              </Button>
            )}
          </CardContent>
        </Card>
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
                {logo && <img src={logo} alt='' className='mb-2 size-9 rounded-lg bg-white object-contain p-0.5' />}
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
