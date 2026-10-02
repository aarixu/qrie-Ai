import { format } from 'date-fns'
import { School } from 'lucide-react'
import { useSchoolLogo } from '@/lib/brand'
import { useAuthStore } from '@/stores/auth-store'

/**
 * The top of a home screen, in the school's colours: its logo and name, a
 * greeting, and room for a few words or buttons. Text is on the primary
 * colour (readable by the brand's own contrast rule); the accent only
 * decorates.
 */
export function BrandHero({ title, subtitle, children }: { title: string; subtitle?: React.ReactNode; children?: React.ReactNode }) {
  const me = useAuthStore((s) => s.me)
  const logo = useSchoolLogo(!!me)
  return (
    <section className='relative mb-6 overflow-hidden rounded-2xl bg-primary px-5 py-6 text-primary-foreground shadow-sm sm:px-7'>
      <span
        className='pointer-events-none absolute -top-16 -right-10 size-56 rounded-full opacity-70'
        style={{ background: 'var(--brand-accent)' }}
        aria-hidden
      />
      <span
        className='pointer-events-none absolute -right-24 -bottom-24 size-64 rounded-full opacity-25'
        style={{ background: 'var(--brand-accent)' }}
        aria-hidden
      />
      <div className='relative flex flex-wrap items-center gap-4'>
        <div className='grid size-14 shrink-0 place-items-center overflow-hidden rounded-2xl bg-white shadow-sm'>
          {logo ? (
            <img src={logo} alt='' className='size-full object-contain p-1' />
          ) : (
            <School className='size-7 text-primary' />
          )}
        </div>
        <div className='min-w-0 flex-1'>
          <p className='text-sm opacity-85'>
            {me?.schoolName ?? 'Qrie'} · {format(new Date(), 'EEEE, d MMMM')}
          </p>
          <h1 className='text-2xl font-bold tracking-tight sm:text-3xl'>{title}</h1>
          {subtitle && <div className='mt-1 text-sm opacity-90'>{subtitle}</div>}
        </div>
        {children && <div className='relative flex flex-wrap gap-2'>{children}</div>}
      </div>
    </section>
  )
}

/** A morning, afternoon or evening greeting with the person's first name. */
export function greeting(name: string | undefined): string {
  const h = new Date().getHours()
  const part = h < 12 ? 'Good morning' : h < 17 ? 'Good afternoon' : 'Good evening'
  const first = name?.split(' ')[0]
  return first ? `${part}, ${first}` : part
}
