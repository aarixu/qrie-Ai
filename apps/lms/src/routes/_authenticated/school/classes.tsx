import { createFileRoute } from '@tanstack/react-router'
import { SchoolClassesPage } from '@/features/school/classes'

export const Route = createFileRoute('/_authenticated/school/classes')({
  component: SchoolClassesPage,
})
