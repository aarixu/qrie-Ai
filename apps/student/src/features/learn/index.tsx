import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Link } from '@tanstack/react-router'
import { Bot, ChevronRight, Lock } from 'lucide-react'
import type { PracticeChapter } from '@ai-tutor/lms-client'
import { api, say } from '@/lib/backend'
import { cn } from '@/lib/utils'
import { chapterTitle, standingOf } from '../progress'

/**
 * Learn: every chapter of the child's subjects. A chapter opens for practice
 * once the school has approved its questions (lms.practice_chapters); the
 * AI tutor joins here later.
 */
export function Learn() {
  const chapters = useQuery({ queryKey: ['practice-chapters'], queryFn: api.practiceChapters })
  const [subject, setSubject] = useState<string | null>(null)

  if (chapters.isPending) return <p className='text-muted-foreground'>Loading your chapters…</p>
  if (chapters.isError) return <p className='text-destructive'>{say(chapters.error)}</p>

  const subjects = [...new Set(chapters.data.map((c) => c.subjectName))]
  const current = subject ?? subjects[0] ?? null
  const rows = chapters.data.filter((c) => c.subjectName === current)
  const ready = chapters.data.filter((c) => c.questions > 0).length

  return (
    <div className='space-y-4'>
      <div>
        <h1 className='text-2xl font-bold'>Learn</h1>
        <p className='text-sm text-muted-foreground'>
          Practise a chapter. Every answer is marked straight away, and it helps your teacher see what to explain.
        </p>
      </div>

      <div className='flex items-center gap-3 rounded-2xl border border-dashed p-4'>
        <div className='flex size-11 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary'>
          <Bot className='size-6' />
        </div>
        <div>
          <p className='font-semibold'>Your AI tutor is coming soon</p>
          <p className='text-xs text-muted-foreground'>It will teach each chapter with you, step by step.</p>
        </div>
      </div>

      {subjects.length === 0 ? (
        <p className='text-sm text-muted-foreground'>No subjects yet.</p>
      ) : (
        <>
          <div className='-mx-4 flex gap-2 overflow-x-auto px-4 pb-1'>
            {subjects.map((s) => (
              <button
                key={s}
                onClick={() => setSubject(s)}
                className={cn(
                  'shrink-0 rounded-full border px-3 py-1 text-sm transition-colors',
                  current === s ? 'border-primary bg-primary text-primary-foreground' : 'bg-card text-muted-foreground'
                )}
              >
                {s}
              </button>
            ))}
          </div>
          {ready === 0 && (
            <p className='rounded-xl bg-muted p-3 text-sm text-muted-foreground'>
              No chapter is open for practice yet. Your teacher opens chapters by approving their questions.
            </p>
          )}
          <ul className='space-y-2'>
            {rows.map((c, i) => (
              <li key={c.chapter}>
                <ChapterRow c={c} n={i + 1} />
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  )
}

function ChapterRow({ c, n }: { c: PracticeChapter; n: number }) {
  const s = standingOf(c.mastery, c.answers)
  const inner = (
    <div className={cn('flex items-center gap-3 rounded-xl border bg-card p-3', c.questions === 0 && 'opacity-60')}>
      <div className='flex size-10 shrink-0 items-center justify-center rounded-lg bg-muted text-sm font-semibold tabular-nums'>
        {n}
      </div>
      <div className='min-w-0 flex-1'>
        <p className='truncate font-medium'>{chapterTitle(c.chapter)}</p>
        {c.questions > 0 ? (
          <>
            <div className='mt-1 h-1.5 overflow-hidden rounded-full bg-muted'>
              <div
                className={cn('h-full rounded-full', s.bar)}
                style={{ width: `${Math.max(4, Math.round((c.mastery ?? 0) * 100))}%` }}
              />
            </div>
            <p className='mt-1 text-xs text-muted-foreground'>
              {s.word} · {c.questions} {c.questions === 1 ? 'question' : 'questions'}
            </p>
          </>
        ) : (
          <p className='text-xs text-muted-foreground'>Not open yet</p>
        )}
      </div>
      {c.questions > 0 ? (
        <ChevronRight className='size-4 shrink-0 text-muted-foreground' />
      ) : (
        <Lock className='size-4 shrink-0 text-muted-foreground' />
      )}
    </div>
  )
  return c.questions > 0 ? (
    <Link to='/learn/practice' search={{ subject: c.subjectName, chapter: c.chapter }} className='block active:opacity-80'>
      {inner}
    </Link>
  ) : (
    inner
  )
}
