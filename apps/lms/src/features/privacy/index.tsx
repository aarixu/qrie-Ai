import { Link } from '@tanstack/react-router'
import { ArrowLeft } from 'lucide-react'
import { privacyContact, privacyHost, privacyNotice } from '@ai-tutor/lms-client'
import { backend } from '@/lib/backend'
import { Alert, AlertDescription } from '@/components/ui/alert'

const HTTPS = /^https:\/\//i

/**
 * Whether every address this build reaches begins with https://: the hosted
 * project and, when set, the relay. A demo build is never said to.
 */
function builtForHttps(): boolean {
  if (backend.mode !== 'supabase') return false
  const addresses = [
    import.meta.env.VITE_SUPABASE_URL,
    import.meta.env.VITE_QRIE_RELAY_URL,
  ]
  return addresses.every((a) => !a || HTTPS.test(a))
}

/**
 * The privacy notice (packages/lms-client privacy.ts), for anyone, signed in
 * or not. "Back" goes home, which is the sign-in screen for someone who is
 * not signed in.
 */
export function Privacy() {
  const notice = privacyNotice({
    demo: backend.mode === 'demo',
    https: builtForHttps(),
    // index.html loads Inter and Manrope from Google Fonts (tests/privacy.test.tsx).
    googleFonts: true,
    contact: privacyContact(import.meta.env.VITE_QRIE_PRIVACY_CONTACT),
    webHost: privacyHost(import.meta.env.VITE_QRIE_WEB_HOST),
    backupHost: privacyHost(import.meta.env.VITE_QRIE_BACKUP_HOST),
  })

  return (
    <main className='mx-auto w-full max-w-2xl px-4 py-8 sm:px-6 sm:py-12'>
      <Link
        to='/'
        className='inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground'
      >
        <ArrowLeft className='size-4' />
        Back
      </Link>
      <h1 className='mt-6 text-2xl font-bold tracking-tight md:text-3xl'>
        {notice.title}
      </h1>
      <p className='mt-1 text-sm text-muted-foreground'>{notice.version}</p>
      <p className='mt-4'>{notice.intro}</p>
      {notice.note && (
        <Alert className='mt-4'>
          <AlertDescription>{notice.note}</AlertDescription>
        </Alert>
      )}
      {notice.sections.map((s) => (
        <section key={s.heading} className='mt-8 space-y-3'>
          <h2 className='text-lg font-semibold tracking-tight'>{s.heading}</h2>
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
              <a
                href={`mailto:${s.email}`}
                className='font-medium underline underline-offset-4'
              >
                {s.email}
              </a>
            </p>
          )}
        </section>
      ))}
    </main>
  )
}
