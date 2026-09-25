import { Analytics } from '@vercel/analytics/next'
import type { Metadata, Viewport } from 'next'
import './globals.css'

export const metadata: Metadata = {
  // The formal name in the tab and in search results; the description below
  // keeps the short form, because "Qrie AI is a one-on-one live AI tutor" says
  // AI twice.
  title: 'Qrie AI — Your personal AI tutor',
  description: 'Qrie is a one-on-one live AI tutor that adapts to every student in classes 6–12.',
  generator: 'v0.app',
}

export const viewport: Viewport = {
  colorScheme: 'light',
  themeColor: '#ffc85c',
}

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" className="bg-background">
      <body className="antialiased">
        {children}
        {process.env.NODE_ENV === 'production' && <Analytics />}
      </body>
    </html>
  )
}
