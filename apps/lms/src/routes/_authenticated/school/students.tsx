import { createFileRoute } from '@tanstack/react-router'
import { SchoolStudentsPage } from '@/features/school/students'

type Search = { section?: string }

export const Route = createFileRoute('/_authenticated/school/students')({
  validateSearch: (s: Record<string, unknown>): Search =>
    typeof s.section === 'string' && /^[0-9a-f-]{36}$/.test(s.section) ? { section: s.section } : {},
  component: function StudentsRoute() {
    const { section } = Route.useSearch()
    return <SchoolStudentsPage section={section} />
  },
})
