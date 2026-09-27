import { useQuery } from '@tanstack/react-query'
import { Activity, ClipboardList, Clock, Target } from 'lucide-react'
import { api } from '@/lib/backend'
import { chapterTitle } from '@/lib/curriculum'
import { Loading, Problem } from '@/components/layout/page'
import { ChartCard, Kpi, MasteryBars, TrendChart, pct } from '@/features/analytics/charts'

/**
 * One class in graphs: work by work (lms.class_trend) and, chapter by
 * chapter, the class's mean belief from the learning model
 * (lms.class_insights).
 */
export function ClassAnalytics({ sectionId, subjectId }: { sectionId: string; subjectId: string }) {
  const trend = useQuery({
    queryKey: ['trend', sectionId, subjectId],
    queryFn: () => api.classTrend(sectionId, subjectId),
  })
  const standing = useQuery({
    queryKey: ['insights', sectionId, subjectId],
    queryFn: () => api.classInsights(sectionId, subjectId),
  })
  if (trend.isPending) return <Loading what='the analytics' />
  if (trend.isError) return <Problem error={trend.error} />

  const past = trend.data.filter((p) => new Date(p.dueAt) <= new Date())
  const students = past.reduce((n, p) => n + p.students, 0)
  const handed = past.reduce((n, p) => n + p.handedIn, 0)
  const late = past.reduce((n, p) => n + p.late, 0)
  const scored = past.filter((p) => p.averageScore !== null)
  const avg = scored.length ? scored.reduce((n, p) => n + p.averageScore!, 0) / scored.length : null

  const chapters = new Map<string, number[]>()
  for (const r of standing.data ?? []) chapters.set(r.chapter, [...(chapters.get(r.chapter) ?? []), r.mastery])

  return (
    <div className='space-y-4'>
      <div className='grid gap-4 sm:grid-cols-2 lg:grid-cols-4'>
        <Kpi label='Work set' icon={ClipboardList} value={trend.data.length} hint={`${past.length} closed`} />
        <Kpi label='Hand-in rate' icon={Activity} value={pct(students ? handed / students : null)} hint={`${handed} of ${students} due`} />
        <Kpi label='Average score' icon={Target} value={pct(avg)} hint='Over marked work' />
        <Kpi label='Handed in late' icon={Clock} value={late} hint='All closed work' />
      </div>
      <div className='grid gap-4 lg:grid-cols-2'>
        <ChartCard title='Work by work' description='Average score and share handed in, oldest first.'>
          <TrendChart points={trend.data} />
        </ChartCard>
        <ChartCard title='Chapter by chapter' description='The class’s mean belief from the learning model.'>
          {standing.isError ? (
            <Problem error={standing.error} />
          ) : (
            <MasteryBars
              rows={[...chapters.entries()].map(([ch, ms]) => ({
                label: chapterTitle(ch),
                mastery: ms.reduce((a, b) => a + b, 0) / ms.length,
              }))}
            />
          )}
        </ChartCard>
      </div>
    </div>
  )
}
