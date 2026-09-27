import { z } from 'zod'
import { createFileRoute } from '@tanstack/react-router'
import { HomeworkBuilder } from '@/features/homework/builder'

const searchSchema = z.object({
  kind: z.enum(['homework', 'assignment', 'test']).catch('homework'),
})

export const Route = createFileRoute('/_authenticated/classes/$sectionId/$subjectId/new')({
  validateSearch: searchSchema,
  component: function NewWorkRoute() {
    const { sectionId, subjectId } = Route.useParams()
    const { kind } = Route.useSearch()
    return <HomeworkBuilder mode='new' sectionId={sectionId} subjectId={subjectId} kind={kind} />
  },
})
