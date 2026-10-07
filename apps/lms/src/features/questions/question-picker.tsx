import { useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { PenLine } from 'lucide-react'
import type { LibraryItem } from '@ai-tutor/lms-client'
import { api } from '@/lib/backend'
import { chapterTitle } from '@/lib/curriculum'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet'
import { Problem } from '@/components/layout/page'
import { QuestionView } from './question-view'
import { TopicFilter } from './topic-filter'
import { WriteQuestionDialog, type WrittenItem } from './write-question-dialog'

export type PickedItem = WrittenItem

type QuestionPickerProps = {
  open: boolean
  onOpenChange: (open: boolean) => void
  grade: number
  subject: string
  chosen: Set<string>
  onPick: (item: PickedItem) => void
}

const PAGE = 30

/**
 * The question bank, as a side panel beside the homework being built.
 * Adding a library question approves it for the school (the approval is
 * the teacher's review — 0023); the teacher's own questions come approved.
 */
export function QuestionPicker({ open, onOpenChange, grade, subject, chosen, onPick }: QuestionPickerProps) {
  const queryClient = useQueryClient()
  const [text, setText] = useState('')
  const [place, setPlace] = useState<{ chapter: string | undefined; outcome: string | undefined }>({
    chapter: undefined,
    outcome: undefined,
  })
  const [limit, setLimit] = useState(PAGE)
  const [writing, setWriting] = useState(false)
  const [adding, setAdding] = useState<string | null>(null)
  const [problem, setProblem] = useState<unknown>(null)
  const query = text.trim() || undefined

  const bank = useQuery({
    queryKey: ['library', grade, subject, place.chapter, place.outcome, query, limit],
    queryFn: () => api.library({ grade, subject, chapter: place.chapter, outcome: place.outcome, query, limit }),
    enabled: open,
    placeholderData: (prev) => prev,
  })

  async function add(item: LibraryItem) {
    setAdding(item.id)
    setProblem(null)
    try {
      if (!item.approved) await api.approveItem(item.id)
      queryClient.invalidateQueries({ queryKey: ['library'] })
      onPick({ id: item.id, stem: item.stem, options: item.options ?? [], correctIndex: item.correctIndex ?? 0 })
    } catch (e) {
      setProblem(e)
    } finally {
      setAdding(null)
    }
  }

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className='flex w-full flex-col gap-0 sm:max-w-xl'>
        <SheetHeader>
          <SheetTitle>Add questions</SheetTitle>
          <SheetDescription>
            Class {grade} {subject}: Qrie’s library and your school’s own questions.
            Adding a library question approves it for your school.
          </SheetDescription>
        </SheetHeader>
        <div className='flex flex-wrap gap-2 px-4 pb-2'>
          <TopicFilter
            grade={grade}
            subject={subject}
            chapter={place.chapter}
            outcome={place.outcome}
            onChange={(next) => {
              setPlace(next)
              setLimit(PAGE)
            }}
          />
        </div>
        <div className='flex gap-2 px-4 pb-3'>
          <Input
            placeholder='Search the questions…'
            value={text}
            onChange={(e) => {
              setText(e.target.value)
              setLimit(PAGE)
            }}
          />
          <Button variant='outline' onClick={() => setWriting(true)}>
            <PenLine /> Write one
          </Button>
        </div>
        {problem != null && (
          <div className='px-4 pb-2'>
            <Problem error={problem} />
          </div>
        )}
        <div className='flex-1 space-y-3 overflow-y-auto px-4 pb-4'>
          {bank.isPending ? (
            <p className='text-muted-foreground'>Loading questions…</p>
          ) : bank.isError ? (
            <Problem error={bank.error} />
          ) : bank.data.length === 0 ? (
            <p className='text-muted-foreground'>No questions match.</p>
          ) : (
            <>
              {bank.data.map((item) => (
                <div key={item.id} className='space-y-2 rounded-lg border p-3'>
                  <div className='flex flex-wrap gap-1'>
                    <Badge variant='outline'>{item.source === 'school' ? 'Your school' : 'Qrie library'}</Badge>
                    {item.approved && <Badge variant='secondary'>Approved</Badge>}
                  {item.chapter && (
                      <span className='text-xs text-muted-foreground'>
                        {chapterTitle(item.chapter)}
                        {item.topic && ` › ${item.topic}`}
                      </span>
                    )}
                  </div>
                  <QuestionView stem={item.stem} options={item.options} correctIndex={item.correctIndex} />
                  <Button
                    size='sm'
                    disabled={chosen.has(item.id) || adding === item.id}
                    onClick={() => add(item)}
                  >
                    {chosen.has(item.id) ? 'Added' : item.approved ? 'Add' : 'Approve and add'}
                  </Button>
                </div>
              ))}
              {bank.data.length >= limit && (
                <Button variant='outline' className='w-full' onClick={() => setLimit(limit + PAGE)}>
                  Show more
                </Button>
              )}
            </>
          )}
        </div>
        <WriteQuestionDialog
          open={writing}
          onOpenChange={setWriting}
          grade={grade}
          subject={subject}
          chapter={place.chapter}
          outcome={place.outcome}
          onWritten={onPick}
        />
      </SheetContent>
    </Sheet>
  )
}
