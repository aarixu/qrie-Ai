import type { SchoolPublicBrand } from '@ai-tutor/lms-client'
import { Logo } from '@/assets/logo'

type AuthLayoutProps = {
  children: React.ReactNode
  /** The school whose sign-in this is, once known from the ID being typed. */
  school?: SchoolPublicBrand | null
}

export function AuthLayout({ children, school }: AuthLayoutProps) {
  return (
    <div className='container grid h-svh max-w-none items-center justify-center'>
      <div className='mx-auto flex w-full flex-col justify-center space-y-2 py-8 sm:p-8'>
        <div className='mb-4 flex items-center justify-center gap-3'>
          {school?.logo ? (
            <img
              src={`data:${school.logo.mime};base64,${school.logo.base64}`}
              alt=''
              className='size-11 rounded-xl bg-white object-contain p-0.5 shadow-sm'
            />
          ) : (
            <Logo className='size-9' />
          )}
          <h1 className='text-2xl font-bold tracking-tight'>{school?.schoolName ?? 'Qrie'}</h1>
        </div>
        {children}
      </div>
    </div>
  )
}
