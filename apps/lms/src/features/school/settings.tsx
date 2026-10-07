import { useState } from 'react'
import { friendlyError } from '@ai-tutor/lms-client'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { Check, ImageUp, RotateCcw, Sparkles, Trash2 } from 'lucide-react'
import { toast } from 'sonner'
import { api } from '@/lib/backend'
import { QRIE_COLOURS, brandColours, readableOn, useSchoolLogo } from '@/lib/brand'
import { coloursOfLogo } from '@/lib/logo-colours'
import { useAuthStore } from '@/stores/auth-store'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Page } from '@/components/layout/page'
import { NewYearCard } from './new-year'

const HEX = /^#[0-9a-fA-F]{6}$/
const LOGO_TYPES = ['image/png', 'image/jpeg'] as const
const LOGO_MAX = 256 * 1024

/** Pairs that work together: a main colour and a highlight. */
const PAIRS: { name: string; primary: string; accent: string }[] = [
  { name: 'Qrie', ...QRIE_COLOURS },
  { name: 'Lagoon', primary: '#0e7490', accent: '#fb923c' },
  { name: 'Forest', primary: '#15803d', accent: '#facc15' },
  { name: 'Heritage', primary: '#9f1239', accent: '#f59e0b' },
  { name: 'Navy', primary: '#1e3a8a', accent: '#f97316' },
  { name: 'Violet', primary: '#6d28d9', accent: '#f472b6' },
  { name: 'Sky', primary: '#0369a1', accent: '#a3e635' },
  { name: 'Ink', primary: '#1f2937', accent: '#22d3ee' },
]

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
 * The school's own look (lms.set_school_brand, lms.set_school_logo): its logo
 * and two colours — a main one for buttons and headers, and an accent for
 * highlights — on both apps and on every report card. The server keeps only
 * #rrggbb colours and a PNG or JPEG of 256 KB at most.
 */
export function SchoolSettingsPage() {
  const me = useAuthStore((s) => s.me)
  const setMe = useAuthStore((s) => s.setMe)
  const saved = brandColours(me)
  const [primary, setPrimary] = useState(saved.primary)
  const [accent, setAccent] = useState(saved.accent)
  const valid = HEX.test(primary) && HEX.test(accent)
  const changed = primary.toLowerCase() !== saved.primary || accent.toLowerCase() !== saved.accent

  const save = useMutation({
    mutationFn: () => api.setSchoolBrand({ primary, accent }),
    onSuccess: async () => {
      toast.success('Colours saved. This app wears them now; students see them next time they open theirs.')
      const fresh = await api.me()
      if (fresh) setMe(fresh)
    },
    onError: (e) => toast.error(friendlyError(e)),
  })

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
    onError: (e) => toast.error(friendlyError(e)),
  })
  const suggest = useMutation({
    mutationFn: () => coloursOfLogo(logo!),
    onSuccess: (found) => {
      if (!found.length) return toast.info('The logo has no clear colours to suggest; pick a pair below.')
      setPrimary(found[0]!)
      if (found[1]) setAccent(found[1])
      toast.success(found[1] ? 'Two colours taken from the logo. Save to keep them.' : 'One colour taken from the logo. Save to keep it.')
    },
    onError: () => toast.error('Could not read the logo’s colours.'),
  })

  return (
    <Page title='School settings' description={me ? `${me.schoolName} · school code ${me.schoolCode}` : undefined}>
      <div className='grid gap-6 xl:grid-cols-5'>
        <div className='space-y-6 xl:col-span-3'>
          <Card>
            <CardHeader>
              <CardTitle>School logo</CardTitle>
              <CardDescription>
                Shown in both apps and on every report card. A PNG or JPEG, 256 KB at most; square works best.
              </CardDescription>
            </CardHeader>
            <CardContent className='flex flex-wrap items-center gap-4'>
              <div className='grid size-20 place-items-center overflow-hidden rounded-2xl border bg-white'>
                {logo ? (
                  <img src={logo} alt='The school logo' className='size-full object-contain p-1' />
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
                <>
                  <Button variant='outline' disabled={suggest.isPending} onClick={() => suggest.mutate()}>
                    <Sparkles /> Colours from the logo
                  </Button>
                  <Button variant='ghost' disabled={setLogo.isPending} onClick={() => setLogo.mutate(null)}>
                    <Trash2 /> Remove
                  </Button>
                </>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>School colours</CardTitle>
              <CardDescription>
                The main colour is for buttons, headers and the student app’s top bar; the accent is for highlights.
                Text on each is set black or white for you, whichever reads better.
              </CardDescription>
            </CardHeader>
            <CardContent className='space-y-5'>
              <div className='grid grid-cols-2 gap-2 sm:grid-cols-4'>
                {PAIRS.map((p) => {
                  const on = p.primary === primary.toLowerCase() && p.accent === accent.toLowerCase()
                  return (
                    <button
                      key={p.name}
                      type='button'
                      onClick={() => {
                        setPrimary(p.primary)
                        setAccent(p.accent)
                      }}
                      className='flex items-center gap-2 rounded-xl border p-2 text-start text-sm transition-colors hover:bg-accent/60 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none aria-pressed:border-primary aria-pressed:bg-primary/5'
                      aria-pressed={on}
                    >
                      <span className='relative flex'>
                        <span className='size-6 rounded-full border border-black/10' style={{ background: p.primary }} />
                        <span className='-ms-2 size-6 rounded-full border-2 border-card' style={{ background: p.accent }} />
                      </span>
                      <span className='flex-1 font-medium'>{p.name}</span>
                      {on && <Check className='size-4 text-primary' />}
                    </button>
                  )
                })}
              </div>
              <div className='grid gap-4 sm:grid-cols-2'>
                <ColourField id='brand-primary' label='Main colour' value={primary} onChange={setPrimary} />
                <ColourField id='brand-accent' label='Accent colour' value={accent} onChange={setAccent} />
              </div>
              <div className='flex flex-wrap gap-2'>
                <Button disabled={!valid || !changed || save.isPending} onClick={() => save.mutate()}>
                  {save.isPending ? 'Saving…' : 'Save colours'}
                </Button>
                <Button
                  variant='ghost'
                  disabled={save.isPending}
                  onClick={() => {
                    setPrimary(saved.primary)
                    setAccent(saved.accent)
                  }}
                >
                  <RotateCcw /> Undo changes
                </Button>
              </div>
            </CardContent>
          </Card>
          <NewYearCard />
        </div>

        <Card className='xl:col-span-2'>
          <CardHeader>
            <CardTitle>Preview</CardTitle>
            <CardDescription>How the two apps will look.</CardDescription>
          </CardHeader>
          <CardContent>
            <Preview
              primary={HEX.test(primary) ? primary : saved.primary}
              accent={HEX.test(accent) ? accent : saved.accent}
              logo={logo}
              school={me?.schoolName ?? 'Your school'}
            />
          </CardContent>
        </Card>
      </div>
    </Page>
  )
}

function ColourField({ id, label, value, onChange }: { id: string; label: string; value: string; onChange: (v: string) => void }) {
  const ok = HEX.test(value)
  return (
    <div className='space-y-1.5'>
      <Label htmlFor={id}>{label}</Label>
      <div className='flex items-center gap-2'>
        <input
          type='color'
          aria-label={`Pick the ${label.toLowerCase()}`}
          value={ok ? value : '#000000'}
          onChange={(e) => onChange(e.target.value)}
          className='h-9 w-12 cursor-pointer rounded-md border bg-transparent'
        />
        <Input id={id} value={value} onChange={(e) => onChange(e.target.value.trim())} className='w-32 font-mono' />
      </div>
      {!ok && <p className='text-xs text-destructive'>A colour is written #rrggbb, e.g. #0e7490.</p>}
    </div>
  )
}

function Preview({ primary, accent, logo, school }: { primary: string; accent: string; logo: string | null; school: string }) {
  const onPrimary = readableOn(primary)
  const onAccent = readableOn(accent)
  return (
    <div className='flex flex-wrap items-start justify-center gap-6'>
      <div className='w-full max-w-xs overflow-hidden rounded-xl border shadow-sm'>
        <p className='bg-muted px-3 py-1 text-[10px] text-muted-foreground'>Teacher app</p>
        <div className='relative overflow-hidden p-4' style={{ background: primary, color: onPrimary }}>
          <span className='absolute -top-8 -right-6 size-24 rounded-full opacity-70' style={{ background: accent }} />
          <div className='relative flex items-center gap-2'>
            <span className='grid size-8 place-items-center overflow-hidden rounded-lg bg-white'>
              {logo && <img src={logo} alt='' className='size-full object-contain p-0.5' />}
            </span>
            <div>
              <p className='text-[10px] opacity-80'>{school}</p>
              <p className='text-sm font-bold'>Good morning, Neha</p>
            </div>
          </div>
        </div>
        <div className='flex gap-2 bg-background p-3'>
          <span className='rounded-md px-2 py-1 text-[11px] font-medium' style={{ background: primary, color: onPrimary }}>
            Create
          </span>
          <span className='rounded-md px-2 py-1 text-[11px] font-medium' style={{ background: accent, color: onAccent }}>
            3 to mark
          </span>
        </div>
      </div>
      <div className='w-48 overflow-hidden rounded-[1.75rem] border-4 border-foreground/80 shadow-lg'>
        <div className='flex items-center gap-2 px-3 pt-5 pb-3' style={{ background: primary, color: onPrimary }}>
          <span className='grid size-7 place-items-center overflow-hidden rounded-lg bg-white'>
            {logo && <img src={logo} alt='' className='size-full object-contain p-0.5' />}
          </span>
          <div>
            <p className='text-[9px] opacity-80'>{school}</p>
            <p className='text-xs font-semibold'>Riya Sharma</p>
          </div>
        </div>
        <div className='space-y-2 bg-background p-2.5'>
          <div className='rounded-lg p-2.5 text-[10px] font-semibold' style={{ background: accent, color: onAccent }}>
            Practise now · Rational numbers
          </div>
          <div className='h-8 rounded-lg bg-muted' />
          <div className='flex justify-around border-t pt-1.5 text-[9px]'>
            {['Home', 'Work', 'Learn', 'Progress'].map((t, i) => (
              <span key={t} className={i === 0 ? 'font-semibold' : 'text-muted-foreground'} style={i === 0 ? { color: primary } : undefined}>
                {t}
              </span>
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}
