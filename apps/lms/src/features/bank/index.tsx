import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { PenLine } from 'lucide-react'
import { toast } from 'sonner'
import { api } from '@/lib/backend'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Loading, Page, Problem } from '@/components/layout/page'
import { QuestionView } from '@/features/questions/question-view'
import { WriteQuestionDialog } from '@/features/questions/write-question-dialog'

const PAGE = 30

/**
 * The questions this school can set: Qrie's library (not reviewed by anyone
 * until a teacher here approves it) and the school's own. Approving is the
 * review — only approved questions can go on homework (0023).
 */
export function QuestionBank() {
  const classes = useQuery({ queryKey: ['classes'], queryFn: api.myClasses })
  const pairs = [
    ...new Map((classes.data ?? []).map((c) => [`${c.grade}|${c.subjectName}`, c])).values(),
  ].sort((a, b) => a.grade - b.grade || a.subjectName.localeCompare(b.subjectName))
  const [pick, setPick] = useState<string | null>(null)
  const current = pick ?? (pairs[0] ? `${pairs[0].grade}|${pairs[0].subjectName}` : null)
  const [grade, subject] = current ? [Number(current.split('|')[0]), current.split('|')[1]] : [undefined, undefined]
  const [text, setText] = useState('')
  const [limit, setLimit] = useState(PAGE)
  const [writing, setWriting] = useState(false)
  const queryClient = useQueryClient()

  const bank = useQuery({
    queryKey: ['library', grade, subject, text.trim() || undefined, limit],
    queryFn: () => api.library({ grade, subject, query: text.trim() || undefined, limit }),
    enabled: current !== null,
    placeholderData: (prev) => prev,
  })
  const approve = useMutation({
    mutationFn: (id: string) => api.approveItem(id),
    onSuccess: () => {
      toast.success('Approved for your school.')
      queryClient.invalidateQueries({ queryKey: ['library'] })
    },
  })

  return (
    <Page
      title='Question bank'
      description='Approve a question once, and every teacher at your school can set it.'
      actions={
        grade !== undefined && (
          <Button onClick={() => setWriting(true)}>
            <PenLine /> Write a question
          </Button>
        )
      }
    >
      {classes.isPending ? (
        <Loading what='your classes' />
      ) : classes.isError ? (
        <Problem error={classes.error} />
      ) : pairs.length === 0 ? (
        <p className='text-muted-foreground'>You have no classes yet, so there is no bank to show.</p>
      ) : (
        <>
          <div className='mb-4 flex flex-wrap gap-2'>
            <Select value={current!} onValueChange={(v) => { setPick(v); setLimit(PAGE) }}>
              <SelectTrigger className='w-56' aria-label='Class and subject'>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {pairs.map((c) => (
                  <SelectItem key={`${c.grade}|${c.subjectName}`} value={`${c.grade}|${c.subjectName}`}>
                    Class {c.grade} {c.subjectName}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Input
              className='max-w-sm'
              placeholder='Search the questions…'
              value={text}
              onChange={(e) => { setText(e.target.value); setLimit(PAGE) }}
            />
          </div>
          {bank.isPending ? (
            <Loading what='questions' />
          ) : bank.isError ? (
            <Problem error={bank.error} />
          ) : bank.data.length === 0 ? (
            <p className='text-muted-foreground'>No questions match.</p>
          ) : (
            <div className='grid gap-3 lg:grid-cols-2'>
              {bank.data.map((item) => (
                <Card key={item.id}>
                  <CardContent className='space-y-3'>
                    <div className='flex flex-wrap gap-1'>
                      <Badge variant='outline'>{item.source === 'school' ? 'Your school' : 'Qrie library'}</Badge>
                      {item.approved ? <Badge variant='secondary'>Approved</Badge> : <Badge variant='outline'>Not reviewed</Badge>}
                    </div>
                    <QuestionView stem={item.stem} options={item.options} correctIndex={item.correctIndex} />
                    {!item.approved && (
                      <Button
                        size='sm'
                        variant='outline'
                        disabled={approve.isPending}
                        onClick={() => approve.mutate(item.id)}
                      >
                        Approve for my school
                      </Button>
                    )}
                  </CardContent>
                </Card>
              ))}
            </div>
          )}
          {bank.data && bank.data.length >= limit && (
            <Button variant='outline' className='mt-4' onClick={() => setLimit(limit + PAGE)}>
              Show more
            </Button>
          )}
        </>
      )}
      {grade !== undefined && subject !== undefined && (
        <WriteQuestionDialog open={writing} onOpenChange={setWriting} grade={grade} subject={subject} />
      )}
    </Page>
  )
}
