import { createFileRoute } from '@tanstack/react-router'
import { HomeworkBuilder } from '@/features/homework/builder'

export const Route = createFileRoute('/_authenticated/homework/$assignmentId/edit')({
  component: function EditHomeworkRoute() {
    const { assignmentId } = Route.useParams()
    return <HomeworkBuilder mode='edit' assignmentId={assignmentId} />
  },
})
