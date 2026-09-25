import Link from 'next/link'

export const metadata = {
  title: 'Curie mobile app — Coming soon',
  description: 'The Curie mobile app is coming soon. Continue learning with Curie in your browser.',
}

export default function MobileComingSoonPage() {
  return (
    <main className="coming-soon-page">
      <nav className="nav shell">
        <Link className="logo" href="/" aria-label="Curie home">
          <img src="https://hebbkx1anhila5yf.public.blob.vercel-storage.com/ChatGPT%20Image%20Sep%202%2C%202026%2C%2010_42_12%20AM-5vJi1SeaJztqjZeAI2DCYyOzA3vNDC.png" alt="Curie logo" />
          <span>curie</span>
        </Link>
        <Link className="back-home" href="/">← Back home</Link>
      </nav>
      <section className="coming-soon-content shell">
        <div className="coming-soon-art"><img src="https://hebbkx1anhila5yf.public.blob.vercel-storage.com/ChatGPT%20Image%20Sep%202%2C%202026%2C%2010_23_01%20AM-5PaL1bjeKMdhJXo6nZi0aDuZgq5n40.png" alt="Student learning with Curie on a mobile device" /></div>
        <p className="eyebrow">Curie on the go</p>
        <h1>The mobile app is<br /><em>coming soon.</em></h1>
        <p>We&apos;re putting the finishing touches on your personal AI tutor for mobile. Until then, continue learning with Curie right in your browser.</p>
        <Link className="pill dark-pill" href="/#start">Continue with web app ↗</Link>
      </section>
    </main>
  )
}
