import { createFileRoute } from '@tanstack/react-router'
import { ClassPage } from '@/features/class'

export const Route = createFileRoute('/_authenticated/classes/$sectionId/$subjectId/')({
  component: function ClassRoute() {
    const { sectionId, subjectId } = Route.useParams()
    return <ClassPage sectionId={sectionId} subjectId={subjectId} />
  },
})
