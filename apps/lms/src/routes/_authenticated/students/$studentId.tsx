import { createFileRoute } from '@tanstack/react-router'
import { StudentReport } from '@/features/students/report'

export const Route = createFileRoute('/_authenticated/students/$studentId')({
  component: function StudentRoute() {
    const { studentId } = Route.useParams()
    return <StudentReport studentId={studentId} />
  },
})
