import { createFileRoute } from '@tanstack/react-router'
import { HomeworkBuilder } from '@/features/homework/builder'

export const Route = createFileRoute('/_authenticated/classes/$sectionId/$subjectId/new')({
  component: function NewHomeworkRoute() {
    const { sectionId, subjectId } = Route.useParams()
    return <HomeworkBuilder mode='new' sectionId={sectionId} subjectId={subjectId} />
  },
})
