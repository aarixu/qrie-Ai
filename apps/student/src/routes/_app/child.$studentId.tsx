import { createFileRoute } from '@tanstack/react-router'
import { ChildPage } from '@/features/parent'

export const Route = createFileRoute('/_app/child/$studentId')({
  component: function ChildRoute() {
    const { studentId } = Route.useParams()
    return <ChildPage studentId={studentId} />
  },
})
