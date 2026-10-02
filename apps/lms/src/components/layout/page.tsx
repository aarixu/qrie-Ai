import { Link, type LinkProps } from '@tanstack/react-router'
import { friendlyError } from '@ai-tutor/lms-client'
import { ArrowLeft } from 'lucide-react'
import { ProfileDropdown } from '@/components/profile-dropdown'
import { Search } from '@/components/search'
import { ThemeSwitch } from '@/components/theme-switch'
import { Header } from './header'
import { Main } from './main'

type PageProps = {
  title: React.ReactNode
  description?: React.ReactNode
  actions?: React.ReactNode
  back?: { label: string } & Pick<LinkProps, 'to' | 'params'>
  /** In place of the title row, e.g. a BrandHero; `title` then only names the page. */
  hero?: React.ReactNode
  children: React.ReactNode
}

/** Every teacher screen: the header bar, a title row, and the content. */
export function Page({ title, description, actions, back, hero, children }: PageProps) {
  return (
    <>
      <Header>
        <Search className='me-auto' />
        <ThemeSwitch />
        <ProfileDropdown />
      </Header>
      <Main>
        {back && (
          <Link
            to={back.to}
            params={back.params}
            className='mb-2 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground'
          >
            <ArrowLeft className='size-4' />
            {back.label}
          </Link>
        )}
        {hero ?? (
          <div className='mb-6 flex flex-wrap items-end justify-between gap-3'>
            <div className='space-y-1'>
              <h1 className='text-2xl font-bold tracking-tight'>{title}</h1>
              {description && (
                <div className='text-muted-foreground'>{description}</div>
              )}
            </div>
            {actions && <div className='flex flex-wrap gap-2'>{actions}</div>}
          </div>
        )}
        {children}
      </Main>
    </>
  )
}

/** A shimmering stand-in while something loads; says what, for screen readers. */
export function Loading({ what }: { what: string }) {
  return (
    <div role='status' aria-live='polite' className='space-y-3'>
      <span className='sr-only'>Loading {what}…</span>
      <div className='h-5 w-1/3 animate-pulse rounded-md bg-muted' />
      <div className='h-4 w-2/3 animate-pulse rounded-md bg-muted' />
      <div className='h-4 w-1/2 animate-pulse rounded-md bg-muted' />
    </div>
  )
}

export function Problem({ error }: { error: unknown }) {
  return (
    <p className='text-destructive'>{friendlyError(error)}</p>
  )
}
