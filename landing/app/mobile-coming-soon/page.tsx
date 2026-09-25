import Link from 'next/link'
import { ART, imgProps } from '@/lib/art'

export const metadata = {
  title: 'Curie mobile app — Coming soon',
  description: 'The Curie mobile app is coming soon. Continue learning with Curie in your browser.',
}

export default function MobileComingSoonPage() {
  return (
    <main className="coming-soon-page">
      <nav className="nav shell">
        <Link className="logo" href="/" aria-label="Curie home">
          <img {...imgProps(ART.logo, 'Curie logo', true)} />
          <span>curie</span>
        </Link>
        <Link className="back-home" href="/">← Back home</Link>
      </nav>
      <section className="coming-soon-content shell">
        <div className="coming-soon-art"><img {...imgProps(ART.hand, 'Student learning with Curie on a mobile device', true)} /></div>
        <p className="eyebrow">Curie on the go</p>
        <h1>The mobile app is<br /><em>coming soon.</em></h1>
        <p>We&apos;re putting the finishing touches on your personal AI tutor for mobile. Until then, continue learning with Curie right in your browser.</p>
        <Link className="pill dark-pill" href="/#start">Continue with web app ↗</Link>
      </section>
    </main>
  )
}
