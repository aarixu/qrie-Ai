import { Link, type LinkProps } from '@tanstack/react-router'
import { ArrowLeft } from 'lucide-react'
import { ConfigDrawer } from '@/components/config-drawer'
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
  children: React.ReactNode
}

/** Every teacher screen: the header bar, a title row, and the content. */
export function Page({ title, description, actions, back, children }: PageProps) {
  return (
    <>
      <Header>
        <Search className='me-auto' />
        <ThemeSwitch />
        <ConfigDrawer />
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
        <div className='mb-6 flex flex-wrap items-end justify-between gap-3'>
          <div className='space-y-1'>
            <h1 className='text-2xl font-bold tracking-tight'>{title}</h1>
            {description && (
              <div className='text-muted-foreground'>{description}</div>
            )}
          </div>
          {actions && <div className='flex flex-wrap gap-2'>{actions}</div>}
        </div>
        {children}
      </Main>
    </>
  )
}

export function Loading({ what }: { what: string }) {
  return <p className='text-muted-foreground'>Loading {what}…</p>
}

export function Problem({ error }: { error: unknown }) {
  return (
    <p className='text-destructive'>
      {error instanceof TypeError
        ? 'Could not reach the school server. Is it running?'
        : (error as Error).message}
    </p>
  )
}
