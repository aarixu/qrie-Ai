import { createFileRoute } from '@tanstack/react-router'
import { HomeworkPage } from '@/features/homework'

export const Route = createFileRoute('/_app/homework/$assignmentId')({
  component: function HomeworkRoute() {
    const { assignmentId } = Route.useParams()
    return <HomeworkPage assignmentId={assignmentId} />
  },
})
