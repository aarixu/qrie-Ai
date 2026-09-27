import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { api, say } from '@/lib/backend'
import { cn } from '@/lib/utils'
import { Section, standing } from './home'

type Tab = 'todo' | 'done'

/** All of the child's work, to do or done, one subject or all (lms.my_assignments). */
export function Work() {
  const mine = useQuery({ queryKey: ['my-assignments'], queryFn: api.myAssignments })
  const [tab, setTab] = useState<Tab>('todo')
  const [subject, setSubject] = useState<string | null>(null)

  if (mine.isPending) return <p className='text-muted-foreground'>Loading your work…</p>
  if (mine.isError) return <p className='text-destructive'>{say(mine.error)}</p>

  const subjects = [...new Set(mine.data.map((a) => a.subjectName))].sort()
  const rows = mine.data.filter((a) => !subject || a.subjectName === subject)
  const todo = rows.filter((a) => standing(a) === 'todo').sort((a, b) => a.dueAt.localeCompare(b.dueAt))
  const overdue = rows.filter((a) => standing(a) === 'overdue')
  const done = rows
    .filter((a) => standing(a) === 'done')
    .sort((a, b) => b.dueAt.localeCompare(a.dueAt))

  return (
    <div className='space-y-4'>
      <h1 className='text-2xl font-bold'>Your work</h1>
      <div role='tablist' className='grid grid-cols-2 rounded-xl bg-muted p-1'>
        {(
          [
            ['todo', `To do (${todo.length + overdue.length})`],
            ['done', `Done (${done.length})`],
          ] as const
        ).map(([key, label]) => (
          <button
            key={key}
            role='tab'
            aria-selected={tab === key}
            onClick={() => setTab(key)}
            className={cn(
              'rounded-lg py-2 text-sm font-medium transition-colors',
              tab === key ? 'bg-background shadow-sm' : 'text-muted-foreground'
            )}
          >
            {label}
          </button>
        ))}
      </div>
      {subjects.length > 1 && (
        <div className='-mx-4 flex gap-2 overflow-x-auto px-4 pb-1'>
          {[null, ...subjects].map((s) => (
            <button
              key={s ?? 'all'}
              onClick={() => setSubject(s)}
              className={cn(
                'shrink-0 rounded-full border px-3 py-1 text-sm transition-colors',
                subject === s ? 'border-primary bg-primary text-primary-foreground' : 'bg-card text-muted-foreground'
              )}
            >
              {s ?? 'All subjects'}
            </button>
          ))}
        </div>
      )}
      {tab === 'todo' ? (
        <>
          {overdue.length > 0 && <Section title='Late — you can still hand these in' items={overdue} tone='late' />}
          <Section title='To do' empty='Nothing to do right now. Well done!' items={todo} />
        </>
      ) : (
        <Section title='Done' empty='Nothing handed in yet.' items={done} />
      )}
    </div>
  )
}
