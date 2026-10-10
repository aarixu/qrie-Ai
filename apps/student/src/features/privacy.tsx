import { Link } from '@tanstack/react-router'
import { ArrowLeft } from 'lucide-react'
import { privacyContact, privacyHost, privacyNotice } from '@ai-tutor/lms-client'
import { backend } from '@/lib/backend'
import { Alert, AlertDescription } from '@/components/ui/alert'

/**
 * The privacy notice (packages/lms-client privacy.ts), for anyone, signed in
 * or not. This app reaches only the hosted project, so it is said to use
 * https when that address does; a demo build never is. "Back" goes home,
 * which is the sign-in screen for someone who is not signed in.
 */
export function Privacy() {
  const notice = privacyNotice({
    demo: backend.mode === 'demo',
    https: backend.mode === 'supabase' && /^https:\/\//i.test(import.meta.env.VITE_SUPABASE_URL ?? ''),
    // index.html loads no web fonts (tests/privacy.test.tsx).
    googleFonts: false,
    contact: privacyContact(import.meta.env.VITE_QRIE_PRIVACY_CONTACT),
    webHost: privacyHost(import.meta.env.VITE_QRIE_WEB_HOST),
    backupHost: privacyHost(import.meta.env.VITE_QRIE_BACKUP_HOST),
  })

  return (
    <div className='mx-auto min-h-svh max-w-md px-6 pt-[max(env(safe-area-inset-top),2rem)] pb-[max(env(safe-area-inset-bottom),2.5rem)]'>
      <Link to='/' className='inline-flex items-center gap-1.5 py-1 text-sm text-muted-foreground'>
        <ArrowLeft className='size-4' />
        Back
      </Link>
      <h1 className='mt-5 text-2xl font-bold tracking-tight'>{notice.title}</h1>
      <p className='mt-1 text-sm text-muted-foreground'>{notice.version}</p>
      <p className='mt-4'>{notice.intro}</p>
      {notice.note && (
        <Alert className='mt-4'>
          <AlertDescription>{notice.note}</AlertDescription>
        </Alert>
      )}
      {notice.sections.map((s) => (
        <section key={s.heading} className='mt-7 space-y-3'>
          <h2 className='text-lg font-semibold'>{s.heading}</h2>
          {s.paragraphs.map((p) => (
            <p key={p} className='leading-relaxed'>
              {p}
            </p>
          ))}
          {s.list && (
            <ul className='list-disc space-y-2 ps-5 leading-relaxed'>
              {s.list.map((item) => (
                <li key={item}>{item}</li>
              ))}
            </ul>
          )}
          {s.email && (
            <p>
              <a href={`mailto:${s.email}`} className='font-medium text-primary underline underline-offset-4'>
                {s.email}
              </a>
            </p>
          )}
        </section>
      ))}
    </div>
  )
}
