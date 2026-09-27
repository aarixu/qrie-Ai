import { createFileRoute } from '@tanstack/react-router'
import { SchoolTeachersPage } from '@/features/school/teachers'

export const Route = createFileRoute('/_authenticated/school/teachers')({
  component: SchoolTeachersPage,
})
