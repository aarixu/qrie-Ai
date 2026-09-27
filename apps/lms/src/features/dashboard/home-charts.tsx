import { useState } from 'react'
import { useQueries } from '@tanstack/react-query'
import { Activity, ClipboardList, GraduationCap, Target } from 'lucide-react'
import type { TaughtClass, TrendPoint } from '@ai-tutor/lms-client'
import { api } from '@/lib/backend'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { ChartCard, ClassBars, Kpi, TrendChart, pct, shortClass } from '@/features/analytics/charts'

const key = (c: TaughtClass) => `${c.sectionId}/${c.subjectId}`

function summary(points: TrendPoint[]) {
  const past = points.filter((p) => new Date(p.dueAt) <= new Date())
  const students = past.reduce((n, p) => n + p.students, 0)
  const handed = past.reduce((n, p) => n + p.handedIn, 0)
  const scored = past.filter((p) => p.averageScore !== null)
  return {
    handin: students ? handed / students : null,
    score: scored.length ? scored.reduce((n, p) => n + p.averageScore!, 0) / scored.length : null,
    work: points.length,
  }
}

/** The teacher's home, in numbers and graphs: every class they teach (lms.class_trend). */
export function HomeCharts({ classes }: { classes: TaughtClass[] }) {
  const trends = useQueries({
    queries: classes.map((c) => ({
      queryKey: ['trend', c.sectionId, c.subjectId],
      queryFn: () => api.classTrend(c.sectionId, c.subjectId),
    })),
  })
  const [picked, setPicked] = useState(classes[0] ? key(classes[0]) : '')
  if (classes.length === 0) return null

  const per = classes.map((c, i) => ({ c, s: summary(trends[i]?.data ?? []), points: trends[i]?.data ?? [] }))
  const allPoints = per.flatMap((p) => p.points)
  const all = summary(allPoints)
  const students = new Map(classes.map((c) => [c.sectionId, c.students]))
  const chosen = per.find((p) => key(p.c) === picked) ?? per[0]

  return (
    <div className='mb-6 space-y-4'>
      <div className='grid gap-4 sm:grid-cols-2 lg:grid-cols-4'>
        <Kpi label='Students' icon={GraduationCap} value={[...students.values()].reduce((a, b) => a + b, 0)} hint={`${classes.length} classes`} />
        <Kpi label='Work set' icon={ClipboardList} value={all.work} hint='Published, all classes' />
        <Kpi
          label='Hand-in rate'
          icon={Activity}
          value={pct(all.handin)}
          hint='Work due so far'
          tone={(all.handin ?? 1) < 0.6 ? 'bad' : undefined}
        />
        <Kpi label='Average score' icon={Target} value={pct(all.score)} hint='Marked work, all classes' />
      </div>
      <div className='grid gap-4 lg:grid-cols-2'>
        <ChartCard title='Your classes' description='Hand-in rate and average score, all work due so far.'>
          <ClassBars
            height={260}
            rows={per.map((p) => ({ name: shortClass(`${p.c.grade}${p.c.sectionName}`, p.c.subjectName), handin: p.s.handin, score: p.s.score }))}
          />
        </ChartCard>
        <ChartCard title='Work by work' description='How one class did on each piece of work, oldest first.'>
          <div className='mb-2 ps-4'>
            <Select value={key(chosen.c)} onValueChange={setPicked}>
              <SelectTrigger className='w-56' aria-label='Class'>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {classes.map((c) => (
                  <SelectItem key={key(c)} value={key(c)}>
                    Class {c.grade}
                    {c.sectionName} · {c.subjectName}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <TrendChart points={chosen.points} height={220} />
        </ChartCard>
      </div>
    </div>
  )
}
