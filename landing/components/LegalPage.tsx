import Link from 'next/link'
import type { ReactNode } from 'react'

/**
 * The shell the two legal pages share.
 *
 * It reuses the `.subpage` classes app/globals.css already defines for the
 * marketing slugs, so these pages are styled without a line of new CSS — and
 * so they look like the rest of the site rather than like an afterthought
 * bolted on to satisfy a checkbox.
 */
export function LegalPage({
  eyebrow,
  title,
  accent,
  updated,
  lede,
  children,
}: {
  eyebrow: string
  title: string
  accent: string
  updated: string
  lede: string
  children: ReactNode
}) {
  return (
    <main className="subpage">
      <nav className="nav shell">
        <Link className="logo" href="/" aria-label="Curie home"><span>curie</span></Link>
        <Link className="back-home" href="/">← Back home</Link>
      </nav>
      <section className="subpage-hero shell">
        <div>
          <p className="eyebrow">{eyebrow}</p>
          <h1>{title}<br /><em>{accent}</em></h1>
          <p className="hero-desc">{lede}</p>
          <p className="eyebrow">Last updated {updated}</p>
        </div>
      </section>
      <section className="subpage-content shell">{children}</section>
      <footer>
        <div className="shell footer-bottom">
          <span>© 2026 Curie Learning Co.</span>
          <Link href="/">Learning, made personal.</Link>
        </div>
      </footer>
    </main>
  )
}

export function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <article style={{ marginBottom: '2.5rem', maxWidth: '46rem' }}>
      <h2 style={{ marginBottom: '0.75rem' }}>{title}</h2>
      {children}
    </article>
  )
}
