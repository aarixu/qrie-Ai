import { createFileRoute, redirect } from '@tanstack/react-router'
import { Practice } from '@/features/learn/practice'

type Search = { subject: string; chapter: string }

// A subject is a name ('Mathematics'); a chapter is the syllabus's slug
// ('rational-numbers'). Anything else in the address goes back to Learn.
const SUBJECT = /^[A-Za-z][A-Za-z .&-]{0,59}$/
const CHAPTER = /^[a-z0-9][a-z0-9-]{0,119}$/

export const Route = createFileRoute('/_app/learn/practice')({
  validateSearch: (s: Record<string, unknown>): Partial<Search> => ({
    subject: typeof s.subject === 'string' && SUBJECT.test(s.subject) ? s.subject : undefined,
    chapter: typeof s.chapter === 'string' && CHAPTER.test(s.chapter) ? s.chapter : undefined,
  }),
  beforeLoad: ({ search }) => {
    if (!search.subject || !search.chapter) throw redirect({ to: '/learn' })
  },
  component: function PracticeRoute() {
    const { subject, chapter } = Route.useSearch()
    // The same page for another chapter starts a fresh round.
    return <Practice key={`${subject}/${chapter}`} subject={subject!} chapter={chapter!} />
  },
})
