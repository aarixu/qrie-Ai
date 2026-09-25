import Link from 'next/link'
import { ART, imgProps } from '@/lib/art'

export const metadata = {
  title: 'Qrie mobile app — Coming soon',
  description: 'The Qrie mobile app is coming soon. Continue learning with Qrie in your browser.',
}

export default function MobileComingSoonPage() {
  return (
    <main className="coming-soon-page">
      <nav className="nav shell">
        <Link className="logo" href="/" aria-label="Qrie home">
          <img {...imgProps(ART.logo, 'Qrie logo', true)} />
          <span>qrie</span>
        </Link>
        <Link className="back-home" href="/">← Back home</Link>
      </nav>
      <section className="coming-soon-content shell">
        <div className="coming-soon-art"><img {...imgProps(ART.hand, 'Student learning with Qrie on a mobile device', true)} /></div>
        <p className="eyebrow">Qrie on the go</p>
        <h1>The mobile app is<br /><em>coming soon.</em></h1>
        <p>We&apos;re putting the finishing touches on your personal AI tutor for mobile. Until then, continue learning with Qrie right in your browser.</p>
        <Link className="pill dark-pill" href="/#start">Continue with web app ↗</Link>
      </section>
    </main>
  )
}
