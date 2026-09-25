import Link from 'next/link'
import { notFound } from 'next/navigation'
import { ART, imgProps } from '@/lib/art'
import { BookOpen, BrainCircuit, Lightbulb, MessageCircle, ShieldCheck, Sparkles, Target, Users } from 'lucide-react'

const illustrations = {
  subjects: ART.focus,
  'how-it-works': ART.learner,
  'why-qrie': ART.hand,
  students: ART.students,
  parents: ART.teacher,
  contact: ART.desk,
} as const
const pageIcons = [BookOpen, BrainCircuit, Sparkles]

const pages: Record<string, { label: string; title: string; accent: string; body: string; points: string[] }> = {
  subjects: { label: 'Explore the curriculum', title: 'Every question has a place to start.', accent: 'Subjects that move with you.', body: 'Qrie makes Class 6–12 Mathematics, Science, English, and Social Science feel less like chapters and more like conversations.', points: ['Mathematics, from foundations to problem-solving', 'Science explained with visual intuition and real examples', 'English and Social Science through stories and context'] },
  'how-it-works': { label: 'The Qrie learning loop', title: 'A tutor that adapts in real time.', accent: 'Learning built around you.', body: 'Tell Qrie what you are working on. It listens to your answer, finds the right next step, and keeps the session moving at exactly your pace.', points: ['Start with a question, goal, or tricky concept', 'Learn through a live one-on-one conversation', 'Practice, reflect, and see your progress grow'] },
  'why-qrie': { label: 'The Qrie difference', title: 'Less pressure. More progress.', accent: 'Understanding over memorising.', body: 'Qrie gives every learner a patient space to think out loud, make mistakes, and build the confidence to solve the next problem alone.', points: ['Personalised explanations instead of one-size-fits-all videos', 'Unlimited questions without judgement', 'Progress insights for students and parents'] },
  students: { label: 'For students', title: 'Your questions belong here.', accent: 'Learn without holding back.', body: 'Whether you are revising for tomorrow or trying to finally understand a concept, Qrie meets you where you are and helps you take the next step.', points: ['Ask in your own words', 'Choose your pace and level of challenge', 'Turn confusion into confidence'] },
  parents: { label: 'For parents', title: 'See learning become a habit.', accent: 'Support that grows with them.', body: 'Qrie gives students independent support while keeping families close to the learning journey with clear, useful progress signals.', points: ['A safe, focused learning environment', 'Practice that follows their actual gaps', 'A clearer view of strengths and next steps'] },
  contact: { label: 'We would love to hear from you', title: 'Let’s make learning more personal.', accent: 'Talk to the Qrie team.', body: 'Have a question about Qrie for your student, school, or family? Send us a note and we will get back to you.', points: ['hello@curie.study', 'Monday–Friday, 9am–6pm', 'Questions, partnerships, and feedback welcome'] },
}

/**
 * AN UNKNOWN SLUG IS A 404 NOW, AND IT USED TO BE MARKETING COPY.
 *
 * This read `pages[slug] ?? pages['why-qrie']`, which looks like a kind
 * default and was doing real harm: /privacy and /terms have no page of their
 * own, so the consent checkbox on the registration form — the required one,
 * that says "I agree to Qrie's Privacy Policy" — linked to a page that
 * silently served "The Qrie difference" under a marketing headline. Verified
 * live: both URLs returned 200 with the title "Less pressure. More progress."
 *
 * A missing legal document that 404s is a bug somebody fixes. One that
 * renders as an advert looks like it worked, and on a form collecting a
 * child's home address that is the worse of the two by a distance.
 */
export default async function RelatedPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params
  const page = pages[slug]
  if (!page) notFound()
  return <main className="subpage"><nav className="nav shell"><Link className="logo" href="/" aria-label="Qrie home"><img {...imgProps(ART.logo, 'Qrie logo', true)} /><span>qrie ai</span></Link><div className="nav-links is-open"><Link href="/how-it-works">How it works</Link><Link href="/subjects">Subjects</Link><Link href="/why-qrie">Why Qrie</Link></div><div className="nav-actions"><Link className="back-home" href="/">← Back home</Link><Link className="pill dark-pill" href="/#start">Try Qrie ↗</Link></div></nav><section className="subpage-hero shell"><div><p className="eyebrow">{page.label}</p><h1>{page.title}<br /><em>{page.accent}</em></h1><p className="hero-desc">{page.body}</p><Link className="pill dark-pill" href="/#start">Start learning free ↗</Link></div><div className="subpage-visual"><img {...imgProps(illustrations[slug as keyof typeof illustrations] ?? illustrations['why-qrie'], 'Qrie learning illustration', true)} /><div className="subpage-note"><span>Qrie</span><strong>1:1</strong><p>A personal learning space for every student in classes 6–12.</p></div></div></section><section className="subpage-content shell"><h2>Made for the way <em>you learn.</em></h2><div className="subpage-points">{page.points.map((point, index) => { const Icon = pageIcons[index % pageIcons.length]; return <article key={point}><span><Icon aria-hidden="true" /></span><p>{point}</p></article> })}</div><Link className="text-link" href="/">Back to Qrie home ↗</Link></section><footer><div className="shell footer-bottom"><span>© 2026 Qrie Learning Co.</span><Link href="/">Learning, made personal.</Link></div></footer></main>
}

export function generateStaticParams() { return Object.keys(pages).map((slug) => ({ slug })) }

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }) { const { slug } = await params; const page = pages[slug]; return page ? { title: `${page.title} | Qrie AI`, description: page.body } : { title: 'Not found | Qrie AI' } }
