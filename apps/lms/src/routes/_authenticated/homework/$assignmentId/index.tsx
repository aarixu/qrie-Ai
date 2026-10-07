import { createFileRoute } from '@tanstack/react-router'
import { HomeworkDetail } from '@/features/homework/detail'

export const Route = createFileRoute('/_authenticated/homework/$assignmentId/')({
  component: function HomeworkRoute() {
    const { assignmentId } = Route.useParams()
    return <HomeworkDetail assignmentId={assignmentId} />
  },
})
