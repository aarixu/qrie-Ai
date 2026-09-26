import { useQuery } from '@tanstack/react-query'
import { api, say } from '@/lib/backend'
import { cn } from '@/lib/utils'

const chapterTitle = (slug: string) => {
  const words = slug.replace(/-/g, ' ')
  return words.charAt(0).toUpperCase() + words.slice(1)
}

/** Words for a child, not a number: the model's belief is a guide, not a grade. */
function standing(mastery: number, answers: number): { word: string; tone: string } {
  if (answers < 3) return { word: 'Just started', tone: 'bg-muted text-muted-foreground' }
  if (mastery >= 0.7) return { word: 'Strong', tone: 'bg-green-600/15 text-green-700' }
  if (mastery >= 0.4) return { word: 'Getting there', tone: 'bg-amber-500/15 text-amber-700' }
  return { word: 'Needs practice', tone: 'bg-red-500/15 text-red-700' }
}

/** The student's own standing per chapter, from every answer they have handed in (lms.my_progress). */
export function Progress() {
  const mine = useQuery({ queryKey: ['my-progress'], queryFn: api.myProgress })
  if (mine.isPending) return null
  if (mine.isError) return <p className='text-sm text-destructive'>{say(mine.error)}</p>
  if (mine.data.length === 0) return null

  const subjects = [...new Set(mine.data.map((c) => c.subject))]
  return (
    <section>
      <h2 className='mb-2 text-sm font-semibold tracking-wide text-muted-foreground uppercase'>How you’re doing</h2>
      <div className='space-y-4'>
        {subjects.map((subject) => (
          <div key={subject} className='rounded-xl border p-3'>
            <p className='mb-2 font-medium'>{subject}</p>
            <ul className='space-y-1.5'>
              {mine.data
                .filter((c) => c.subject === subject)
                .map((c) => {
                  const s = standing(c.mastery, c.answers)
                  return (
                    <li key={c.chapter} className='flex items-center justify-between gap-2 text-sm'>
                      <span className='min-w-0 truncate'>{chapterTitle(c.chapter)}</span>
                      <span className={cn('shrink-0 rounded-full px-2 py-0.5 text-xs font-medium', s.tone)}>{s.word}</span>
                    </li>
                  )
                })}
            </ul>
          </div>
        ))}
      </div>
    </section>
  )
}
